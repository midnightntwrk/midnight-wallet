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
  DustSecretKey,
  type DustStateChanges,
  type FinalizedTransaction,
  LedgerParameters,
} from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Duration, Effect, Exit, pipe, Ref, Scope, Stream, SubscriptionRef, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { chooseCoin, makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { RunningV1Variant } from '../RunningV1Variant.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { type ChangesResult, type SyncCapability, type SyncService } from '../Sync.js';
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
  updates: () => Stream.fromIterable(batches),
  blockData: () =>
    Effect.succeed({
      hash: 'block-hash',
      height: 1,
      ledgerParameters: LedgerParameters.initialParameters(),
      timestamp: new Date(0),
      zswapEndIndex: 0,
      dustCommitmentEndIndex: 0,
      dustGenerationEndIndex: 0,
      dustCommitmentMerkleTreeRoot: 'dust-commitment-root',
      dustGenerationMerkleTreeRoot: 'dust-generation-root',
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

const variantContextOf = (
  batches: readonly FakeSyncUpdate[],
  transactionHistoryService: TransactionHistoryService,
): RunningV1Variant.Context<string, FakeSyncUpdate, FinalizedTransaction, null> => {
  const keysCapability = makeDefaultKeysCapability();
  const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability }));
  return {
    serializationCapability: makeDefaultV1SerializationCapability(),
    syncService: syncServiceOf(batches),
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
        { stateRef },
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

/**
 * The projections sync service ends its `updates` stream after a single pass, where the event-based service's is a
 * long-lived subscription. Background sync must therefore re-run a finite `updates`, or a wallet built on the
 * projections service converges once and never observes anything again — and the existing `Stream.retry` does not help,
 * because it re-runs on failure, not on completion.
 *
 * A service declares that it needs this by setting `backgroundRepeatDelay`; a service with a long-lived `updates` omits
 * it and must be unaffected.
 */
describe('RunningV1Variant background sync of a finite updates stream', () => {
  /**
   * A service whose `updates` completes after emitting once. It records the `appliedIndex` of the state each pass was
   * handed, so a test can tell whether later passes see the state earlier ones produced or a stale snapshot.
   */
  const finiteSyncServiceOf = (
    seenAppliedIndexes: Ref.Ref<readonly number[]>,
    backgroundRepeatDelay?: Duration.DurationInput,
  ): SyncService<CoreWallet, null, FakeSyncUpdate> => ({
    ...syncServiceOf([]),
    updates: (state) =>
      pipe(
        Ref.update(seenAppliedIndexes, (seen) => [...seen, Number(state.progress.appliedIndex)]),
        Stream.fromEffect,
        Stream.as(['tx'] as FakeSyncUpdate),
      ),
    ...(backgroundRepeatDelay !== undefined ? { backgroundRepeatDelay } : {}),
  });

  /** Advances the applied index by one per pass, so the next pass can be seen to start from the new value. */
  const advancingCapability: SyncCapability<CoreWallet, FakeSyncUpdate, ChangesResult> = {
    applyUpdate: (state, sources) => [
      CoreWallet.updateProgress(state, { appliedIndex: state.progress.appliedIndex + 1n }),
      { changes: sources.map(changeOf), protocolVersion: 1 },
    ],
  };

  const runBackgroundFor = async (
    backgroundRepeatDelay: Duration.DurationInput | undefined,
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
        { stateRef },
        {
          ...variantContextOf([], { getTransactionDetails: () => Effect.die('unused'), put: () => Effect.void }),
          syncService: finiteSyncServiceOf(seen, backgroundRepeatDelay),
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
    const seen = await runBackgroundFor(Duration.seconds(5), Duration.seconds(12));

    expect(seen).toEqual([0, 1, 2]);
  });

  it('leaves a service that declares no delay running exactly one pass', async () => {
    // Guards the event-based service: its `updates` never completes in production, and nothing here may start
    // re-running passes behind its back.
    const seen = await runBackgroundFor(undefined, Duration.minutes(5));

    expect(seen).toEqual([0]);
  });

  it('keeps an explicitly driven sync to a single pass even when a repeat delay is declared', async () => {
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
        { stateRef },
        {
          ...variantContextOf([], { getTransactionDetails: () => Effect.die('unused'), put: () => Effect.void }),
          syncService: finiteSyncServiceOf(seenRef, Duration.seconds(5)),
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
});
