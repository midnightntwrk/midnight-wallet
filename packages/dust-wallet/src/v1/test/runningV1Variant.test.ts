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
import {
  DustLocalState,
  DustSecretKey,
  type DustStateChanges,
  type FinalizedTransaction,
  LedgerParameters,
} from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  Chunk,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  pipe,
  Ref,
  Schedule,
  Scope,
  Stream,
  SubscriptionRef,
  TestClock,
  TestContext,
} from 'effect';
import { describe, expect, it } from 'vitest';
import { chooseCoin, makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet, PublicKey } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { StateChange, VersionChangeType } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { RunningV1Variant, syncRetrySchedule } from '../RunningV1Variant.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { BackgroundRepeat, type ChangesResult, type SyncCapability, type SyncService } from '../Sync.js';
import { makeDefaultTransactingCapability } from '../Transacting.js';
import { type TransactionHistoryService } from '../TransactionHistory.js';

const networkId = NetworkId.NetworkId.Undeployed;

/**
 * A sync update in this harness is simply the batch of tx hashes it carries; the fake sync capability below turns each
 * hash into a state change whose `source` is that hash. Only `source` is read by the variant's tx-history fan-out, so
 * the utxo arrays stay empty.
 */
type FakeSyncUpdate = readonly string[];

const changeOf = (source: string): DustStateChanges => ({
  source,
  receivedUtxos: [],
  spentUtxos: [],
});

const syncServiceOf = (batches: readonly FakeSyncUpdate[]): SyncService<CoreWallet, null, FakeSyncUpdate> => ({
  backgroundRepeat: BackgroundRepeat.Once(),
  updates: () => Stream.fromIterable(batches),
  blockData: () =>
    Effect.succeed({
      hash: 'block-hash',
      height: 1,
      protocolVersion: 0,
      ledgerParameters: LedgerParameters.initialParameters(),
      timestamp: new Date(0),
    }),
});

const fakeSyncCapability: SyncCapability<CoreWallet, FakeSyncUpdate, ChangesResult> = {
  applyUpdate: (state, sources) => [state, { changes: sources.map(changeOf), protocolVersion: 1 }],
};

type FanOutCounters = {
  inFlight: Ref.Ref<number>;
  maxInFlight: Ref.Ref<number>;
  recorded: Ref.Ref<number>;
};

/**
 * A tx-history service whose `getTransactionDetails` parks on the (test) clock while counting how many lookups are in
 * flight at once. Overlapping sync batches therefore overlap here, which is exactly what the test observes.
 */
const trackingHistoryService = (counters: FanOutCounters): TransactionHistoryService => ({
  getTransactionDetails: (hash) =>
    Effect.gen(function* () {
      const current = yield* Ref.updateAndGet(counters.inFlight, (n) => n + 1);
      yield* Ref.update(counters.maxInFlight, (max) => Math.max(max, current));
      yield* Effect.sleep(Duration.seconds(10));
      yield* Ref.update(counters.inFlight, (n) => n - 1);
      return {
        hash,
        block: { hash: 'block-hash', height: 1, timestamp: 1_700_000_000 },
        status: 'SUCCESS' as const,
        identifiers: [],
        fees: null,
      };
    }),
  put: () => Ref.update(counters.recorded, (n) => n + 1),
});

/** A tx-history service that records without parking, for the tests that run on the real clock. */
const immediateHistoryService = (recorded: Ref.Ref<number>): TransactionHistoryService => ({
  getTransactionDetails: (hash) =>
    Effect.succeed({
      hash,
      block: { hash: 'block-hash', height: 1, timestamp: 1_700_000_000 },
      status: 'SUCCESS' as const,
      identifiers: [],
      fees: null,
    }),
  put: () => Ref.update(recorded, (n) => n + 1),
});

/**
 * A sync service that counts how many times it was asked for updates and whose stream ends after a single batch.
 *
 * @remarks
 *   The shape of a source that hands over a snapshot rather than following the chain — which is what the projections sync
 *   service is. How often it was opened is therefore how many synchronization passes actually ran.
 */
