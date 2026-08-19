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
} from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  Deferred,
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

      const countingSyncService: SyncService<CoreWallet, null, FakeSyncUpdate> = {
        updates: () =>
          Stream.unwrap(
            Ref.update(subscriptions, (n) => n + 1).pipe(
              Effect.as(Stream.fromIterable([['a1']] as readonly FakeSyncUpdate[])),
            ),
          ),
        blockData,
      };

      const { stateRef, scope } = yield* stateAndScope();
      const variant = new RunningV1Variant(
        scope,
        { stateRef, activationRange: fullRange },
        variantContextOf([], immediateHistoryService(recorded), countingSyncService),
      );

      yield* variant.sync(null);
      yield* variant.sync(null);
      yield* Scope.close(scope, Exit.void);

      return yield* Ref.get(subscriptions);
    }).pipe(Effect.runPromise);

    expect(result).toBe(2);
  });
});
