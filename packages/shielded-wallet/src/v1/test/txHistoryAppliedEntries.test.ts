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
import * as ledger from '@midnightntwrk/ledger-v8';
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Match,
  Ref,
  Scope,
  Stream,
  SubscriptionRef,
  TestClock,
  TestContext,
} from 'effect';
import { describe, expect, it } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { RunningV1Variant } from '../RunningV1Variant.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { type ChangesResult, type SyncCapability, type SyncService } from '../Sync.js';
import { makeDefaultTransactingCapability } from '../Transacting.js';
import {
  makeDefaultTransactionHistoryService,
  type ShieldedHistoryStorage,
  ShieldedTransactionHistoryEntrySchema,
  type TransactionDetails,
  type TransactionHistoryService,
} from '../TransactionHistory.js';
import { TransactionHistoryError } from '../WalletError.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** A sync update is the batch of tx hashes it carries; each becomes a state change whose `source` is that hash. */
type FakeSyncUpdate = readonly string[];

const changeOf = (source: string): ledger.ZswapStateChanges => ({ source, receivedCoins: [], spentCoins: [] });

const block = { hash: 'block-hash', height: 7, timestamp: 1_700_000_000 };

const detailsOf = (hash: string): TransactionDetails => ({
  hash,
  block,
  status: 'SUCCESS',
  identifiers: ['id-1'],
});

type Storage = InMemoryTransactionHistoryStorage<
  typeof ShieldedTransactionHistoryEntrySchema.Type,
  typeof ShieldedTransactionHistoryEntrySchema.Encoded
>;

type Entry = Awaited<ReturnType<Storage['getAll']>>[number];

/** What the indexer does when asked for a transaction's details. */
type IndexerAnswer = 'answers' | 'not yet indexed' | 'refuses';

/** How the indexer answers for `hash` at `nowMillis` on the (test) clock. */
type Indexer = (hash: string, nowMillis: number) => IndexerAnswer;

/** An indexer that cannot answer for any transaction until `from`, and answers for every one from then on. */
const answersFrom =
  (from: Duration.Duration): Indexer =>
  (_hash, nowMillis) =>
    nowMillis >= Duration.toMillis(from) ? 'answers' : 'not yet indexed';

/** An indexer that only ever answers for `hashes`. */
const answersOnly =
  (hashes: readonly string[]): Indexer =>
  (hash) =>
    hashes.includes(hash) ? 'answers' : 'not yet indexed';

/** An indexer that refuses every query outright, as it does a 4xx or GraphQL error: waiting cannot change that. */
const refusesAll: Indexer = () => 'refuses';

/** One indexer lookup: which transaction, and when on the (test) clock. */
type Lookup = { readonly hash: string; readonly atMillis: number };

/**
 * The default history service writing to `storage`, with its indexer lookup replaced by `indexer`; every lookup is
 * recorded in `lookups`.
 */
const historyServiceOf = (
  storage: ShieldedHistoryStorage,
  indexer: Indexer,
  lookups: Ref.Ref<readonly Lookup[]>,
): TransactionHistoryService => ({
  ...makeDefaultTransactionHistoryService(
    { txHistoryStorage: storage, indexerClientConnection: { indexerHttpUrl: 'http://localhost:9999/graphql' } },
    () => undefined,
  ),
  getTransactionDetails: (hash) =>
    Clock.currentTimeMillis.pipe(
      Effect.tap((atMillis) => Ref.update(lookups, (all) => [...all, { hash, atMillis }])),
      Effect.flatMap((now) =>
        Match.value(indexer(hash, now)).pipe(
          Match.when('answers', () => Effect.succeed(detailsOf(hash))),
          Match.when('not yet indexed', () =>
            Effect.fail(new TransactionHistoryError({ message: `Indexer has not yet indexed transaction ${hash}` })),
          ),
          Match.when('refuses', () =>
            Effect.fail(
              new TransactionHistoryError({
                message: `The transaction metadata query for ${hash} failed and will not be retried`,
                retryable: false,
              }),
            ),
          ),
          Match.exhaustive,
        ),
      ),
    ),
});