const countingSyncService = (subscriptions: Ref.Ref<number>): SyncService<CoreWallet, null, FakeSyncUpdate> => ({
  backgroundRepeat: BackgroundRepeat.Once(),
  updates: () =>
    Stream.unwrap(
      Ref.update(subscriptions, (n) => n + 1).pipe(
        Effect.as(Stream.fromIterable([['a1']] as readonly FakeSyncUpdate[])),
      ),
    ),
  blockData: () => syncServiceOf([]).blockData(),
});

const variantContextOf = (
  batches: readonly FakeSyncUpdate[],
  transactionHistoryService: TransactionHistoryService,
  syncService: SyncService<CoreWallet, null, FakeSyncUpdate> = syncServiceOf(batches),
): RunningV1Variant.Context<string, FakeSyncUpdate, FinalizedTransaction, null> => {
  const keysCapability = makeDefaultKeysCapability();
  const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability }));
  return {
    serializationCapability: makeDefaultV1SerializationCapability(),
    syncService,
    syncCapability: fakeSyncCapability,
    transactingCapability: makeDefaultTransactingCapability(
      { networkId, costParameters: { feeBlocksMargin: 5 } },
      () => ({ coinSelection: chooseCoin, coinsAndBalancesCapability, keysCapability }),
    ),
    coinsAndBalancesCapability,
    keysCapability,
    coinSelection: chooseCoin,
    transactionHistoryService,
  };
};

