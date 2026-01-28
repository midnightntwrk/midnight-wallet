import { describe, expect, it } from 'vitest';
import {
  Array as Arr,
  Chunk,
  DateTime,
  Deferred,
  Effect,
  Equal,
  Exit,
  Fiber,
  HashMap,
  HashSet,
  Option,
  Order,
  pipe,
  Queue,
  Scope,
  Stream,
  SubscriptionRef,
  TestClock,
  TestContext,
} from 'effect';
import { PendingTransactionsServiceEffectImpl } from '../pendingTransactionsService.js';
import * as PendingTransactions from '../pendingTransactions.js';
import * as fc from 'fast-check';
import { Query, QueryClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import {
  TransactionResult,
  TransactionStatus,
  TransactionStatusQuery,
  TransactionStatusQueryVariables,
} from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';

fc.configureGlobal({ numRuns: 5 });

type FakeTransaction = Readonly<{
  uuid: string;
  ids: readonly string[];
  segments: readonly number[];
  ttlSeconds: number;
}>;
const FakeTransaction = new (class {
  arbitrary = (): fc.Arbitrary<FakeTransaction> =>
    fc.record({
      uuid: fc.uuid(),
      ids: fc.uniqueArray(fc.uuid(), { size: 'small', minLength: 1 }),
      segments: fc.uniqueArray(fc.integer({ min: 1 }), { minLength: 1 }),
      ttlSeconds: fc.integer({ min: 1 }),
    });
  batchArbitrary = (): fc.Arbitrary<readonly FakeTransaction[]> => {
    return fc.uniqueArray(this.arbitrary(), {
      comparator: (a, b) => a.ids.length === b.ids.length && a.ids.some((id) => b.ids.includes(id)),
      minLength: 1,
    });
  };
  batchesArbitrary = (): fc.Arbitrary<{
    batches: ReadonlyArray<ReadonlyArray<FakeTransaction>>;
    allFlattened: readonly FakeTransaction[];
    allMerged: readonly FakeTransaction[];
    all: readonly FakeTransaction[];
    allShuffled: readonly FakeTransaction[];
  }> => {
    return fc.array(this.batchArbitrary(), { minLength: 1 }).chain((batches) => {
      const allFlattened: readonly FakeTransaction[] = Arr.flatten(batches);
      const allMerged: readonly FakeTransaction[] = Arr.map(batches, (batch) => FakeTransaction.mergeAll(batch));
      const all = Arr.appendAll(allMerged, allFlattened);
      return fc.shuffledSubarray(all, { minLength: all.length }).map((allShuffled) => {
        return {
          batches,
          allFlattened,
          allMerged,
          all,
          allShuffled,
        };
      });
    });
  };
  mergeAll = (batch: readonly FakeTransaction[]): FakeTransaction => ({
    ttlSeconds: Arr.isNonEmptyReadonlyArray(batch)
      ? pipe(
          batch,
          Arr.map((tx) => tx.ttlSeconds),
          Arr.min(Order.number),
        )
      : 0,
    ids: batch.flatMap((tx) => tx.ids),
    uuid: crypto.randomUUID(),
    segments: pipe(
      batch,
      Arr.reduce(HashSet.empty<number>(), (acc, tx) => HashSet.union(acc, HashSet.fromIterable(tx.segments))),
      HashSet.toValues,
    ),
  });
  txTrait: PendingTransactions.TransactionTrait<FakeTransaction> = {
    isTx: (data): data is FakeTransaction => typeof data == 'object' && data != null && 'ids' in data && 'uuid' in data,
    serialize: (data): Uint8Array => pipe(data, JSON.stringify, (str) => Buffer.from(str, 'utf-8')),
    deserialize: (serialized: Uint8Array) =>
      pipe(
        serialized,
        (bytes) => Buffer.from(bytes),
        (bytes) => bytes.toString('utf-8'),
        JSON.parse,
        (data: unknown) => data as FakeTransaction,
      ),
    ids: (tx) => tx.ids,
    firstId: (tx) => tx.ids[0],
    areAllTxIdsIncluded: (tx, ids) => tx.ids.every((id) => ids.includes(id)),
    isOneIncludedInOther: (tx, otherTx) => {
      const txIdsSet = HashSet.fromIterable(tx.ids);
      const otherTxIdsSet = HashSet.fromIterable(otherTx.ids);
      const smallerSize = Order.min(Order.number)(HashSet.size(txIdsSet), HashSet.size(otherTxIdsSet));
      const intersectionSet = HashSet.intersection(txIdsSet, otherTxIdsSet);

      // One tx is included in the other (we don't care which is which) if intersection of ids is equal to one of them
      return HashSet.size(intersectionSet) === smallerSize;
    },
    hasTTLExpired: (tx, now: DateTime.Utc) => {
      const ttlDateTime = DateTime.make(tx.ttlSeconds * 1000).pipe(Option.getOrThrow);
      const diff = DateTime.distance(ttlDateTime, now); // if now is after ttl the diff will be positive
      const result = diff > 0;

      return result;
    },
  };
})();

class FakeTransactionStatus {
  #state = SubscriptionRef.make<{
    registeredTxns: ReadonlyArray<{ tx: FakeTransaction; result: TransactionResult }>;
    counters: HashMap.HashMap<string, number>;
  }>({
    registeredTxns: [],
    counters: HashMap.empty(),
  }).pipe(Effect.runSync);

  readonly runQuery: Query.Query.QueryFn<TransactionStatusQuery, TransactionStatusQueryVariables> = (vars) => {
    return SubscriptionRef.modify(this.#state, (state) => {
      const newState = {
        ...state,
        counters: HashMap.modifyAt(state.counters, vars.transactionId, (maybeN) =>
          pipe(
            maybeN,
            Option.orElseSome(() => 0),
            Option.map((n) => n + 1),
          ),
        ),
      };
      const resItems = state.registeredTxns
        .filter((gotTx) => {
          return gotTx.tx.ids.includes(vars.transactionId);
        })
        .map(
          (item): TransactionStatusQuery['transactions'][number] =>
            ({
              __typename: 'RegularTransaction',
              identifiers: [...item.tx.ids],
              transactionResult: {
                __typename: 'TransactionResult',
                ...item.result,
              },
            }) as const,
        );
      const res: TransactionStatusQuery = {
        transactions: resItems,
      };

      return [res, newState];
    });
  };

  readonly registerResult = (tx: FakeTransaction, result: TransactionResult): Effect.Effect<void, never, never> => {
    return SubscriptionRef.update(this.#state, (state) => {
      const newState = {
        ...state,
        registeredTxns: pipe(state.registeredTxns, Arr.append({ tx, result })),
      };
      return newState;
    });
  };

  readonly resetAllCounters = () => {
    return SubscriptionRef.update(this.#state, (state) => {
      return {
        ...state,
        counters: HashMap.empty(),
      };
    });
  };

  readonly registerResultForAll = (
    txns: readonly FakeTransaction[],
    result: TransactionResult,
  ): Effect.Effect<void, never, never> => {
    return Effect.forEach(txns, (tx) => this.registerResult(tx, result)).pipe(
      Effect.andThen(SubscriptionRef.get(this.#state)),
      Effect.andThen((state) => Effect.sync(() => {})),
    );
  };

  readonly awaitAllQueried = () => {
    return this.#state.changes.pipe(
      Stream.filter((state) => {
        return state.registeredTxns.every((tx) =>
          tx.tx.ids.some((id) =>
            HashMap.get(state.counters, id).pipe(
              Option.filter((n) => n > 0),
              Option.isSome,
            ),
          ),
        );
      }),
      Stream.runHead,
      Effect.asVoid,
    );
  };
}

