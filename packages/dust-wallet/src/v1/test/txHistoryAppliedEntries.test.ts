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
import { DustSecretKey, type DustStateChanges, LedgerParameters } from '@midnightntwrk/ledger-v8';
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  Clock,
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
import { BackgroundRepeat, type ChangesResult, type SyncCapability, type SyncService } from '../Sync.js';
import { makeDefaultTransactingCapability } from '../Transacting.js';
import {
  DustTransactionHistoryEntrySchema,
  makeDefaultTransactionHistoryService,
  type TransactionDetails,
  type TransactionHistoryService,
} from '../TransactionHistory.js';
import { TransactionHistoryError } from '../WalletError.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** A sync update is the batch of tx hashes it carries; each becomes a state change whose `source` is that hash. */
type FakeSyncUpdate = readonly string[];

const changeOf = (source: string): DustStateChanges => ({ source, receivedUtxos: [], spentUtxos: [] });

const block = { hash: 'block-hash', height: 7, timestamp: 1_700_000_000 };

const detailsOf = (hash: string): TransactionDetails => ({
  hash,
  block,
  status: 'SUCCESS',
  identifiers: ['id-1'],
  fees: 1234n,
});

type Storage = InMemoryTransactionHistoryStorage<
  typeof DustTransactionHistoryEntrySchema.Type,
  typeof DustTransactionHistoryEntrySchema.Encoded
>;

/**
 * The default history service writing to `storage`, with its indexer lookup replaced: the indexer cannot answer for any
 * transaction until `answersFrom` on the (test) clock, and answers for every one from then on.
 */
const historyServiceOf = (storage: Storage, answersFrom: Duration.Duration): TransactionHistoryService => ({
  ...makeDefaultTransactionHistoryService(
    { txHistoryStorage: storage, indexerClientConnection: { indexerHttpUrl: 'http://localhost:9999/graphql' } },
    () => undefined,
  ),
  getTransactionDetails: (hash) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      now >= Duration.toMillis(answersFrom)
        ? Effect.succeed(detailsOf(hash))
        : Effect.fail(new TransactionHistoryError({ message: `Indexer has not yet indexed transaction ${hash}` })),
    ),
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

/**
 * Runs a V1 variant over `batches` against `storage` and drains its sync, recording which hashes the history held each
 * time the wallet state changed, then lets `settleFor` pass on the test clock.
 */
const runVariant = (
  storage: Storage,
  batches: readonly FakeSyncUpdate[],
  answersFrom: Duration.Duration,
  settleFor: Duration.Duration,
) =>
  Effect.gen(function* () {
    const syncCapability: SyncCapability<CoreWallet, FakeSyncUpdate, ChangesResult> = {
      applyUpdate: (state, sources) => [state, { changes: sources.map(changeOf), protocolVersion: 1 }],
    };
    const keysCapability = makeDefaultKeysCapability();
    const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability }));
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
      {
        serializationCapability: makeDefaultV1SerializationCapability(),
        syncService: syncServiceOf(batches),
        syncCapability,
        transactingCapability: makeDefaultTransactingCapability(
          { networkId, costParameters: { feeBlocksMargin: 5 } },
          () => ({ coinSelection: chooseCoin, coinsAndBalancesCapability, keysCapability }),
        ),
        coinsAndBalancesCapability,
        keysCapability,
        coinSelection: chooseCoin,
        transactionHistoryService: historyServiceOf(storage, answersFrom),
      },
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

    yield* variant.startSync(null).pipe(Stream.runDrain, Effect.provideService(Scope.Scope, scope));
    yield* TestClock.adjust(settleFor);
    const observed = {
      historyAtEachState: yield* Ref.get(historyAtEachState),
      entry: yield* Effect.promise(() => storage.get('tx')),
    };

    yield* Fiber.interrupt(watcher);
    yield* Scope.close(scope, Exit.void);
    return observed;
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

const emptyStorage = (): Storage => new InMemoryTransactionHistoryStorage(DustTransactionHistoryEntrySchema);

describe('RunningV1Variant tx-history entries written before their details are known (dust)', () => {
  it('should store an applied change as an incomplete entry before the state moves past it, so no snapshot is ahead of its history', async () => {
    // The indexer never answers within the test, so nothing but the applied-change write can put the entry there.
    const result = await runVariant(emptyStorage(), [['tx']], Duration.days(1), Duration.millis(1));

    // The first observation is the state before the batch; every later one is a state that has moved past `tx`.
    expect(result.historyAtEachState.length).toBeGreaterThan(1);
    expect(result.historyAtEachState.slice(1).every((hashes) => hashes.includes('tx'))).toBe(true);
    expect(result.entry?.lifecycle).toEqual({ status: 'finalized' });
    expect(result.entry?.dustDetailsPending).toBe(true);
    expect(result.entry?.dust).toEqual({ receivedUtxos: [], spentUtxos: [] });
  });

  it('should fill in the details, fees included, and clear the pending flag once the indexer answers', async () => {
    const result = await runVariant(emptyStorage(), [['tx']], Duration.minutes(10), Duration.hours(1));

    expect(result.entry?.lifecycle).toEqual({
      status: 'finalized',
      finalizedBlock: { hash: block.hash, height: block.height, timestamp: new Date(block.timestamp) },
    });
    expect(result.entry?.status).toBe('SUCCESS');
    expect(result.entry?.identifiers).toEqual(['id-1']);
    expect(result.entry?.fees).toBe(1234n);
    expect(result.entry?.dustDetailsPending).toBe(false);
  });

  it('should complete an entry restored incomplete when the wallet starts, without any new sync update', async () => {
    // A history saved together with a snapshot taken while `tx` was still being looked up.
    const storage = emptyStorage();
    await storage.gotApplied({
      hash: 'tx',
      identifiers: [],
      protocolVersion: 1,
      dust: { receivedUtxos: [], spentUtxos: [] },
      dustDetailsPending: true,
    });

    const result = await runVariant(storage, [], Duration.zero, Duration.hours(1));

    expect(result.entry?.lifecycle).toEqual({
      status: 'finalized',
      finalizedBlock: { hash: block.hash, height: block.height, timestamp: new Date(block.timestamp) },
    });
    expect(result.entry?.fees).toBe(1234n);
    expect(result.entry?.dustDetailsPending).toBe(false);
    expect(result.entry?.dust).toEqual({ receivedUtxos: [], spentUtxos: [] });
  });
});