describe('RunningV1Variant.startSync tx-history fan-out', () => {
  it('caps in-flight lookups at 8 across overlapping sync batches, and still records every change', async () => {
    // Two batches of 6: each batch alone is below the fan-out limit of 8, so any excess concurrency can only come
    // from batches failing to share a single cap.
    const batches: readonly FakeSyncUpdate[] = [
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
      ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
    ];

    const result = await Effect.gen(function* () {
      const counters: FanOutCounters = {
        inFlight: yield* Ref.make(0),
        maxInFlight: yield* Ref.make(0),
        recorded: yield* Ref.make(0),
      };
      const secretKey = DustSecretKey.fromSeed(Buffer.alloc(32, 1));
      const stateRef = yield* SubscriptionRef.make(
        CoreWallet.initEmpty(LedgerParameters.initialParameters().dust, secretKey, networkId),
      );
      const scope = yield* Scope.make();
      const variant = new RunningV1Variant(
        scope,
        {
          stateRef,
          activationRange: ProtocolVersion.makeRange(
            ProtocolVersion.MinSupportedVersion,
            ProtocolVersion.MaxSupportedVersion,
          ),
        },
        variantContextOf(batches, trackingHistoryService(counters)),
      );

      // Drain the sync stream: both batches apply and fork their tx-history lookups into the variant scope.
      yield* variant.startSync(null).pipe(Stream.runDrain, Effect.provideService(Scope.Scope, scope));
      // Let every forked lookup start and park on the clock; none can finish yet (each holds for 10s).
      yield* TestClock.adjust(Duration.millis(1));
      const maxInFlight = yield* Ref.get(counters.maxInFlight);

      // Now let the queue drain fully and check nothing was dropped by the cap.
      yield* TestClock.adjust(Duration.minutes(1));
      const recorded = yield* Ref.get(counters.recorded);

      yield* Scope.close(scope, Exit.void);
      return { maxInFlight, recorded };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    // The cap must hold globally: 12 pending lookups against a shared limit of 8 saturate it exactly.
    expect(result.maxInFlight).toBe(8);
    // The cap only queues work, it never drops it.
    expect(result.recorded).toBe(12);
  });
});

describe('RunningV1Variant sync serialization', () => {
  const stateAndScope = () =>
    Effect.gen(function* () {
      const secretKey = DustSecretKey.fromSeed(Buffer.alloc(32, 1));
      const stateRef = yield* SubscriptionRef.make(
        CoreWallet.initEmpty(LedgerParameters.initialParameters().dust, secretKey, networkId),
      );
      const scope = yield* Scope.make();
      return { stateRef, scope };
    });

  const fullRange = ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion);

  const blockData = () =>
    Effect.succeed({
      hash: 'block-hash',
      height: 1,
      protocolVersion: 0,
      ledgerParameters: LedgerParameters.initialParameters(),
      timestamp: new Date(0),
    });

  it('ignores a second start while the first sync stream is still running', async () => {
    // The first subscription is held open by a gate; a second start must not open another one against the same
    // state, which would apply every update twice.
    const result = await Effect.gen(function* () {
      const subscriptions = yield* Ref.make(0);
      const recorded = yield* Ref.make(0);
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();

      const gatedSyncService: SyncService<CoreWallet, null, FakeSyncUpdate> = {
        backgroundRepeat: BackgroundRepeat.Once(),
        updates: () =>
          Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* Ref.updateAndGet(subscriptions, (n) => n + 1);
              if (subscription > 1) {
                // Only the first subscription is held open, so a missing lock shows up as a failed
                // assertion rather than a hang.
                return Stream.fromIterable([['b1']] as readonly FakeSyncUpdate[]);
              }
              yield* Deferred.succeed(started, undefined);
              return Stream.fromIterable([['a1']] as readonly FakeSyncUpdate[]).pipe(
                Stream.concat(Stream.fromEffect(Deferred.await(gate)).pipe(Stream.drain)),
              );
            }),
          ),
        blockData,
      };

      const { stateRef, scope } = yield* stateAndScope();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange: fullRange },
        variantContextOf([], immediateHistoryService(recorded), gatedSyncService),
      );

      const first = yield* Effect.fork(
        variant.startSync(null).pipe(Stream.runDrain, Effect.provideService(Scope.Scope, scope)),
      );
      yield* Deferred.await(started);

      yield* variant.startSync(null).pipe(Stream.runDrain, Effect.provideService(Scope.Scope, scope));
      const subscriptionsDuringFirst = yield* Ref.get(subscriptions);

      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Scope.close(scope, Exit.void);

      return { subscriptionsDuringFirst, recorded: yield* Ref.get(recorded) };
    }).pipe(Effect.runPromise);

    expect(result.subscriptionsDuringFirst).toBe(1);
    expect(result.recorded).toBe(1);
  });

  it('releases the lock when the stream ends, so a one-shot sync can be run again', async () => {
    // `sync` runs the same stream to completion instead of forking it into the background; the lock must not
    // outlive the run, or the second call would silently do nothing.
    const result = await Effect.gen(function* () {
      const subscriptions = yield* Ref.make(0);
      const recorded = yield* Ref.make(0);

      const { stateRef, scope } = yield* stateAndScope();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange: fullRange },
        variantContextOf([], immediateHistoryService(recorded), countingSyncService(subscriptions)),
      );

      yield* variant.sync(null);
      yield* variant.sync(null);
      yield* Scope.close(scope, Exit.void);

      return yield* Ref.get(subscriptions);
    }).pipe(Effect.runPromise);

    expect(result).toBe(2);
  });

  it('runs a further pass after a background drain whose stream ended', async () => {
    // The twin of the V2 variant's pin. This variant never runs the projections source — no published ledger-v8
    // ledger has the state APIs it needs — but the runner is shared by both sync styles, so the rule it depends on is
    // asserted here too rather than left to hold by accident.
    const result = await Effect.gen(function* () {
      const subscriptions = yield* Ref.make(0);
      const recorded = yield* Ref.make(0);

      const { stateRef, scope } = yield* stateAndScope();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange: fullRange },
        variantContextOf([], immediateHistoryService(recorded), countingSyncService(subscriptions)),
      );

      yield* variant.startSyncInBackground(null);
      // Nothing in the background pass waits on anything: once the source has been opened, the fiber only has to be
      // let run. Waiting for the count and then yielding the thread is enough for it to have finished.
      yield* Effect.repeat(Ref.get(subscriptions), { until: (count) => count > 0 });
      yield* Effect.sleep(Duration.millis(50));

      yield* variant.sync(null);
      const opened = yield* Ref.get(subscriptions);
      yield* Scope.close(scope, Exit.void);

      return opened;
    }).pipe(Effect.runPromise);

    expect(result).toBe(2);
  });
});