/** `service`, counting in `reads` each time it is asked which entries are still pending. */
const countingPendingReads = (
  service: TransactionHistoryService,
  reads: Ref.Ref<number>,
): TransactionHistoryService => {
  const appliedEntries = service.appliedEntries;
  return appliedEntries === undefined
    ? service
    : {
        ...service,
        appliedEntries: {
          ...appliedEntries,
          pending: () => Ref.update(reads, (n) => n + 1).pipe(Effect.zipRight(appliedEntries.pending())),
        },
      };
};

/** `storage` seen through `overrides`: what a storage with those methods replaced would do. */
const storageWith = (storage: Storage, overrides: Partial<ShieldedHistoryStorage>): ShieldedHistoryStorage => ({
  getAll: () => storage.getAll(),
  get: (hash) => storage.get(hash),
  serialize: () => storage.serialize(),
  gotPending: (entry) => storage.gotPending(entry),
  gotFinalized: (entry) => storage.gotFinalized(entry),
  gotRejected: (entry) => storage.gotRejected(entry),
  gotApplied: (entry) => storage.gotApplied(entry),
  ...overrides,
});

/** What a storage the wallet writes through can see of the wallet at the moment of a write. */
type WalletView = {
  /** The state the wallet has committed. */
  readonly committed: () => CoreWallet;
  /** The state the change for `hash` was applied over, once it has been. */
  readonly appliedOver: (hash: string) => CoreWallet | undefined;
};

/**
 * A V1 variant syncing `batches`, its history going through the service `serviceFor` builds from the wallet's view.
 * Each applied update yields a new state object, so a state the wallet has moved past is told apart by identity.
 */
const makeVariant = (
  scope: Scope.Scope,
  batches: readonly FakeSyncUpdate[],
  serviceFor: (view: WalletView) => TransactionHistoryService,
  changeFor: (source: string) => ledger.ZswapStateChanges = changeOf,
) =>
  Effect.gen(function* () {
    // Test setup: the state each change was applied over, recorded synchronously as the wallet applies it.
    const appliedOver = new Map<string, CoreWallet>();
    const syncService: SyncService<CoreWallet, null, FakeSyncUpdate> = { updates: () => Stream.fromIterable(batches) };
    const syncCapability: SyncCapability<CoreWallet, FakeSyncUpdate, ChangesResult> = {
      applyUpdate: (state, sources) => {
        sources.forEach((source) => appliedOver.set(source, state));
        return [{ ...state }, { changes: sources.map(changeFor), protocolVersion: 1 }];
      },
    };
    const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability();
    const keysCapability = makeDefaultKeysCapability();
    const coinSelection = () => undefined;
    const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));
    const stateRef = yield* SubscriptionRef.make(CoreWallet.init(new ledger.ZswapLocalState(), secretKeys, networkId));
    const view: WalletView = {
      committed: () => Effect.runSync(SubscriptionRef.get(stateRef)),
      appliedOver: (hash) => appliedOver.get(hash),
    };
    const variant = new RunningV1Variant(
      scope,
      {
        stateRef,
        activationRange: ProtocolVersion.makeRange(
          ProtocolVersion.MinSupportedVersion,
          ProtocolVersion.MaxSupportedVersion,
        ),
      },
      {
        serializationCapability: makeDefaultV1SerializationCapability(),
        syncService,
        syncCapability,
        transactingCapability: makeDefaultTransactingCapability({ networkId }, () => ({
          coinSelection,
          coinsAndBalancesCapability,
          keysCapability,
        })),
        coinsAndBalancesCapability,
        keysCapability,
        coinSelection,
        transactionHistoryService: serviceFor(view),
      },
    );
    return { variant, stateRef };
  });