describe('Pending Transactions Service (Effect)', () => {
  it('saves a pending transaction', () => {
    return fc.assert(
      fc.asyncProperty(FakeTransaction.batchArbitrary(), (fakeTransactions) => {
        return Effect.gen(function* () {
          const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);
          const queue = yield* Queue.unbounded<PendingTransactions.PendingTransactions<FakeTransaction>>();

          const fiber = service.state().pipe(
            Stream.takeUntil((state) => PendingTransactions.all(state).length == fakeTransactions.length),
            Stream.runCollect,
            Effect.runFork,
          );

          yield* Effect.forEach(fakeTransactions, (tx) => service.addPendingTransaction(tx));

          const results = yield* Fiber.join(fiber);

          const first = pipe(results, Chunk.head, Option.getOrThrow);
          const last = pipe(results, Chunk.last, Option.getOrThrow);

          expect(PendingTransactions.all(first).length).toEqual(0);
          expect(PendingTransactions.all(last).length).toEqual(fakeTransactions.length);
          for (const tx of fakeTransactions) {
            expect(PendingTransactions.has(last, tx, FakeTransaction.txTrait)).toBe(true);
          }
        }).pipe(Effect.runPromise);
      }),
    );
  });

  it('overrides an entry if reported ids overlap with existing one', () => {
    return fc.assert(
      fc.asyncProperty(FakeTransaction.batchesArbitrary(), (fakeTransactionBatches) => {
        return Effect.gen(function* () {
          const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);

          yield* Effect.forEach(fakeTransactionBatches.allShuffled, (tx) => service.addPendingTransaction(tx));

          const result = yield* pipe(service.state(), Stream.runHead, Effect.map(Option.getOrThrow));

          expect(PendingTransactions.all(result).length).toEqual(fakeTransactionBatches.allMerged.length);
          for (const tx of fakeTransactionBatches.all) {
            expect(PendingTransactions.has(result, tx, FakeTransaction.txTrait)).toBe(true);
          }
        }).pipe(Effect.runPromise);
      }),
    );
  });

  it('clears an entry if reported status is success', () => {
    return fc.assert(
      fc.asyncProperty(
        FakeTransaction.batchArbitrary().chain((batch) =>
          fc.shuffledSubarray([...batch], { minLength: 1 }).map((subBatch) => ({ batch, subBatch })),
        ),
        (fakeTransactions) => {
          return Effect.gen(function* () {
            const fakeTxStatus = new FakeTransactionStatus();
            const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);

            yield* TestClock.setTime(0);
            yield* Effect.forEach(fakeTransactions.batch, (tx) => service.addPendingTransaction(tx));
            yield* fakeTxStatus.registerResultForAll(fakeTransactions.subBatch, {
              segments: [],
              status: 'SUCCESS',
            });

            yield* service
              .startPolling(Stream.repeatEffect(Effect.promise(() => Promise.resolve(undefined))).pipe(Stream.take(5)))
              .pipe(
                Effect.provideService(TransactionStatus.tag, fakeTxStatus.runQuery),
                Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
                Effect.forkScoped,
              );

            yield* fakeTxStatus.awaitAllQueried();

            const result = yield* pipe(service.state(), Stream.runHead, Effect.map(Option.getOrThrow));

            for (const tx of fakeTransactions.subBatch) {
              expect(PendingTransactions.has(result, tx, FakeTransaction.txTrait)).toBe(false);
            }
          }).pipe(Effect.scoped, Effect.provide(TestContext.TestContext), Effect.runPromise);
        },
      ),
    );
  });

  it('clears an entry', () => {
    return fc.assert(
      fc.asyncProperty(
        FakeTransaction.batchArbitrary().chain((batch) =>
          fc.shuffledSubarray([...batch]).map((subBatch) => ({ batch, subBatch })),
        ),
        (fakeTransactions) => {
          return Effect.gen(function* () {
            const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);

            yield* Effect.forEach(fakeTransactions.batch, (tx) => service.addPendingTransaction(tx));
            yield* Effect.forEach(fakeTransactions.subBatch, (tx) => service.clear(tx));

            const result = yield* pipe(service.state(), Stream.runHead, Effect.map(Option.getOrThrow));

            expect(PendingTransactions.all(result).length).toEqual(
              fakeTransactions.batch.length - fakeTransactions.subBatch.length,
            );
            for (const tx of fakeTransactions.subBatch) {
              expect(PendingTransactions.has(result, tx, FakeTransaction.txTrait)).toBe(false);
            }
          }).pipe(Effect.runPromise);
        },
      ),
    );
  });

  describe('once started it adds to state transactions', () => {
    it('to be reverted due to a reported failure', async () => {
      return fc.assert(
        fc.asyncProperty(
          FakeTransaction.batchArbitrary().chain((batch) =>
            fc.shuffledSubarray([...batch], { minLength: 1 }).map((subBatch) => ({ batch, subBatch })),
          ),
          (fakeTransactions) => {
            return Effect.gen(function* () {
              const fakeTxStatus = new FakeTransactionStatus();
              const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);

              yield* Effect.forEach(fakeTransactions.batch, (tx) => service.addPendingTransaction(tx));
              yield* fakeTxStatus.registerResultForAll(fakeTransactions.subBatch, {
                segments: [],
                status: 'FAILURE',
              });
              yield* TestClock.setTime(0);

              yield* service
                .startPolling(
                  Stream.repeatEffect(Effect.promise(() => Promise.resolve(undefined))).pipe(Stream.take(5)),
                )
                .pipe(
                  Effect.provideService(TransactionStatus.tag, fakeTxStatus.runQuery),
                  Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
                  Effect.scoped,
                  Effect.runFork,
                );

              yield* fakeTxStatus.awaitAllQueried();

              const result = yield* pipe(service.state(), Stream.runHead, Effect.map(Option.getOrThrow));

              expect(PendingTransactions.all(result).length).toEqual(fakeTransactions.batch.length);
              const allFailed = PendingTransactions.allFailed(result);
              const expectedUUIDs = pipe(
                fakeTransactions.subBatch,
                Arr.map((tx) => tx.uuid),
                HashSet.fromIterable,
              );
              const gotUUIDs = pipe(
                allFailed,
                Arr.map((tx) => tx.tx.uuid),
                HashSet.fromIterable,
              );

              expect(HashSet.difference(expectedUUIDs, gotUUIDs).pipe(HashSet.size)).toBe(0);
              for (const item of allFailed) {
                expect(item.result.status).toEqual('FAILURE');
              }
            }).pipe(Effect.provide(TestContext.TestContext), Effect.scoped, Effect.runPromise);
          },
        ),
      );
    });

    it('to be (partially) reverted due to a reported partial failure', async () => {
      return fc.assert(
        fc.asyncProperty(
          FakeTransaction.batchArbitrary().chain((batch) =>
            fc.shuffledSubarray([...batch], { minLength: 1 }).map((subBatch) => ({ batch, subBatch })),
          ),
          fc.record<TransactionResult>({
            status: fc.constant('PARTIAL_SUCCESS' as const),
            segments: fc.array(fc.record({ id: fc.integer({ min: 1 }), success: fc.boolean() })),
          }),
          (fakeTransactions, partialSuccess: TransactionResult) => {
            return Effect.gen(function* () {
              const fakeTxStatus = new FakeTransactionStatus();
              const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);
              yield* TestClock.setTime(0);

              yield* Effect.forEach(fakeTransactions.batch, (tx) => service.addPendingTransaction(tx));
              yield* fakeTxStatus.registerResultForAll(fakeTransactions.subBatch, partialSuccess);

              yield* service
                .startPolling(Stream.make(undefined))
                .pipe(
                  Effect.provideService(TransactionStatus.tag, fakeTxStatus.runQuery),
                  Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
                  Effect.forkScoped,
                );

              yield* fakeTxStatus.awaitAllQueried();

              const result = yield* pipe(service.state(), Stream.runHead, Effect.map(Option.getOrThrow));

              const allFailed = PendingTransactions.allFailed(result);
              const expectedUUIDs = pipe(
                fakeTransactions.subBatch,
                Arr.map((tx) => tx.uuid),
                HashSet.fromIterable,
              );
              const gotUUIDs = pipe(
                allFailed,
                Arr.map((tx) => tx.tx.uuid),
                HashSet.fromIterable,
              );
              expect(HashSet.difference(expectedUUIDs, gotUUIDs).pipe(HashSet.size)).toBe(0);
              for (const item of allFailed) {
                expect(item.result).toEqual(partialSuccess);
              }
            }).pipe(Effect.provide(TestContext.TestContext), Effect.scoped, Effect.runPromise);
          },
        ),
      );
    });

    it('to be reverted due to a passed TTL', async () => {
      return fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1 }).chain((nowSeconds) => {
            return fc.record({
              nowSeconds: fc.constant(nowSeconds),
              batchExceedingTTL: FakeTransaction.batchArbitrary().map(
                Arr.map((tx) => ({ ...tx, ttlSeconds: nowSeconds - tx.ttlSeconds })),
              ),
              batchWithinTTL: FakeTransaction.batchArbitrary().map(
                Arr.map((tx) => ({ ...tx, ttlSeconds: nowSeconds + tx.ttlSeconds })),
              ),
            });
          }),

          ({ nowSeconds, batchExceedingTTL, batchWithinTTL }) => {
            return Effect.gen(function* () {
              const fakeTxStatus = new FakeTransactionStatus();
              const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);

              yield* Effect.forEach(batchExceedingTTL, (tx) => service.addPendingTransaction(tx));
              yield* Effect.forEach(batchWithinTTL, (tx) => service.addPendingTransaction(tx));

              yield* TestClock.setTime(nowSeconds * 1000).pipe(
                Effect.andThen(service.startPolling(Stream.make(undefined))),
                Effect.provide(TestContext.TestContext),
                Effect.provideService(TransactionStatus.tag, fakeTxStatus.runQuery),
                Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
                Effect.scoped,
              );

              yield* fakeTxStatus.awaitAllQueried();

              const result = yield* pipe(service.state(), Stream.runHead, Effect.map(Option.getOrThrow));

              expect(PendingTransactions.all(result).length).toEqual(batchWithinTTL.length + batchExceedingTTL.length);
              const allFailed = PendingTransactions.allFailed(result);
              expect(allFailed.length).toEqual(batchExceedingTTL.length);
              const expectedUUIDs = pipe(
                batchExceedingTTL,
                Arr.map((tx) => tx.uuid),
                HashSet.fromIterable,
              );
              const gotUUIDs = pipe(
                allFailed,
                Arr.map((tx) => tx.tx.uuid),
                HashSet.fromIterable,
              );
              expect(Equal.equals(gotUUIDs, expectedUUIDs)).toBe(true);
              for (const item of allFailed) {
                expect(item.result.status).toEqual('FAILURE');
              }
            }).pipe(Effect.runPromise);
          },
        ),
      );
    });
  });

  it('can serialize its state and restore from it', async () => {
    return fc.assert(
      fc.asyncProperty(
        FakeTransaction.batchArbitrary().chain((batch) =>
          fc.shuffledSubarray([...batch], { minLength: 1 }).map((subBatch) => ({ batch, subBatch })),
        ),
        fc.record<TransactionResult>({
          status: fc.constantFrom('PARTIAL_SUCCESS', 'FAILURE'),
          segments: fc.array(fc.record({ id: fc.integer({ min: 1 }), success: fc.boolean() })),
        }),
        (fakeTransactions, registeredResult: TransactionResult) => {
          return Effect.gen(function* () {
            const fakeTxStatus = new FakeTransactionStatus();
            const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);
            yield* TestClock.setTime(0);

            yield* Effect.forEach(fakeTransactions.batch, (tx) => service.addPendingTransaction(tx));
            yield* fakeTxStatus.registerResultForAll(fakeTransactions.subBatch, registeredResult);

            yield* service
              .startPolling(Stream.make(undefined))
              .pipe(
                Effect.provideService(TransactionStatus.tag, fakeTxStatus.runQuery),
                Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
                Effect.forkScoped,
              );

            yield* fakeTxStatus.awaitAllQueried();
            const serialized = yield* service.state().pipe(
              Stream.runHead,
              Effect.map(Option.getOrThrow),
              Effect.map((state) => PendingTransactions.serialize(state, FakeTransaction.txTrait)),
            );

            const restoredService = yield* PendingTransactionsServiceEffectImpl.restore(
              serialized,
              FakeTransaction.txTrait,
            );

            const result = yield* pipe(restoredService.state(), Stream.runHead, Effect.map(Option.getOrThrow));

            expect(PendingTransactions.all(result).length).toEqual(fakeTransactions.batch.length);
            expect(PendingTransactions.allFailed(result).length).toEqual(0);
            for (const item of fakeTransactions.batch) {
              expect(PendingTransactions.has(result, item, FakeTransaction.txTrait)).toBe(true);
            }
          }).pipe(Effect.provide(TestContext.TestContext), Effect.scoped, Effect.runPromise);
        },
      ),
    );
  });

  it('does not make queries after being stopped', async () => {
    return fc.assert(
      fc.asyncProperty(FakeTransaction.batchArbitrary(), (fakeTransactions) => {
        return Effect.gen(function* () {
          const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);
          const scope = yield* Scope.make();
          const latch1 = yield* Deferred.make<void>();
          const latch2 = yield* Deferred.make<void>();
          let hasRunQueryAfterStop = false;

          yield* TestClock.setTime(0);
          yield* Effect.forEach(fakeTransactions, (tx) => service.addPendingTransaction(tx));

          const fiber = yield* service
            .startPolling(
              Stream.repeatEffect(
                Effect.promise(() => {
                  return Promise.resolve(undefined);
                }),
              ),
            )
            .pipe(
              Effect.provideService(TransactionStatus.tag, () => {
                return Deferred.succeed(latch1, undefined).pipe(
                  Effect.andThen(Deferred.isDone(latch2)),
                  Effect.andThen((isDone) => {
                    if (isDone) {
                      return pipe(
                        Effect.sync(() => {
                          hasRunQueryAfterStop = true;
                        }),
                        Effect.andThen(Effect.die(new Error('Unexpected query'))),
                      );
                    } else {
                      return Effect.succeed({
                        transactions: [],
                      });
                    }
                  }),
                );
              }),
              Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
              Effect.provideService(Scope.Scope, scope),
              Effect.fork,
            );

          yield* Deferred.await(latch1);
          yield* Scope.close(scope, Exit.succeed(undefined));
          yield* Deferred.succeed(latch2, undefined);

          const fiberResult = yield* Fiber.join(fiber).pipe(Effect.exit);

          expect(hasRunQueryAfterStop).toBe(false);
          expect(Exit.isSuccess(fiberResult) || Exit.isInterrupted(fiberResult)).toBe(true);
        }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);
      }),
    );
  });

  it('does not fail polling if transaction status query fails', async () => {
    return fc.assert(
      fc.asyncProperty(FakeTransaction.batchArbitrary(), (fakeTransactions) => {
        return Effect.gen(function* () {
          const service = new PendingTransactionsServiceEffectImpl(FakeTransaction.txTrait);
          const scope = yield* Scope.make();
          const latch = yield* Deferred.make<void>();

          yield* TestClock.setTime(0);
          yield* Effect.forEach(fakeTransactions, (tx) => service.addPendingTransaction(tx));

          const fiber = yield* service
            .startPolling(
              Stream.repeatEffect(
                Effect.promise(() => {
                  return Promise.resolve(undefined);
                }),
              ).pipe(Stream.takeUntilEffect(() => Deferred.isDone(latch))),
            )
            .pipe(
              Effect.provideService(TransactionStatus.tag, () => {
                return Deferred.succeed(latch, undefined).pipe(
                  Effect.andThen(Effect.fail(new ServerError({ message: 'Failing query' }))),
                );
              }),
              Effect.provideService(QueryClient, {} as unknown as QueryClient.Service),
              Effect.provideService(Scope.Scope, scope),
              Effect.fork,
            );

          yield* Deferred.await(latch);
          yield* Scope.close(scope, Exit.succeed(undefined));
          const fiberResult = yield* Fiber.join(fiber).pipe(Effect.exit);

          expect(Exit.isSuccess(fiberResult) || Exit.isFailure(fiberResult)).toBe(true);
        }).pipe(Effect.provide(TestContext.TestContext), Effect.scoped, Effect.runPromise);
      }),
    );
  });
});