describe('RunningV1Variant.state protocol version signalling', () => {
  /** The variant under test owns `[0, 7)`; 7 and above belong to whatever variant comes next. */
  const activationRange = ProtocolVersion.makeRange(
    ProtocolVersion.MinSupportedVersion,
    ProtocolVersion.ProtocolVersion(7n),
  );

  const walletAtVersion = (protocolVersion: bigint): CoreWallet =>
    CoreWallet.restore(
      new DustLocalState(LedgerParameters.initialParameters().dust),
      PublicKey.fromSecretKey(DustSecretKey.fromSeed(Buffer.alloc(32, 1))),
      [],
      { appliedIndex: 0n, highestRelevantWalletIndex: 0n, highestIndex: 0n, highestRelevantIndex: 0n },
      protocolVersion,
      networkId,
    );

  const versionChangesOf = (changes: Chunk.Chunk<StateChange.StateChange<CoreWallet>>): readonly bigint[] =>
    Chunk.toArray(changes)
      .filter(StateChange.isVersionChange)
      .map(({ change }) => {
        expect(VersionChangeType.isVersion(change)).toBe(true);
        return VersionChangeType.isVersion(change) ? change.version : -1n;
      });

  /**
   * Drains the variant's state stream for a fixed window and returns everything it emitted. A bounded window rather
   * than `Stream.take(n)` on purpose: the point of these tests is _how many_ version changes appear, so a missing one
   * has to surface as a failed assertion, not as a hang.
   */
  const emissionsWithin = (
    initialState: CoreWallet,
    act: (stateRef: SubscriptionRef.SubscriptionRef<CoreWallet>) => Effect.Effect<void> = () => Effect.void,
  ): Promise<Chunk.Chunk<StateChange.StateChange<CoreWallet>>> =>
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make(initialState);
      const scope = yield* Scope.make();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange },
        variantContextOf(
          [],
          trackingHistoryService({
            inFlight: yield* Ref.make(0),
            maxInFlight: yield* Ref.make(0),
            recorded: yield* Ref.make(0),
          }),
        ),
      );

      const collector = yield* Effect.fork(
        variant.state.pipe(Stream.interruptAfter(Duration.millis(300)), Stream.runCollect),
      );
      yield* Effect.sleep(Duration.millis(50));
      yield* act(stateRef);
      const collected = yield* Fiber.join(collector);
      yield* Scope.close(scope, Exit.void);
      return collected;
    }).pipe(Effect.runPromise);

  it('emits exactly one VersionChange when the state transitions to a new protocol version', async () => {
    const collected = await emissionsWithin(walletAtVersion(0n), (stateRef) =>
      SubscriptionRef.set(stateRef, walletAtVersion(5n)),
    );

    expect(versionChangesOf(collected)).toEqual([5n]);
  });

  it('emits an immediate healing VersionChange when the initial state is outside the activation range', async () => {
    // A snapshot serialized after the version was annotated but before the runtime migrated restores here. Without a
    // healing emission the wallet would sit on a version it does not own and never hand over.
    const collected = await emissionsWithin(walletAtVersion(9n));

    expect(versionChangesOf(collected)).toEqual([9n]);
  });

  it('emits no VersionChange when the initial state is inside the activation range', async () => {
    const collected = await emissionsWithin(walletAtVersion(3n));

    expect(versionChangesOf(collected)).toEqual([]);
    // The stream still reports the state itself, so an empty result would be a false pass.
    expect(Chunk.toArray(collected).filter(StateChange.isState).length).toBeGreaterThan(0);
  });
});