type Run = {
  /** The history the test seeds and inspects. */
  readonly storage: Storage;
  readonly batches?: readonly FakeSyncUpdate[];
  readonly indexer: Indexer;
  /** How long to let pass on the test clock once the sync has started. */
  readonly settleFor: Duration.Duration;
  /** How many times the sync is started, one after the other. */
  readonly syncRuns?: number;
  /** The change each hash in a batch stands for; one with no coins unless a test gives it some. */
  readonly changeFor?: (source: string) => ledger.ZswapStateChanges;
  /** The storage the wallet writes through; `storage` itself unless a test watches or fails some of its calls. */
  readonly storageSeenByWallet?: (storage: Storage, wallet: WalletView) => ShieldedHistoryStorage;
};

type LogLine = { readonly level: string; readonly message: string };

/**
 * Runs a V1 variant over `batches` against `storage`, recording which hashes the history held each time the wallet
 * state changed, every indexer lookup and every log line, and lets `settleFor` pass on the test clock.
 */
const runVariant = ({
  storage,
  batches = [],
  indexer,
  settleFor,
  syncRuns = 1,
  changeFor,
  storageSeenByWallet,
}: Run) => {
  // Test setup: the logger is called synchronously, so its lines are collected outside the Effect.
  const logs: LogLine[] = [];
  const recordingLogger = Logger.make(({ logLevel, message }) => {
    logs.push({
      level: logLevel.label,
      message: (Array.isArray(message) ? message : [message]).filter((m) => typeof m === 'string').join(' '),
    });
  });

  return Effect.gen(function* () {
    const pendingReads = yield* Ref.make(0);
    const lookups = yield* Ref.make<readonly Lookup[]>([]);
    const scope = yield* Scope.make();
    const { variant, stateRef } = yield* makeVariant(
      scope,
      batches,
      (view) =>
        countingPendingReads(
          historyServiceOf(storageSeenByWallet?.(storage, view) ?? storage, indexer, lookups),
          pendingReads,
        ),
      changeFor,
    );

    // What a snapshot taken at each state change would be saved with: the hashes the history held at that moment.
    const historyAtEachState = yield* Ref.make<readonly (readonly string[])[]>([]);
    const watching = yield* Deferred.make<void>();
    const watcher = yield* stateRef.changes.pipe(
      Stream.runForEach(() =>
        Effect.promise(() => storage.getAll()).pipe(
          Effect.flatMap((entries) => Ref.update(historyAtEachState, (all) => [...all, entries.map((e) => e.hash)])),
          Effect.zipRight(Deferred.succeed(watching, undefined)),
        ),
      ),
      Effect.fork,
    );
    // Sync only once the watcher has seen the starting state, so it observes every state the sync moves to.
    yield* Deferred.await(watching);

    // Forked, so a sync that keeps failing and retrying cannot hold the test up; the clock is moved on regardless.
    const syncing = yield* variant
      .startSync(null)
      .pipe(Stream.runDrain, Effect.provideService(Scope.Scope, scope), Effect.repeatN(syncRuns - 1), Effect.fork);
    yield* TestClock.adjust(settleFor);
    const observed = {
      historyAtEachState: yield* Ref.get(historyAtEachState),
      entries: yield* Effect.promise(() => storage.getAll()),
      pendingReads: yield* Ref.get(pendingReads),
      lookups: yield* Ref.get(lookups),
    };

    yield* Fiber.interrupt(syncing);
    yield* Fiber.interrupt(watcher);
    yield* Scope.close(scope, Exit.void);
    return { ...observed, logs: [...logs] };
  }).pipe(
    Effect.provide(Layer.merge(TestContext.TestContext, Logger.replace(Logger.defaultLogger, recordingLogger))),
    Effect.runPromise,
  );
};

const entryOf = (entries: readonly Entry[], hash: string): Entry | undefined =>
  entries.find((entry) => entry.hash === hash);

const emptyStorage = (): Storage => new InMemoryTransactionHistoryStorage(ShieldedTransactionHistoryEntrySchema);

/** A history saved together with a snapshot taken while each of `hashes` was still being looked up. */
const storageWithPending = async (hashes: readonly string[]): Promise<Storage> => {
  const storage = emptyStorage();
  await Promise.all(
    hashes.map((hash) =>
      storage.gotApplied({
        hash,
        identifiers: [],
        protocolVersion: 1,
        shielded: { receivedCoins: [], spentCoins: [] },
        shieldedDetailsPending: true,
      }),
    ),
  );
  return storage;
};

