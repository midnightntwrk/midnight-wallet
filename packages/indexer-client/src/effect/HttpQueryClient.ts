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
import { Effect, type Context, Layer, type Scope } from 'effect';
import { print, type ExecutionResult } from 'graphql';
import { createClient, type Client, type RequestParams, type NetworkError } from 'graphql-http';
import { QueryClient } from './QueryClient.js';
import type { Query } from './Query.js';
import {
  type InvalidProtocolSchemeError,
  ClientError,
  ServerError,
  HttpURL,
} from '@midnight-ntwrk/wallet-sdk-utilities/networking';

export const layer: (
  config: QueryClient.ServerConfig,
) => Layer.Layer<QueryClient, InvalidProtocolSchemeError, Scope.Scope> = (config) =>
  Layer.effect(
    QueryClient,
    HttpURL.make(config.url).pipe(
      Effect.flatMap((url) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            createClient({
              url: url.toString(),
              shouldRetry: (error, retries) => {
                const statusCode = error.response?.status ?? 500;
                return Promise.resolve(retries < 3 && statusCode >= 502 && statusCode <= 504);
              },
            }),
          ),
          (client) => Effect.sync(() => client.dispose()),
        ),
      ),
      Effect.map((client) => new HttpQueryClientImpl(client)),
    ),
  );

class HttpQueryClientImpl implements Context.Tag.Service<QueryClient> {
  constructor(client: Client) {
    this.client = client;
  }

  protected readonly client: Client;

  query<R, V, T extends Query.Document<R, V> = Query.Document<R, V>>(
    document: T,
    variables: V,
  ): Effect.Effect<Query.Result<T>, ClientError | ServerError> {
    return Effect.async((resume) => {
      let result: ExecutionResult<Query.Result<T>, unknown>;

      const dispose = this.client.subscribe<Query.Result<T>>(
        { query: print(document), variables: variables as RequestParams['variables'] },
        {
          next: (data) => (result = data),
          error: (error: NetworkError) => {
            const statusCode = error.response?.status ?? 500;
            const message = error.response?.statusText ?? 'An unknown error occurred';

            resume(
              Effect.fail(
                statusCode >= 400 && statusCode < 500
                  ? new ClientError({ message, cause: error })
                  : new ServerError({ message }),
              ),
            );
          },
          complete: () =>
            resume(
              result.errors
                ? Effect.fail(new ClientError({ message: result.errors[0].message, cause: result.errors }))
                : Effect.succeed(result.data!),
            ),
        },
      );

      // Ensure we dispose of the query if the running Fiber is terminated.
      return Effect.sync(dispose);
    });
  }
}