/**
 * The projections sync service ends its `updates` stream after a single pass, where the event-based service's is a
 * long-lived subscription. Background sync must therefore re-run a finite `updates`, or a wallet built on the
 * projections service converges once and never observes anything again — and the existing `Stream.retry` does not help,
 * because it re-runs on failure, not on completion.
 *
 * A service declares that it needs this as `BackgroundRepeat.WithDelay`; one with a long-lived `updates` declares
 * `BackgroundRepeat.Once` and must be unaffected.
 */
describe('RunningV1Variant background sync of a finite updates stream', () => {
  /**
   * A service whose `updates` completes after emitting once. It records the `appliedIndex` of the state each pass was
   * handed, so a test can tell whether later passes see the state earlier ones produced or a stale snapshot.
   */
  const finiteSyncServiceOf = (
    seenAppliedIndexes: Ref.Ref<readonly number[]>,
    backgroundRepeat: BackgroundRepeat,
  ): SyncService<CoreWallet, null, FakeSyncUpdate> => ({
    ...syncServiceOf([]),
    backgroundRepeat,
    updates: (state) =>
      pipe(
        Ref.update(seenAppliedIndexes, (seen) => [...seen, Number(state.progress.appliedIndex)]),
        Stream.fromEffect,
        Stream.as(['tx'] as FakeSyncUpdate),
      ),
  });

  /** Stands in for a client an indexer layer hands the sync source for the duration of a pass. */
  class PassResource extends Context.Tag('PassResource')<PassResource, { readonly serial: number }>() {}

  /**
   * The shape every indexer client layer has: `Layer.effect` over an `acquireRelease`, so the layer declares `Scope` as
   * an input requirement rather than discharging one of its own, and its finalizer attaches to whichever scope the
   * stream is ultimately run in. A pass that does not get a scope of its own therefore leaves its client open.
   */
  const passResourceLayer = (
    acquired: Ref.Ref<number>,
    released: Ref.Ref<number>,
  ): Layer.Layer<PassResource, never, Scope.Scope> =>
    Layer.effect(
      PassResource,
      Effect.acquireRelease(Ref.updateAndGet(acquired, (n) => n + 1).pipe(Effect.map((serial) => ({ serial }))), () =>
        Ref.update(released, (n) => n + 1),
      ),
    );

  /**
   * A finite service that holds a scoped resource for the length of each pass, the way the projections service holds
   * its subscription and query clients. The stream reads the tag so the layer is genuinely built, not elided.
   */
  const resourceHoldingSyncServiceOf = (
    acquired: Ref.Ref<number>,
    released: Ref.Ref<number>,
    backgroundRepeat: BackgroundRepeat,
  ): SyncService<CoreWallet, null, FakeSyncUpdate> => ({
    ...syncServiceOf([]),
    backgroundRepeat,
    updates: () =>
      pipe(
        PassResource,
        Stream.fromEffect,
        Stream.as(['tx'] as FakeSyncUpdate),
        Stream.provideSomeLayer(passResourceLayer(acquired, released)),
      ),
  });

  /** The whole timeline: nothing in this block is about which versions the variant owns. */
  const wholeRange = ProtocolVersion.makeRange(
    ProtocolVersion.MinSupportedVersion,
    ProtocolVersion.MaxSupportedVersion,
  );

  /** Advances the applied index by one per pass, so the next pass can be seen to start from the new value. */
  const advancingCapability: SyncCapability<CoreWallet, FakeSyncUpdate, ChangesResult> = {
    applyUpdate: (state, sources) => [
      CoreWallet.updateProgress(state, { appliedIndex: state.progress.appliedIndex + 1n }),
      { changes: sources.map(changeOf), protocolVersion: 1 },
    ],
  };

  const runBackgroundFor = async (
    backgroundRepeat: BackgroundRepeat,
    elapsed: Duration.DurationInput,
  ): Promise<readonly number[]> =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly number[]>([]);
      const secretKey = DustSecretKey.fromSeed(Buffer.alloc(32, 1));
      const stateRef = yield* SubscriptionRef.make(
        CoreWallet.initEmpty(LedgerParameters.initialParameters().dust, secretKey, networkId),
      );
      const scope = yield* Scope.make();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange: wholeRange },
        {
          ...variantContextOf([], { getTransactionDetails: () => Effect.die('unused'), put: () => Effect.void }),
          syncService: finiteSyncServiceOf(seen, backgroundRepeat),
          syncCapability: advancingCapability,
        },
      );

      yield* variant.startSyncInBackground(null);
      yield* TestClock.adjust(elapsed);
      const result = yield* Ref.get(seen);
      yield* Scope.close(scope, Exit.void);
      return result;
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

  it('re-runs the pass on the declared delay, each pass starting from the state the last one produced', async () => {
    // 5s delay over 12s of clock: the initial pass plus two repeats. Each pass must observe the applied index the
    // previous pass advanced, which is only true if the repeat re-reads state rather than reusing a snapshot.
    const seen = await runBackgroundFor(
      BackgroundRepeat.WithDelay({ delay: Duration.seconds(5) }),
      Duration.seconds(12),
    );

    expect(seen).toEqual([0, 1, 2]);
  });

  it('leaves a service that declares `Once` running exactly one pass', async () => {
    // Guards the event-based service: its `updates` never completes in production, and nothing here may start
    // re-running passes behind its back.
    const seen = await runBackgroundFor(BackgroundRepeat.Once(), Duration.minutes(5));

    expect(seen).toEqual([0]);
  });

  it('keeps an explicitly driven sync to a single pass even when a repeat is declared', async () => {
    // `sync()` backs `facade.doSync()`, which must return. If the repeat leaked into it, the caller would never be
    // handed control back.
    const seen = await Effect.gen(function* () {
      const seenRef = yield* Ref.make<readonly number[]>([]);
      const secretKey = DustSecretKey.fromSeed(Buffer.alloc(32, 1));
      const stateRef = yield* SubscriptionRef.make(
        CoreWallet.initEmpty(LedgerParameters.initialParameters().dust, secretKey, networkId),
      );
      const scope = yield* Scope.make();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange: wholeRange },
        {
          ...variantContextOf([], { getTransactionDetails: () => Effect.die('unused'), put: () => Effect.void }),
          syncService: finiteSyncServiceOf(seenRef, BackgroundRepeat.WithDelay({ delay: Duration.seconds(5) })),
          syncCapability: advancingCapability,
        },
      );

      yield* variant.sync(null);
      yield* TestClock.adjust(Duration.minutes(5));
      const result = yield* Ref.get(seenRef);
      yield* Scope.close(scope, Exit.void);
      return result;
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    expect(seen).toEqual([0]);
  });

  it('releases each pass’s resources as the pass ends, rather than piling them on the variant scope', async () => {
    // Every repeat rebuilds the source's layers, so a repeat that has no scope of its own hands each pass's clients to
    // the variant scope, where they stay until the wallet stops. At a five-second interval that is a fresh websocket
    // and HTTP client every five seconds for the life of the wallet.
    const counts = await Effect.gen(function* () {
      const acquiredRef = yield* Ref.make(0);
      const releasedRef = yield* Ref.make(0);
      const secretKey = DustSecretKey.fromSeed(Buffer.alloc(32, 1));
      const stateRef = yield* SubscriptionRef.make(
        CoreWallet.initEmpty(LedgerParameters.initialParameters().dust, secretKey, networkId),
      );
      const scope = yield* Scope.make();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange: wholeRange },
        {
          ...variantContextOf([], { getTransactionDetails: () => Effect.die('unused'), put: () => Effect.void }),
          syncService: resourceHoldingSyncServiceOf(
            acquiredRef,
            releasedRef,
            BackgroundRepeat.WithDelay({ delay: Duration.seconds(5) }),
          ),
          syncCapability: advancingCapability,
        },
      );

      yield* variant.startSyncInBackground(null);
      yield* TestClock.adjust(Duration.seconds(12));
      const acquired = yield* Ref.get(acquiredRef);
      const released = yield* Ref.get(releasedRef);
      yield* Scope.close(scope, Exit.void);
      return { acquired, released };
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    // Read before the variant scope closes, so a release that only happens at shutdown does not count. Three passes in
    // twelve seconds at a five-second delay; only a pass still in flight may still be holding anything.
    expect(counts.acquired).toBe(3);
    expect(counts.released).toBeGreaterThanOrEqual(counts.acquired - 1);
  });

  it('ignores a second background start instead of running a second worker', async () => {
    // The sync lock serialises passes, not workers: it is released at the end of every pass, so it cannot stop a
    // second `start()` forking a worker of its own that polls alongside the first until the wallet stops.
    const seen = await Effect.gen(function* () {
      const seenRef = yield* Ref.make<readonly number[]>([]);
      const secretKey = DustSecretKey.fromSeed(Buffer.alloc(32, 1));
      const stateRef = yield* SubscriptionRef.make(
        CoreWallet.initEmpty(LedgerParameters.initialParameters().dust, secretKey, networkId),
      );
      const scope = yield* Scope.make();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange: wholeRange },
        {
          ...variantContextOf([], { getTransactionDetails: () => Effect.die('unused'), put: () => Effect.void }),
          syncService: finiteSyncServiceOf(seenRef, BackgroundRepeat.WithDelay({ delay: Duration.seconds(5) })),
          syncCapability: advancingCapability,
        },
      );

      // Offset so the two workers' passes cannot coincide and be hidden by the sync lock.
      yield* variant.startSyncInBackground(null);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* variant.startSyncInBackground(null);
      yield* TestClock.adjust(Duration.seconds(11));
      const result = yield* Ref.get(seenRef);
      yield* Scope.close(scope, Exit.void);
      return result;
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

    // One worker's three passes over twelve seconds. A second worker adds its own three, offset by a second.
    expect(seen).toEqual([0, 1, 2]);
  });
});

