import { Effect, Layer, Context, Data, SubscriptionRef, Stream } from 'effect';
import {
  TransactionHash,
  UnshieldedTransactionHistoryEntry,
  UnshieldedTransactionHistoryChange,
} from '@midnight-ntwrk/wallet-api';
import { TransactionHistoryStorage } from './tx-history-storage';

export class TransactionHistoryServiceError extends Data.TaggedError('TransactionHistoryServiceError')<{
  readonly error?: unknown;
}> {
  toString(): string {
    return `TransactionHistoryServiceError: ${this.error instanceof Error ? this.error.toString() : 'Unknown error'}`;
  }
}

/**
 * TransactionHistoryService API
 *
 * Extend with tx lifecycle methods when needed in the future.
 */
export interface TransactionHistoryServiceAPI {
  create: (item: UnshieldedTransactionHistoryEntry) => Effect.Effect<void, TransactionHistoryServiceError>;
  delete: (hash: TransactionHash) => Effect.Effect<void, TransactionHistoryServiceError>;
  getAll: () => Stream.Stream<UnshieldedTransactionHistoryEntry, TransactionHistoryServiceError>;
  get: (
    hash: TransactionHash,
  ) => Effect.Effect<UnshieldedTransactionHistoryEntry | undefined, TransactionHistoryServiceError>;
  changes: Stream.Stream<UnshieldedTransactionHistoryChange | undefined>;
}

export class TransactionHistoryService extends Context.Tag(
  '@midnight-ntwrk/wallet-sdk-unshielded-wallet/TransactionHistoryService',
)<TransactionHistoryService, TransactionHistoryServiceAPI>() {
  static readonly Live = (storage: TransactionHistoryStorage): Layer.Layer<TransactionHistoryService> =>
    Layer.effect(
      TransactionHistoryService,
      Effect.gen(function* () {
        const txHistoryRef = yield* SubscriptionRef.make<UnshieldedTransactionHistoryChange | undefined>(undefined);

        return {
          create: (entry: UnshieldedTransactionHistoryEntry) =>
            Effect.tryPromise({
              try: async () => storage.create(entry),
              catch: (error) => new TransactionHistoryServiceError({ error }),
            }).pipe(
              Effect.tap(() =>
                SubscriptionRef.set(txHistoryRef, {
                  type: 'created',
                  entry,
                } as UnshieldedTransactionHistoryChange),
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
                } as UnshieldedTransactionHistoryChange);
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
