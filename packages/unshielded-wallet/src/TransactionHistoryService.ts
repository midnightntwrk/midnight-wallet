import { Effect, Layer, Context, Data, SubscriptionRef, Stream } from 'effect';
import { TransactionHash, TransactionHistoryEntry, TransactionHistoryStorage } from './tx-history-storage';

export class TransactionHistoryServiceError extends Data.TaggedError('TransactionHistoryServiceError')<{
  readonly error?: unknown;
}> {
  toString(): string {
    return `TransactionHistoryServiceError: ${this.error instanceof Error ? this.error.toString() : 'Unknown error'}`;
  }
}

export type TransactionHistoryChange = {
  type: 'created' | 'updated' | 'deleted';
  entry: TransactionHistoryEntry;
};

/**
 * TransactionHistoryService API
 *
 * Extend with tx lifecycle methods when needed in the future.
 */
export interface TransactionHistoryServiceAPI {
  create: (item: TransactionHistoryEntry) => Effect.Effect<void, TransactionHistoryServiceError>;
  delete: (hash: TransactionHash) => Effect.Effect<void, TransactionHistoryServiceError>;
  getAll: () => Stream.Stream<TransactionHistoryEntry, TransactionHistoryServiceError>;
  get: (hash: TransactionHash) => Effect.Effect<TransactionHistoryEntry | undefined, TransactionHistoryServiceError>;
  changes: Stream.Stream<TransactionHistoryChange | undefined>;
}

export class TransactionHistoryService extends Context.Tag(
  '@midnight-ntwrk/wallet-sdk-unshielded-wallet/TransactionHistoryService',
)<TransactionHistoryService, TransactionHistoryServiceAPI>() {
  static readonly Live = (storage: TransactionHistoryStorage): Layer.Layer<TransactionHistoryService> =>
    Layer.effect(
      TransactionHistoryService,
      Effect.gen(function* () {
        const txHistoryRef = yield* SubscriptionRef.make<TransactionHistoryChange | undefined>(undefined);

        return {
          create: (entry: TransactionHistoryEntry) =>
            Effect.tryPromise({
              try: async () => storage.create(entry),
              catch: (error) => new TransactionHistoryServiceError({ error }),
            }).pipe(
              Effect.tap(() =>
                SubscriptionRef.set(txHistoryRef, {
                  type: 'created',
                  entry,
                } as TransactionHistoryChange),
              ),
            ),
          delete: (hash: TransactionHash) =>
            Effect.tryPromise({
              try: async () => {
                const deletedEntry = await storage.get(hash);
                await storage.delete(hash);
                SubscriptionRef.set(txHistoryRef, {
                  type: 'deleted',
                  entry: deletedEntry,
                } as TransactionHistoryChange);
              },
              catch: (error) => new TransactionHistoryServiceError({ error }),
            }),
          getAll: () =>
            Stream.fromAsyncIterable(
              storage.getAll(),
              () => new TransactionHistoryServiceError({ error: 'Failed to get all transactions' }),
            ),
          get: (hash: TransactionHash) =>
            Effect.tryPromise({
              try: async () => await storage.get(hash),
              catch: (error) => new TransactionHistoryServiceError({ error }),
            }),
          changes: txHistoryRef.changes,
        };
      }),
    );
}
