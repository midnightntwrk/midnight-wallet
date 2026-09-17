// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { Effect, Stream, type Context, Layer, type Scope, Array as Arr } from 'effect';
import { createClient, type Client, type SubscribePayload } from 'graphql-ws';
import { type GraphQLError, print } from 'graphql';
import { SubscriptionClient } from './SubscriptionClient.js';
import { type Query } from './Query.js';
import { withBackpressure, type Source } from './Backpressure.js';
import { makeDeflateWebSocket } from './DeflateWebSocket.js';
import {
  type InvalidProtocolSchemeError,
  WsURL,
  ClientError,
  ServerError,
} from '@midnightntwrk/wallet-sdk-utilities/networking';

// ============================================================================
// Error classification
// ============================================================================

// graphql-ws delivers a subscription sink error as one of: `Error`, `CloseEvent`,
// or `readonly GraphQLError[]` (per its Sink docs). Only the array form should
// surface as a ClientError; everything else is a transport/server failure.
const isGraphQLErrorArray = (err: unknown): err is readonly GraphQLError[] => {
  if (!Arr.isArray(err) || err.length === 0) return false;
  const first: unknown = err[0];
  return typeof first === 'object' && first !== null && 'message' in first && typeof first.message === 'string';
};

const toClientOrServerError = (err: unknown): ClientError | ServerError =>
  isGraphQLErrorArray(err)
    ? new ClientError({ message: err.map((e) => e.message).join('; '), cause: err })
    : new ServerError({ message: String(err) });

// ============================================================================
// Layer / class
// ============================================================================

/**
 * @internal Test-only transport seams for {@link layer} — deliberately NOT part of
 * {@link SubscriptionClient.ServerConfig}. Compression is always offered (falling back
 * automatically against servers without it) and connection reuse is fixed policy; consumers get
 * no knobs for either. These seams exist solely so integration tests can run a compression-off
 * reference and observe raw frames on the wire.
 */
export interface TransportInternals {
  /** Offer the deflate compression subprotocol (default: true). */
  readonly compression?: boolean | undefined;
  /** The underlying WebSocket constructor (default: the global `WebSocket`). */
  readonly webSocketImpl?: typeof WebSocket | undefined;
}

/**
 * Builds a {@link SubscriptionClient} layer backed by a `graphql-ws` WebSocket connection to the indexer.
 *
 * The connection negotiates the indexer's compression subprotocol (with automatic fallback against servers that predate
 * compression) and is held open for the client's entire scope (`lazy: false`), so backpressure pause/resume cycles and
 * re-subscriptions always reuse it instead of paying a reconnect handshake. Correctness never depends on connection
 * lifetime (resume is always cursor-based), so this is pure policy, not configuration. Non-lazy mode also makes
 * disposal total: graphql-ws never arms its lazy-close timer, whose handle its `dispose()` leaks — a pending timer that
 * would otherwise keep a short-lived Node process alive after the wallet stopped. The client is scoped — it is
 * disposed, closing the connection and cancelling its timers, when the surrounding scope closes.
 *
 * @example
 *   ```typescript
 *   const events = ZswapEvents.run({ id: 0 }).pipe(
 *     Stream.runCollect,
 *     Effect.provide(WsSubscriptionClient.layer({ url: 'ws://localhost:8088/api/v4/graphql/ws' })),
 *     Effect.scoped,
 *   );
 *   ```;
 *
 * @param config - The indexer WebSocket endpoint and optional keep-alive interval
 * @param internals - `@internal` test-only transport seams; production callers omit this
 * @returns A scoped layer providing `SubscriptionClient`, failing with `InvalidProtocolSchemeError` if `config.url` is
 *   not a WebSocket URL
 */
