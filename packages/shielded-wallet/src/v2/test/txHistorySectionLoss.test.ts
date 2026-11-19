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
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Duration, Effect, Exit, Ref, Scope, Stream, SubscriptionRef, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { RunningV2Variant } from '../RunningV2Variant.js';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
import { type ChangesResult, type SyncCapability, type SyncService } from '../Sync.js';
import { makeDefaultTransactingCapability } from '../Transacting.js';
import { type TransactionDetails, type TransactionHistoryService } from '../TransactionHistory.js';
import { TransactionHistoryError } from '../WalletError.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** A sync update is the batch of tx hashes it carries; each becomes a state change whose `source` is that hash. */
type FakeSyncUpdate = readonly string[];

const changeOf = (source: string): ledger.ZswapStateChanges => ({ source, receivedCoins: [], spentCoins: [] });

const detailsOf = (hash: string): TransactionDetails => ({
  hash,
  block: { hash: 'block-hash', height: 1, timestamp: 1_700_000_000 },
  status: 'SUCCESS',
  identifiers: [],
});

type Observed = {
  /** Every batch `applyUpdate` was called with, in order: the state has moved past these. */
  readonly applied: Ref.Ref<readonly FakeSyncUpdate[]>;
  /** Every lookup attempt, by hash. */
  readonly lookups: Ref.Ref<readonly string[]>;
  /** Every change written to the history, by hash. */
  readonly recorded: Ref.Ref<readonly string[]>;
};

/**
 * A history service whose lookups hold for `holdFor` before they answer. The FIRST lookup of `lost` fails the way
 * `makeDefaultTransactionHistoryService` fails once its `transactionDetailsRetryWindow` is exhausted (an indexer outage
 * longer than the window); any later lookup of it succeeds (the indexer has caught up).
 */
const historyServiceOf = (observed: Observed, holdFor: Duration.Duration): TransactionHistoryService => ({
  getTransactionDetails: (hash) =>
    Effect.gen(function* () {
      const earlier = (yield* Ref.getAndUpdate(observed.lookups, (all) => [...all, hash])).filter((h) => h === hash);
      yield* Effect.sleep(holdFor);
      return hash === 'lost' && earlier.length === 0
        ? yield* new TransactionHistoryError({ message: `Indexer has not yet indexed transaction ${hash}` })
        : detailsOf(hash);
    }),
  put: (changes) => Ref.update(observed.recorded, (all) => [...all, changes.source]),
});

const runVariant = (batches: readonly FakeSyncUpdate[], holdFor: Duration.Duration, settleFor: Duration.Duration) =>
  Effect.gen(function* () {
    const observed: Observed = {
      applied: yield* Ref.make<readonly FakeSyncUpdate[]>([]),
      lookups: yield* Ref.make<readonly string[]>([]),
      recorded: yield* Ref.make<readonly string[]>([]),
    };
    // Test setup: applyUpdate is synchronous, so the batches it was called with are collected outside the Effect.
    const appliedBatches: FakeSyncUpdate[] = [];
    const syncService: SyncService<CoreWallet, null, FakeSyncUpdate> = { updates: () => Stream.fromIterable(batches) };
    const syncCapability: SyncCapability<CoreWallet, FakeSyncUpdate, ChangesResult> = {
      applyUpdate: (state, sources) => {
        appliedBatches.push(sources);
        return [state, { changes: sources.map(changeOf), protocolVersion: 1 }];
      },
    };
    const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability();
    const keysCapability = makeDefaultKeysCapability();
    const coinSelection = () => undefined;
    const secretKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1));
    const stateRef = yield* SubscriptionRef.make(CoreWallet.init(new ledger.ZswapLocalState(), secretKeys, networkId));
    const scope = yield* Scope.make();
    const variant = new RunningV2Variant(
      scope,
      {
        stateRef,
        activationRange: ProtocolVersion.makeRange(
          ProtocolVersion.MinSupportedVersion,
          ProtocolVersion.MaxSupportedVersion,
        ),
      },
      {
        serializationCapability: makeDefaultV2SerializationCapability(),
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
        transactionHistoryService: historyServiceOf(observed, holdFor),
      },
    );

    const drained = yield* variant
      .startSync(null)
      .pipe(Stream.runDrain, Effect.provideService(Scope.Scope, scope), Effect.exit);
    yield* Ref.set(observed.applied, [...appliedBatches]);
    // Give every lookup, and any later attempt at one, far longer than any retry window to land.
    yield* TestClock.adjust(settleFor);
    const result = {
      drained,
      applied: yield* Ref.get(observed.applied),
      lookups: yield* Ref.get(observed.lookups),
      recorded: yield* Ref.get(observed.recorded),
    };
    yield* Scope.close(scope, Exit.void);
    return result;
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

describe('RunningV2Variant.startSync tx-history sections', () => {
  // Fails on main: the failed lookup is caught and logged (RunningV2Variant.ts, catchAllCause after the
  // getTransactionDetails/put pair) and never attempted again, because applyUpdate has already moved the state past
  // the change. `lookups` ends as ['kept', 'lost'] and `recorded` as ['kept'].
  it('should record every applied change in the history once the indexer can answer, even when its first lookup failed', async () => {
    const result = await runVariant([['kept', 'lost']], Duration.seconds(1), Duration.hours(1));

    expect(Exit.isSuccess(result.drained)).toBe(true);
    expect(result.applied).toEqual([['kept', 'lost']]);
    expect(result.recorded).toEqual(expect.arrayContaining(['kept', 'lost']));
  });
});
