import { Stream, Context } from 'effect';
import type { Query } from './Query.js';
import { ClientError, ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';

export class SubscriptionClient extends Context.Tag('@midnight-ntwrk/indexer-client#SubscriptionClient')<
  SubscriptionClient,
  SubscriptionClient.Service
>() {}

export declare namespace SubscriptionClient {
  interface ServerConfig {
    readonly url: URL | string;
  }

  interface Service {
    subscribe<R, V, T extends Query.Document<R, V> = Query.Document<R, V>>(
      document: T,
      variables: V,
    ): Stream.Stream<Query.Result<T>, ClientError | ServerError>;
  }
}