export const layer: (
  config: SubscriptionClient.ServerConfig,
  internals?: TransportInternals,
) => Layer.Layer<SubscriptionClient, InvalidProtocolSchemeError, Scope.Scope> = (config, internals) =>
  Layer.scoped(
    SubscriptionClient,
    WsURL.make(config.url).pipe(
      Effect.flatMap((url) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            // Resolved at acquire time, guarded so runtimes without the global reach graphql-ws's
            // own probing and descriptive "implementation missing" error instead of a ReferenceError.
            const webSocketImpl =
              internals?.webSocketImpl ?? (typeof WebSocket === 'undefined' ? undefined : WebSocket);
            return createClient({
              url: url.toString(),
              shouldRetry: () => false,
              lazy: false,
              // A connection failing while nothing is subscribed needs no handling: active
              // subscriptions surface transport errors through their own sinks, and the next
              // subscribe dials afresh. Without this graphql-ws would console.error the event.
              onNonLazyError: () => undefined,
              keepAlive: config.keepAlive ?? 15_000,
              webSocketImpl:
                internals?.compression === false
                  ? internals.webSocketImpl
                  : webSocketImpl === undefined
                    ? undefined
                    : makeDeflateWebSocket(webSocketImpl),
            });
          }),
          // dispose() is async and rejects when the connection attempt it awaits has already
          // failed — which still means "nothing left to close", i.e. successful disposal. Await
          // it so the rejection is absorbed here instead of floating as an unhandled rejection.
          (client) => Effect.promise(() => Promise.resolve(client.dispose()).then(undefined, () => undefined)),
        ),
      ),
      Effect.map((client) => new WebSocketSubscriptionClientImpl(client)),
    ),
  );

class WebSocketSubscriptionClientImpl implements Context.Tag.Service<SubscriptionClient> {
  constructor(client: Client) {
    this.client = client;
  }

  protected readonly client: Client;

  subscribe<R, V, T extends Query.Document<R, V> = Query.Document<R, V>>(
    document: T,
    variables: V,
  ): Stream.Stream<Query.Result<T>, ClientError | ServerError> {
    // Stream.async forks a top-level fiber per emit.single (via
    // Runtime.runPromiseExit), which leaks into Effect's Global.roots at the
    // ~1k msg/sec rate the indexer pushes. Stream.asyncPush writes straight
    // to an internal queue and tears it down with the surrounding scope.
    return Stream.asyncPush<Query.Result<T>, ClientError | ServerError>(
      (emit) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            this.client.subscribe<Query.Result<T>>(
              { query: print(document), variables: variables as SubscribePayload['variables'] },
              {
                next: (data) => {
                  if (data.errors) {
                    emit.fail(
                      new ClientError({
                        message: data.errors.map((e) => e.message).join('; '),
                        cause: data.errors,
                      }),
                    );
                  } else {
                    emit.single(data.data!);
                  }
                },
                error: (err: unknown) => {
                  if (isGraphQLErrorArray(err)) {
                    emit.fail(new ClientError({ message: err.map((e) => e.message).join('; '), cause: err }));
                  } else {
                    emit.fail(new ServerError({ message: String(err) }));
                  }
                },
                complete: () => {
                  emit.end();
                },
              },
            ),
          ),
          (dispose) => Effect.sync(() => dispose()),
        ),
      { bufferSize: 'unbounded' },
    );
  }

  subscribeWithBackpressure<R, V, T extends Query.Document<R, V> = Query.Document<R, V>>(
    document: T,
    options: SubscriptionClient.BackpressureOptions<Query.Result<T>, V>,
  ): Stream.Stream<Query.Result<T>, ClientError | ServerError> {
    type Item = Query.Result<T>;
    const client = this.client;

    // Adapt graphql-ws's Sink callbacks to the generic Source contract; the
    // backpressure/lifecycle logic lives in `withBackpressure`.
    const source: Source<Item, V, ClientError | ServerError> = ({ variables, onItem, onError, onComplete }) =>
      client.subscribe<Item>(
        { query: print(document), variables: variables as SubscribePayload['variables'] },
        {
          next: (data) => {
            if (data.errors) onError(toClientOrServerError(data.errors));
            else onItem(data.data!);
          },
          error: (err) => onError(toClientOrServerError(err)),
          complete: onComplete,
        },
      );

    return withBackpressure(source, options);
  }
}
