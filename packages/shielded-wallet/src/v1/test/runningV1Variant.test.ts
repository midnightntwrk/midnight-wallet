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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  Chunk,
  Duration,
  Effect,
  Exit,
  Fiber,
  Ref,
  Scope,
  Stream,
  SubscriptionRef,
  TestClock,
  TestContext,
} from 'effect';
import { describe, expect, it } from 'vitest';
import { StateChange, VersionChangeType } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
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
 * the coin arrays stay empty.
 */
type FakeSyncUpdate = readonly string[];

const changeOf = (source: string): ledger.ZswapStateChanges => ({
  source,
  receivedCoins: [],
  spentCoins: [],
});

const syncServiceOf = (batches: readonly FakeSyncUpdate[]): SyncService<CoreWallet, null, FakeSyncUpdate> => ({
  updates: () => Stream.fromIterable(batches),
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
      };
    }),
  put: () => Ref.update(counters.recorded, (n) => n + 1),
});

const variantContextOf = (
  batches: readonly FakeSyncUpdate[],
  transactionHistoryService: TransactionHistoryService,
): RunningV1Variant.Context<string, FakeSyncUpdate, ledger.FinalizedTransaction, null> => {
  const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability();
  const keysCapability = makeDefaultKeysCapability();
  const coinSelection = () => undefined;
  return {
    serializationCapability: makeDefaultV1SerializationCapability(),
    syncService: syncServiceOf(batches),
    syncCapability: fakeSyncCapability,
    transactingCapability: makeDefaultTransactingCapability({ networkId }, () => ({
      coinSelection,
      coinsAndBalancesCapability,
      keysCapability,
    })),
    coinsAndBalancesCapability,
    keysCapability,
    coinSelection,
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
      const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));
      const stateRef = yield* SubscriptionRef.make(
        CoreWallet.init(new ledger.ZswapLocalState(), secretKeys, networkId),
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

describe('RunningV1Variant.state protocol version signalling', () => {
  /** The variant under test owns `[0, 7)`; 7 and above belong to whatever variant comes next. */
  const activationRange = ProtocolVersion.makeRange(
    ProtocolVersion.MinSupportedVersion,
    ProtocolVersion.ProtocolVersion(7n),
  );

  const walletAtVersion = (protocolVersion: bigint): CoreWallet =>
    CoreWallet.restore(
      new ledger.ZswapLocalState(),
      ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
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
