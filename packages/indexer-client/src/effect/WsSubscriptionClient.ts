// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { Effect, Stream, Context, Layer, Scope } from 'effect';
import { createClient, type Client, type SubscribePayload } from 'graphql-ws';
import { type GraphQLError, print } from 'graphql';
import { SubscriptionClient } from './SubscriptionClient.js';
import { Query } from './Query.js';
import {
  InvalidProtocolSchemeError,
  WsURL,
  ClientError,
  ServerError,
} from '@midnight-ntwrk/wallet-sdk-utilities/networking';

export const layer: (
  config: SubscriptionClient.ServerConfig,
) => Layer.Layer<SubscriptionClient, InvalidProtocolSchemeError, Scope.Scope> = (config) =>
  Layer.effect(
    SubscriptionClient,
    WsURL.make(config.url).pipe(
      Effect.flatMap((url) =>
        Effect.acquireRelease(
          Effect.sync(() => createClient({ url: url.toString(), shouldRetry: () => false, keepAlive: 15_000 })),
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
    return Stream.async((emit) => {
      const dispose = this.client.subscribe<Query.Result<T>>(
        { query: print(document), variables: variables as SubscribePayload['variables'] },
        {
          next: (data) => {
            if (data.errors) {
              return void emit.fail(new ClientError({ message: data.errors[0].message, cause: data.errors }));
            }

            void emit.single(data.data!);
          },
          error: (err: unknown) => {
            void emit.fail(
              Array.isArray(err)
                ? new ClientError({ message: (err as readonly GraphQLError[])[0].message })
                : new ServerError({ message: String(err) }),
            );
          },
          complete: () => void emit.end(),
        },
      );

      // Ensure we dispose of the query if the running Fiber is terminated.
      return Effect.sync(dispose);
    });
  }
}
