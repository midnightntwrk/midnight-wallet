import { Effect, Context } from 'effect';
import { ClientError, ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import type { Query } from './Query';

export class QueryClient extends Context.Tag('@midnight-ntwrk/indexer-client#QueryClient')<
  QueryClient,
  QueryClient.Service
>() {}

export declare namespace QueryClient {
  interface ServerConfig {
    readonly url: URL | string;
  }

  interface Service {
    query<R, V, T extends Query.Document<R, V> = Query.Document<R, V>>(
      document: T,
      variables: V,
    ): Effect.Effect<Query.Result<T>, ClientError | ServerError>;
  }
}
