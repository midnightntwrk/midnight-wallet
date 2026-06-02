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
import {
  type InvalidProtocolSchemeError,
  WsURL,
  ClientError,
  ServerError,
} from '@midnight-ntwrk/wallet-sdk-utilities/networking';

// graphql-ws delivers a subscription sink error as one of: `Error`, `CloseEvent`,
// or `readonly GraphQLError[]` (per its Sink docs). Only the array form should
// surface as a ClientError; everything else is a transport/server failure.
const isGraphQLErrorArray = (err: unknown): err is readonly GraphQLError[] => {
  if (!Arr.isArray(err) || err.length === 0) return false;
  const first: unknown = err[0];
  return typeof first === 'object' && first !== null && 'message' in first && typeof first.message === 'string';
};

export const layer: (
  config: SubscriptionClient.ServerConfig,
) => Layer.Layer<SubscriptionClient, InvalidProtocolSchemeError, Scope.Scope> = (config) =>
  Layer.scoped(
    SubscriptionClient,
    WsURL.make(config.url).pipe(
      Effect.flatMap((url) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            createClient({ url: url.toString(), shouldRetry: () => false, keepAlive: config.keepAlive ?? 15_000 }),
          ),
          (client) => Effect.sync(() => client.dispose()),
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
}
