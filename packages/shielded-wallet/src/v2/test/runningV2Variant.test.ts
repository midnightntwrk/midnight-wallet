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
import {
  Chunk,
  Duration,
  Effect,
  Exit,
  Fiber,
  Option,
  Ref,
  Scope,
  Stream,
  SubscriptionRef,
  TestClock,
  TestContext,
} from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';
import { V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { StateChange, VersionChangeType } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { RunningV2Variant } from '../RunningV2Variant.js';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
import {
  type ChangesResult,
  type EventsSyncUpdate,
  type SyncCapability,
  type SyncService,
  WalletSyncUpdate,
  makeEventsSyncCapability,
} from '../Sync.js';
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
): RunningV2Variant.Context<string, FakeSyncUpdate, ledger.FinalizedTransaction, null> => {
  const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability();
  const keysCapability = makeDefaultKeysCapability();
  const coinSelection = () => undefined;
  return {
    serializationCapability: makeDefaultV2SerializationCapability(),
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

describe('RunningV2Variant.startSync tx-history fan-out', () => {
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
      const variant = new RunningV2Variant(
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

describe('RunningV2Variant.state protocol version signalling', () => {
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
      const variant = new RunningV2Variant(
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

describe('RunningV2Variant.startSync tx-history of a transfer split across sync batches', () => {
  const keys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 5));
  const stranger = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 6));
  const activationRange = ProtocolVersion.makeRange(
    ProtocolVersion.ProtocolVersion(0n),
    ProtocolVersion.ProtocolVersion(7n),
  );
  const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

  type Chain = Readonly<{
    /** The genesis mint paying this wallet the coin the transfer spends. */
    mintHex: string;
    /** The transfer's events in chain order: its input (the spend), then its two outputs (payment, change). */
    transferHex: readonly string[];
    transferHash: string;
    /** The events of a later transaction that does not touch this wallet: the stranger sending its 100 to itself. */
    strangerHex: readonly string[];
  }>;

  /**
   * A real chain holding one coin of this wallet and one transfer spending it: 100 to a stranger, 400 back as change.
   * Kept encoded, as the indexer serves it, because the ledger consumes the event objects it replays.
   */
  const buildChain = (): Promise<Chain> =>
    Effect.gen(function* () {
      const simulator = yield* V9.Simulator.init({
        genesisMints: [
          { type: 'shielded' as const, tokenType: ledger.shieldedToken().raw, amount: 500n, recipient: keys() },
        ],
      });
      const genesis = Option.getOrThrow(yield* simulator.state$.pipe(Stream.take(1), Stream.runHead));
      const [mint] = V9.getLastBlockEvents(genesis);
      const funded = new ledger.ZswapLocalState().replayEvents(keys(), [ledger.Event.deserialize(mint.serialize())]);
      const coin = [...funded.coins][0];
      const [, input] = funded.spend(keys(), coin, 0);
      const output = (value: bigint, to: ledger.ZswapSecretKeys) => {
        const info = ledger.createShieldedCoinInfo(coin.type, value);
        return ledger.ZswapOffer.fromOutput(
          ledger.ZswapOutput.new(info, 0, to.coinPublicKey, to.encryptionPublicKey),
          info.type,
          info.value,
        );
      };
      const offer = ledger.ZswapOffer.fromInput(input, coin.type, coin.value)
        .merge(output(100n, stranger))
        .merge(output(400n, keys()));
      yield* simulator.submitTransaction(ledger.Transaction.fromParts(networkId, offer).eraseProofs(), {
        strictness: {},
      });
      const after = Option.getOrThrow(yield* simulator.state$.pipe(Stream.take(1), Stream.runHead));
      const transfer = V9.getLastBlockEvents(after);
      const strangers = new ledger.ZswapLocalState().replayEvents(
        stranger,
        [mint, ...transfer].map((event) => ledger.Event.deserialize(event.serialize())),
      );
      const strangersCoin = [...strangers.coins][0];
      const [, strangersInput] = strangers.spend(stranger, strangersCoin, 0);
      const toItself = ledger.createShieldedCoinInfo(strangersCoin.type, strangersCoin.value);
      const strangersOffer = ledger.ZswapOffer.fromInput(strangersInput, strangersCoin.type, strangersCoin.value).merge(
        ledger.ZswapOffer.fromOutput(
          ledger.ZswapOutput.new(toItself, 0, stranger.coinPublicKey, stranger.encryptionPublicKey),
          toItself.type,
          toItself.value,
        ),
      );
      yield* simulator.submitTransaction(ledger.Transaction.fromParts(networkId, strangersOffer).eraseProofs(), {
        strictness: {},
      });
      const afterStranger = Option.getOrThrow(yield* simulator.state$.pipe(Stream.take(1), Stream.runHead));
      return {
        mintHex: hex(mint.serialize()),
        transferHex: transfer.map((event) => hex(event.serialize())),
        transferHash: transfer[0].source.transactionHash,
        strangerHex: V9.getLastBlockEvents(afterStranger).map((event) => hex(event.serialize())),
      };
    }).pipe(Effect.scoped, Effect.runPromise);

  let chain: Chain;
  beforeAll(async () => {
    chain = await buildChain();
    expect(chain.transferHex.map((raw) => ledger.Event.deserialize(Buffer.from(raw, 'hex')).content.tag)).toEqual([
      'zswapInput',
      'zswapOutput',
      'zswapOutput',
    ]);
  });

  /** The wallet before the transfer: holding the minted coin, the mint applied as event 1. */
  const fundedWallet = (): CoreWallet => {
    const [wallet] = CoreWallet.replayEventsWithChanges(CoreWallet.initEmpty(keys(), networkId), keys(), [
      ledger.Event.deserialize(Buffer.from(chain.mintHex, 'hex')),
    ]);
    return wallet;
  };

  /** The transfer's events as ids 2..4, cut into consecutive sync batches of the given sizes. */
  const transferIn = (sizes: readonly number[]): readonly WalletSyncUpdate[] => {
    const maxId = 1 + chain.transferHex.length;
    const items = chain.transferHex.map((raw, i): EventsSyncUpdate => ({
      _tag: 'EventsSyncUpdate',
      id: i + 2,
      protocolVersion: 3,
      maxId,
      raw,
    }));
    return sizes.map((size, i) => {
      const start = sizes.slice(0, i).reduce((sum, n) => sum + n, 0);
      return WalletSyncUpdate.create(items.slice(start, start + size), keys(), new Date('2026-11-04T12:00:00Z'));
    });
  };

  type Written = Readonly<{ received: number; spent: number }>;

  /**
   * Syncs the funded wallet through `updates`, and returns every tx-history write made for the transfer.
   *
   * @param timeline `'ends'` closes the sync timeline after the last update; `'stays open'` keeps it open, as a live
   *   source does, so nothing can be recorded on the strength of the timeline having ended.
   */
  const writesOfTransfer = (
    updates: readonly WalletSyncUpdate[],
    timeline: 'ends' | 'stays open' = 'ends',
  ): Promise<readonly Written[]> =>
    Effect.gen(function* () {
      const writes = yield* Ref.make<readonly (Written & { source: string })[]>([]);
      const historyService: TransactionHistoryService = {
        getTransactionDetails: (hash) =>
          Effect.succeed({
            hash,
            block: { hash: 'block-hash', height: 2, timestamp: 1_700_000_000 },
            status: 'SUCCESS' as const,
            identifiers: [],
          }),
        put: (change) =>
          Ref.update(writes, (all) => [
            ...all,
            { source: change.source, received: change.receivedCoins.length, spent: change.spentCoins.length },
          ]),
      };
      const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability();
      const keysCapability = makeDefaultKeysCapability();
      const coinSelection = () => undefined;
      const context: RunningV2Variant.Context<string, WalletSyncUpdate, ledger.FinalizedTransaction, null> = {
        serializationCapability: makeDefaultV2SerializationCapability(),
        syncService: {
          updates: () =>
            timeline === 'ends'
              ? Stream.fromIterable(updates)
              : Stream.concat(Stream.fromIterable(updates), Stream.never),
        },
        syncCapability: makeEventsSyncCapability(),
        transactingCapability: makeDefaultTransactingCapability({ networkId }, () => ({
          coinSelection,
          coinsAndBalancesCapability,
          keysCapability,
        })),
        coinsAndBalancesCapability,
        keysCapability,
        coinSelection,
        transactionHistoryService: historyService,
      };
      const scope = yield* Scope.make();
      const stateRef = yield* SubscriptionRef.make(fundedWallet());
      const variant = new RunningV2Variant(scope, { stateRef, activationRange }, context);

      yield* Effect.forkIn(
        variant.startSync(null).pipe(Stream.runDrain, Effect.provideService(Scope.Scope, scope)),
        scope,
      );
      // Sync and every write run in the variant's scope; let them all run before reading what was written.
      yield* TestClock.adjust(Duration.minutes(1));
      const written = yield* Ref.get(writes);
      yield* Scope.close(scope, Exit.void);
      return written
        .filter((write) => write.source === chain.transferHash)
        .map(({ received, spent }) => ({ received, spent }));
    }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);

  it('should record the spent coin and the change together when the transfer arrives in one batch', async () => {
    expect(await writesOfTransfer(transferIn([3]))).toEqual([{ received: 1, spent: 1 }]);
  });

  it('should record the spent coin and the change together when the batch boundary falls inside the transfer, so no reader ever sees the spend without its coins', async () => {
    expect(await writesOfTransfer(transferIn([1, 2]))).toEqual([{ received: 1, spent: 1 }]);
  });

  it('should record a split transfer as soon as the wallet catches up, because a live timeline never ends to release it', async () => {
    expect(await writesOfTransfer(transferIn([1, 2]), 'stays open')).toEqual([{ received: 1, spent: 1 }]);
  });

  /**
   * The transfer's events as ids 2..4, followed by id 5 from the protocol version after this variant's range, cut into
   * consecutive sync batches of the given sizes. Event 5 is deferred to the next variant, so its bytes are never read.
   */
  const transferThenNextVersionIn = (sizes: readonly number[]): readonly WalletSyncUpdate[] => {
    const maxId = 2 + chain.transferHex.length;
    const transfer = chain.transferHex.map((raw, i): EventsSyncUpdate => ({
      _tag: 'EventsSyncUpdate',
      id: i + 2,
      protocolVersion: 3,
      maxId,
      raw,
    }));
    const nextVersion: EventsSyncUpdate = { _tag: 'EventsSyncUpdate', id: maxId, protocolVersion: 7, maxId, raw: '' };
    const items = [...transfer, nextVersion];
    return sizes.map((size, i) => {
      const start = sizes.slice(0, i).reduce((sum, n) => sum + n, 0);
      return WalletSyncUpdate.create(items.slice(start, start + size), keys(), new Date('2026-11-04T12:00:00Z'));
    });
  };

  it('should record a split transfer when the batch that completes it hands over to the next variant, because the runtime closes this variant rather than ending its timeline', async () => {
    expect(await writesOfTransfer(transferThenNextVersionIn([1, 3]), 'stays open')).toEqual([
      { received: 1, spent: 1 },
    ]);
  });

  /**
   * One batch holding the whole transfer as ids 2..4 and then the stranger's transaction, while the source reports ten
   * more events beyond them, so the wallet is still catching up when the batch is applied.
   */
  const transferThenStrangerInOneBatch = (): readonly WalletSyncUpdate[] => {
    const raws = [...chain.transferHex, ...chain.strangerHex];
    const maxId = 1 + raws.length + 10;
    const items = raws.map((raw, i): EventsSyncUpdate => ({
      _tag: 'EventsSyncUpdate',
      id: i + 2,
      protocolVersion: 3,
      maxId,
      raw,
    }));
    return [WalletSyncUpdate.create(items, keys(), new Date('2026-11-04T12:00:00Z'))];
  };

  it('should record a transfer while still catching up when a later transaction follows it in the same batch, because only a transaction the batch ends inside can have been cut', async () => {
    expect(await writesOfTransfer(transferThenStrangerInOneBatch(), 'stays open')).toEqual([{ received: 1, spent: 1 }]);
  });
});