const finalizedLifecycle = {
  status: 'finalized',
  finalizedBlock: { hash: block.hash, height: block.height, timestamp: new Date(block.timestamp) },
};

/** Nine hashes: one more than the wallet's eight concurrent indexer lookups. */
const nineHashes = Array.from({ length: 9 }, (_, i) => `tx-${i + 1}`);

describe('RunningV1Variant tx-history entries written before their details are known', () => {
  it('should look for pending entries once per wallet, however often its sync is started', async () => {
    const result = await runVariant({
      storage: emptyStorage(),
      indexer: answersFrom(Duration.zero),
      settleFor: Duration.minutes(1),
      syncRuns: 2,
    });

    expect(result.pendingReads).toBe(1);
  });

  it('should store an applied change as an incomplete entry before the state moves past it, so no snapshot is ahead of its history', async () => {
    // The indexer never answers within the test, so nothing but the applied-change write can put the entry there.
    const result = await runVariant({
      storage: emptyStorage(),
      batches: [['tx']],
      indexer: answersFrom(Duration.days(1)),
      settleFor: Duration.millis(1),
    });

    // The first observation is the state before the batch; every later one is a state that has moved past `tx`.
    expect(result.historyAtEachState.length).toBeGreaterThan(1);
    expect(result.historyAtEachState.slice(1).every((hashes) => hashes.includes('tx'))).toBe(true);
    const entry = entryOf(result.entries, 'tx');
    expect(entry?.lifecycle).toEqual({ status: 'finalized' });
    expect(entry?.shieldedDetailsPending).toBe(true);
    expect(entry?.shielded).toEqual({ receivedCoins: [], spentCoins: [] });
  });

  it('should fill in the details and clear the pending flag once the indexer answers', async () => {
    const result = await runVariant({
      storage: emptyStorage(),
      batches: [['tx']],
      indexer: answersFrom(Duration.minutes(10)),
      settleFor: Duration.hours(1),
    });

    const entry = entryOf(result.entries, 'tx');
    expect(entry?.lifecycle).toEqual(finalizedLifecycle);
    expect(entry?.status).toBe('SUCCESS');
    expect(entry?.identifiers).toEqual(['id-1']);
    expect(entry?.shieldedDetailsPending).toBe(false);
  });

  it('should complete an entry restored incomplete when the wallet starts, without any new sync update', async () => {
    const result = await runVariant({
      storage: await storageWithPending(['tx']),
      indexer: answersFrom(Duration.zero),
      settleFor: Duration.hours(1),
    });

    const entry = entryOf(result.entries, 'tx');
    expect(entry?.lifecycle).toEqual(finalizedLifecycle);
    expect(entry?.shieldedDetailsPending).toBe(false);
    expect(entry?.shielded).toEqual({ receivedCoins: [], spentCoins: [] });
  });

  it('should keep syncing and log the failure when the storage cannot record an applied change, and still write the entry once the indexer answers', async () => {
    const result = await runVariant({
      storage: emptyStorage(),
      batches: [['tx-unrecorded']],
      indexer: answersFrom(Duration.minutes(10)),
      settleFor: Duration.hours(1),
      storageSeenByWallet: (storage) =>
        storageWith(storage, { gotApplied: () => Promise.reject(new Error('storage quota exceeded')) }),
    });

    // The state moved past the batch: a history that cannot take the incomplete entry does not hold the balances back.
    expect(result.historyAtEachState.length).toBeGreaterThan(1);
    expect(result.logs.some(({ level, message }) => level === 'ERROR' && message.includes('tx-unrecorded'))).toBe(true);
    const entry = entryOf(result.entries, 'tx-unrecorded');
    expect(entry?.lifecycle).toEqual(finalizedLifecycle);
    expect(entry?.shieldedDetailsPending).toBe(false);
  });

  it('should complete a restored entry the indexer can answer for, however many others it cannot answer for yet', async () => {
    const result = await runVariant({
      storage: await storageWithPending(nineHashes),
      indexer: answersOnly(['tx-9']),
      settleFor: Duration.minutes(2),
    });

    expect(entryOf(result.entries, 'tx-9')?.lifecycle).toEqual(finalizedLifecycle);
    expect(entryOf(result.entries, 'tx-9')?.shieldedDetailsPending).toBe(false);
  });

  it('should complete an applied change the indexer can answer for, however many others in its batch it cannot answer for yet', async () => {
    const result = await runVariant({
      storage: emptyStorage(),
      batches: [nineHashes],
      indexer: answersOnly(['tx-9']),
      settleFor: Duration.minutes(2),
    });

    expect(entryOf(result.entries, 'tx-9')?.lifecycle).toEqual(finalizedLifecycle);
    expect(entryOf(result.entries, 'tx-9')?.shieldedDetailsPending).toBe(false);
  });

  it('should warn each time reading the pending entries fails, and complete them once a read succeeds', async () => {
    // Test setup: the storage is promise-based, so its failed reads are counted outside the Effect.
    const failedReads: string[] = [];
    const result = await runVariant({
      storage: await storageWithPending(['tx']),
      indexer: answersFrom(Duration.zero),
      settleFor: Duration.hours(1),
      storageSeenByWallet: (storage) =>
        storageWith(storage, {
          getAll: () => {
            if (failedReads.length < 2) {
              failedReads.push('getAll');
              return Promise.reject(new Error('storage unavailable'));
            }
            return storage.getAll();
          },
        }),
    });

    expect(failedReads).toHaveLength(2);
    expect(result.logs.filter(({ level }) => level === 'WARN')).toHaveLength(2);
    expect(entryOf(result.entries, 'tx')?.lifecycle).toEqual(finalizedLifecycle);
    expect(entryOf(result.entries, 'tx')?.shieldedDetailsPending).toBe(false);
  });

  it('should look each transaction up once when a restored entry is pending and a new batch applies another', async () => {
    const result = await runVariant({
      storage: await storageWithPending(['tx-restored']),
      batches: [['tx-new']],
      indexer: answersFrom(Duration.zero),
      settleFor: Duration.hours(1),
    });

    expect(result.lookups.map(({ hash }) => hash).sort()).toEqual(['tx-new', 'tx-restored']);
  });

  it('should store each applied change while the committed state is still the one the change was applied over', async () => {
    // Test setup: each write is observed from inside the storage, synchronously with the wallet's own call.
    const writes: { readonly hash: string; readonly stateMovedPast: boolean }[] = [];
    await runVariant({
      storage: emptyStorage(),
      batches: [['tx-1'], ['tx-2']],
      indexer: answersFrom(Duration.days(1)),
      settleFor: Duration.millis(1),
      storageSeenByWallet: (storage, wallet) =>
        storageWith(storage, {
          gotApplied: (entry) => {
            writes.push({ hash: entry.hash, stateMovedPast: wallet.committed() !== wallet.appliedOver(entry.hash) });
            return storage.gotApplied(entry);
          },
        }),
    });

    expect(writes).toEqual([
      { hash: 'tx-1', stateMovedPast: false },
      { hash: 'tx-2', stateMovedPast: false },
    ]);
  });

  it('should store the incomplete entry with the coins the change received and spent', async () => {
    const coin = (value: bigint, mtIndex: bigint) => ({
      type: '00'.repeat(32),
      nonce: '01'.repeat(32),
      value,
      mtIndex,
    });
    const result = await runVariant({
      storage: emptyStorage(),
      batches: [['tx']],
      indexer: answersFrom(Duration.days(1)),
      settleFor: Duration.millis(1),
      changeFor: (source) => ({
        source,
        receivedCoins: [{ type: '00'.repeat(32), nonce: '01'.repeat(32), value: 10n, mt_index: 3n }],
        spentCoins: [{ type: '00'.repeat(32), nonce: '01'.repeat(32), value: 4n, mt_index: 1n }],
      }),
    });

    const entry = entryOf(result.entries, 'tx');
    expect(entry?.shieldedDetailsPending).toBe(true);
    expect(entry?.shielded).toEqual({ receivedCoins: [coin(10n, 3n)], spentCoins: [coin(4n, 1n)] });
  });

  it('should try a lookup the indexer cannot answer yet again about a minute later, neither much sooner nor much later', async () => {
    const result = await runVariant({
      storage: emptyStorage(),
      batches: [['tx']],
      indexer: answersFrom(Duration.days(1)),
      // A minute with jitter is 48 to 72 seconds.
      settleFor: Duration.seconds(73),
    });

    const times = result.lookups.filter(({ hash }) => hash === 'tx').map(({ atMillis }) => atMillis);
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(47_000);
  });

  it('should look a transaction up once when the indexer refuses the query, since waiting cannot change the answer', async () => {
    const result = await runVariant({
      storage: emptyStorage(),
      batches: [['tx']],
      indexer: refusesAll,
      settleFor: Duration.hours(1),
    });

    expect(result.lookups.filter(({ hash }) => hash === 'tx')).toHaveLength(1);
    expect(entryOf(result.entries, 'tx')?.shieldedDetailsPending).toBe(true);
    expect(result.logs.some(({ level, message }) => level === 'ERROR' && message.includes('tx'))).toBe(true);
  });

  it('should complete, in a wallet restored from a saved history, an entry the saving wallet stored before its details were known', async () => {
    const saving = emptyStorage();
    await runVariant({
      storage: saving,
      batches: [['tx']],
      indexer: answersFrom(Duration.days(1)),
      settleFor: Duration.millis(1),
    });
    const restored = InMemoryTransactionHistoryStorage.restore(
      await saving.serialize(),
      ShieldedTransactionHistoryEntrySchema,
    );
    expect((await restored.get('tx'))?.shieldedDetailsPending).toBe(true);

    const result = await runVariant({
      storage: restored,
      indexer: answersFrom(Duration.zero),
      settleFor: Duration.hours(1),
    });

    const entry = entryOf(result.entries, 'tx');
    expect(entry?.lifecycle).toEqual(finalizedLifecycle);
    expect(entry?.shieldedDetailsPending).toBe(false);
  });

  it('should stop the lookups of a variant whose scope closes, and let the next variant complete the entry it left pending', async () => {
    const storage = emptyStorage();
    const result = await Effect.gen(function* () {
      const firstLookups = yield* Ref.make<readonly Lookup[]>([]);
      const firstScope = yield* Scope.make();
      const { variant: first } = yield* makeVariant(firstScope, [['tx']], () =>
        historyServiceOf(storage, answersFrom(Duration.days(1)), firstLookups),
      );
      yield* first.startSync(null).pipe(Stream.runDrain, Effect.provideService(Scope.Scope, firstScope));
      yield* TestClock.adjust(Duration.seconds(1));
      yield* Scope.close(firstScope, Exit.void);
      const firstLookupsAtHandOver = (yield* Ref.get(firstLookups)).length;

      const secondLookups = yield* Ref.make<readonly Lookup[]>([]);
      const secondScope = yield* Scope.make();
      const { variant: second } = yield* makeVariant(secondScope, [], () =>
        historyServiceOf(storage, answersFrom(Duration.zero), secondLookups),
      );
      yield* second.startSync(null).pipe(Stream.runDrain, Effect.provideService(Scope.Scope, secondScope));
      yield* TestClock.adjust(Duration.hours(1));
      const observed = {
        firstLookupsAtHandOver,
        firstLookupsAfter: (yield* Ref.get(firstLookups)).length,
        entry: yield* Effect.promise(() => storage.get('tx')),
      };
      yield* Scope.close(secondScope, Exit.void);
      return observed;
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(result.firstLookupsAtHandOver).toBe(1);
    // An hour on the shared clock would have brought the first variant's retry back about sixty times.
    expect(result.firstLookupsAfter).toBe(1);
    expect(result.entry?.lifecycle).toEqual(finalizedLifecycle);
    expect(result.entry?.shieldedDetailsPending).toBe(false);
  });
});
