import { Effect, Context, Layer, Scope } from 'effect';
import { print, ExecutionResult } from 'graphql';
import { createClient, Client, type RequestParams, NetworkError } from 'graphql-http';
import { QueryClient } from './QueryClient.js';
import type { Query } from './Query.js';
import {
  InvalidProtocolSchemeError,
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