/**
 * A retry schedule is read far more often than it is measured, and the combinator that looks like it bounds the delay
 * may not touch it — `Schedule.map` rewrites a schedule's _output_ after the delay has been taken from it, so mapping
 * an exponential's output leaves the timing exactly as it was. These assert the delays themselves.
 */
describe('RunningV1Variant sync retry schedule', () => {
  /** The delays the schedule actually produces, in milliseconds, over its first `count` retries. */
  const delaysOf = (count: number): number[] =>
    Effect.runSync(
      pipe(
        Schedule.run(
          Schedule.delays(syncRetrySchedule),
          0,
          Array.from({ length: count }, (_, i) => i),
        ),
        Effect.map((delays) => Chunk.toArray(delays).map(Duration.toMillis)),
      ),
    );

  const CAP_MILLIS = 120_000;

  it('never backs off further than two minutes', () => {
    // 20 retries: unbounded doubling from one second reaches ~6 days here, so a wallet that cannot reach the indexer
    // stops retrying in any useful sense long before this — silently, because the pass fails into the retry rather
    // than out to the caller.
    const delays = delaysOf(20);

    expect(Math.max(...delays)).toBeLessThanOrEqual(CAP_MILLIS);
  });

  it('still backs off exponentially before it reaches the cap', () => {
    // The cap must not be bought by flattening the schedule: early retries stay close together so a transient
    // indexer blip is retried promptly.
    const delays = delaysOf(6);

    expect(delays[0]).toBeLessThan(2_000);
    expect(delays[5]).toBeGreaterThan(delays[0]);
    expect(delays[5]).toBeLessThanOrEqual(CAP_MILLIS);
  });

  it('jitters, so wallets retrying together do not resynchronize on the same instant', () => {
    // An unjittered schedule is deterministic, so two samplings match exactly — which is what puts a fleet of wallets
    // back in lockstep on the same instant after a shared outage. Jitter is what breaks that up, and the only
    // observable difference it makes is that two samplings disagree.
    expect(delaysOf(20)).not.toEqual(delaysOf(20));
  });
});
