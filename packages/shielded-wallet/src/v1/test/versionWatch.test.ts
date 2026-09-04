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

/**
 * Noticing a protocol version the event timeline never mentions — on the variant that has to notice this fork.
 *
 * @remarks
 *   This is the pre-fork side, and therefore the side the drill caught out. A wallet running here learns the chain's
 *   version only from the events it is served; the zswap event subscription has no progress arm, so on a chain that
 *   forks and then produces no shielded traffic it is told nothing, ever. Observed live: the wallet stayed on this
 *   variant with the facade reporting the crossing as still pending, and only crossed when somebody finally made a
 *   transaction that emitted zswap events.
 *
 *   The last suite is that scenario end to end, through a real running variant: the shipped indexer-backed source and the
 *   shipped capability, over a chain that has forked and gone silent. What it asserts is the hand-over signal itself,
 *   which is what the runtime acts on.
 */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion, type SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  BlockHash,
  ZswapEventTip,
  ZswapEvents,
  type BlockHashQuery,
  type BlockHashQueryVariables,
  type ZswapEventTipSubscription,
  type ZswapEventTipSubscriptionVariables,
  type ZswapEventsSubscription,
  type ZswapEventsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { StateChange, VersionChangeType } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type ClientError, ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Chunk, Duration, Effect, Exit, Fiber, Option, Ref, Scope, Sink, Stream, SubscriptionRef } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { RunningV1Variant } from '../RunningV1Variant.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import {
  VersionSignalSyncUpdate,
  type WalletSyncUpdate,
  makeEventsSyncCapability,
  makeEventsSyncService,
} from '../Sync.js';
import { makeDefaultTransactingCapability } from '../Transacting.js';
import { type TransactionHistoryService } from '../TransactionHistory.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** The variant under test owns `[0, 2_000_000)`. A version at or past that end is what triggers the hand-over. */
const activationRange = ProtocolVersion.makeRange(
  ProtocolVersion.ProtocolVersion(0n),
  ProtocolVersion.ProtocolVersion(2_000_000n),
);
const preForkVersion = 1_000_000;
const postForkVersion = 2_001_000;

const keys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 9));

const progressAt = (appliedIndex: bigint): SyncProgress.SyncProgressData => ({
  appliedIndex,
  highestRelevantWalletIndex: appliedIndex,
  highestIndex: appliedIndex,
  highestRelevantIndex: appliedIndex,
  isConnected: true,
});

/** A wallet that has read the timeline up to `appliedIndex` and recorded the pre-fork version doing so. */
const syncedWallet = (appliedIndex: bigint): CoreWallet =>
  CoreWallet.restore(
    new ledger.ZswapLocalState(),
    keys(),
    progressAt(appliedIndex),
    ProtocolVersion.ProtocolVersion(BigInt(preForkVersion)),
    networkId,
  );

// =============================================================================
// The fold
// =============================================================================

describe('folding a version signal into the wallet state', () => {
  const capability = makeEventsSyncCapability();

  it('records a post-boundary version once the wallet is caught up on the event ids', () => {
    const caughtUp = syncedWallet(41n);

    const [state, result] = capability.applyUpdate(
      caughtUp,
      VersionSignalSyncUpdate.create(postForkVersion, 41),
      activationRange,
    );

    // The version is the whole of it: recording one outside the activation range is what makes the runtime hand over.
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
    // A signal is an observation about the chain, not a piece of it. Nothing that describes what the wallet holds or
    // where its reading has got to may move.
    expect(state.progress).toEqual(caughtUp.progress);
    expect([...state.state.coins]).toEqual([]);
    expect(state.state.firstFree).toBe(caughtUp.state.firstFree);
    expect(result.changes).toEqual([]);
    expect(result.protocolVersion).toBe(preForkVersion);
  });

  it('ignores a signal while events below the source tip are still unread', () => {
    // The gate. Handing over here would park the cursor at 41 and leave events 42..97 to be re-fetched by the
    // post-fork variant as bytes of the version that preceded it — unreadable, and possibly carrying coins.
    const behind = syncedWallet(41n);

    const [state, result] = capability.applyUpdate(
      behind,
      VersionSignalSyncUpdate.create(postForkVersion, 97),
      activationRange,
    );

    expect(state).toBe(behind);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(preForkVersion)));
    expect(result.changes).toEqual([]);
  });

  it('adopts a signal from a chain that holds no zswap events at all', () => {
    const fresh = CoreWallet.initEmpty(keys(), networkId);

    const [state] = capability.applyUpdate(
      fresh,
      VersionSignalSyncUpdate.create(postForkVersion, null),
      activationRange,
    );

    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
  });

  it('leaves the state alone when the chain reports a version it has already passed', () => {
    const caughtUp = syncedWallet(41n);

    const [state] = capability.applyUpdate(caughtUp, VersionSignalSyncUpdate.create(7, 41), activationRange);

    expect(state).toBe(caughtUp);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(preForkVersion)));
  });
});

// =============================================================================
// The source
// =============================================================================

/** A tip block as the indexer serves it, with the two fields the watcher reads and the rest filled in. */
const tipBlock = (protocolVersion: number, zswapEndIndex: number): BlockHashQuery => ({
  block: {
    height: 100,
    hash: '0xabc',
    protocolVersion,
    ledgerParameters: '0x00',
    timestamp: 1_700_000_000,
    zswapEndIndex,
    dustCommitmentEndIndex: 0,
    dustGenerationEndIndex: 0,
    dustCommitmentMerkleTreeRoot: null,
    dustGenerationMerkleTreeRoot: null,
  },
});

const indexerClientConnection = {
  indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
  indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
};

/**
 * A chain that has forked and gone quiet: the event subscription is open and will never say anything again.
 *
 * @remarks
 *   `Stream.never` rather than `Stream.empty`, and the difference is the whole point: an empty stream is a source that
 *   has finished, which is not the situation. The drill's chain kept its subscription open and simply had nothing to
 *   push, so the wallet sat there with no reason to believe anything had changed.
 */
const quietChain = (
  _variables: ZswapEventsSubscriptionVariables,
): Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient> => Stream.never;

type Recorder<T> = Ref.Ref<readonly T[]>;

const recorder = <T>(): Recorder<T> => Effect.runSync(Ref.make<readonly T[]>([]));

/** The indexer's answer about its tip, recording what it was asked. */
const servingTip =
  (answer: BlockHashQuery, asked: Recorder<BlockHashQueryVariables>) => (variables: BlockHashQueryVariables) =>
    Ref.update(asked, (all) => [...all, variables]).pipe(Effect.as(answer));

/** The indexer's answer about how far its zswap event timeline goes, recording the cursor it was asked from. */
const servingEventTip =
  (maxId: number, asked: Recorder<ZswapEventTipSubscriptionVariables>) =>
  (
    variables: ZswapEventTipSubscriptionVariables,
  ): Stream.Stream<ZswapEventTipSubscription, ClientError | ServerError, SubscriptionClient> =>
    Stream.unwrap(
      Ref.update(asked, (all) => [...all, variables]).pipe(
        Effect.as(Stream.make({ zswapLedgerEvents: { id: 1, maxId } })),
      ),
    );

/** Batching turned down so far that the event stream contributes nothing to what a short window collects. */
const service = (intervalMs: number) =>
  makeEventsSyncService({
    indexerClientConnection,
    batchUpdates: { size: 100, timeout: 60_000, spacing: 0 },
    versionWatch: { intervalMs },
  });

describe('watching the chain for a version the events never mention', () => {
  it('keeps signalling the tip version on a quiet chain, with the highest event id the source holds', async () => {
    const caughtUp = syncedWallet(41n);
    const tipAsked = recorder<BlockHashQueryVariables>();
    const eventTipAsked = recorder<ZswapEventTipSubscriptionVariables>();

    const collected = await service(20)
      .updates(caughtUp, keys())
      .pipe(
        Stream.filter((update): update is VersionSignalSyncUpdate => update._tag === 'VersionSignal'),
        Stream.take(2),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(postForkVersion, 42), tipAsked)),
        Effect.provideService(ZswapEventTip.tag, servingEventTip(41, eventTipAsked)),
        Effect.provideService(ZswapEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([
      VersionSignalSyncUpdate.create(postForkVersion, 41),
      VersionSignalSyncUpdate.create(postForkVersion, 41),
    ]);
    // The tip is what the chain is on now, so the question is asked without an offset.
    expect(Effect.runSync(Ref.get(tipAsked))).toEqual([{ offset: null }, { offset: null }]);
    // The event-id question is asked from the wallet's own cursor: the event it last applied provably exists, so the
    // answer comes back at once, and the source has the least backfill to abandon.
    expect(Effect.runSync(Ref.get(eventTipAsked))).toEqual([{ id: 40 }, { id: 40 }]);
  });

  it('reports no event id, without asking for one, when the chain has produced no zswap commitment', async () => {
    const fresh = CoreWallet.initEmpty(keys(), networkId);
    const eventTipAsked = recorder<ZswapEventTipSubscriptionVariables>();

    const collected = await service(20)
      .updates(fresh, keys())
      .pipe(
        Stream.filter((update): update is VersionSignalSyncUpdate => update._tag === 'VersionSignal'),
        Stream.take(1),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(postForkVersion, 0), recorder())),
        Effect.provideService(ZswapEventTip.tag, servingEventTip(0, eventTipAsked)),
        Effect.provideService(ZswapEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([VersionSignalSyncUpdate.create(postForkVersion, null)]);
    expect(Effect.runSync(Ref.get(eventTipAsked))).toEqual([]);
  });

  it('skips a tick the indexer will not answer, and signals on the next one', async () => {
    const caughtUp = syncedWallet(41n);
    const attempts = recorder<BlockHashQueryVariables>();
    const flaky = (variables: BlockHashQueryVariables) =>
      Ref.updateAndGet(attempts, (all) => [...all, variables]).pipe(
        Effect.flatMap((all) =>
          all.length === 1
            ? Effect.fail(new ServerError({ message: 'the indexer is down' }))
            : Effect.succeed(tipBlock(postForkVersion, 42)),
        ),
      );

    const collected = await service(20)
      .updates(caughtUp, keys())
      .pipe(
        Stream.filter((update): update is VersionSignalSyncUpdate => update._tag === 'VersionSignal'),
        Stream.take(1),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, flaky),
        Effect.provideService(ZswapEventTip.tag, servingEventTip(41, recorder())),
        Effect.provideService(ZswapEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([VersionSignalSyncUpdate.create(postForkVersion, 41)]);
    expect(Effect.runSync(Ref.get(attempts))).toHaveLength(2);
  });

  it('says nothing at all when the chain is still on the version the wallet started from', async () => {
    const caughtUp = syncedWallet(41n);
    const eventTipAsked = recorder<ZswapEventTipSubscriptionVariables>();

    const collected = await service(5)
      .updates(caughtUp, keys())
      .pipe(
        Stream.filter((update) => update._tag === 'VersionSignal'),
        Stream.interruptAfter('150 millis'),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(preForkVersion, 42), recorder())),
        Effect.provideService(ZswapEventTip.tag, servingEventTip(41, eventTipAsked)),
        Effect.provideService(ZswapEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([]);
    expect(Effect.runSync(Ref.get(eventTipAsked))).toEqual([]);
  });

  it('does not watch at all when the interval is turned off', async () => {
    const caughtUp = syncedWallet(41n);
    const tipAsked = recorder<BlockHashQueryVariables>();

    const collected = await service(0)
      .updates(caughtUp, keys())
      .pipe(
        Stream.interruptAfter('100 millis'),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(postForkVersion, 42), tipAsked)),
        Effect.provideService(ZswapEventTip.tag, servingEventTip(41, recorder())),
        Effect.provideService(ZswapEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([]);
    expect(Effect.runSync(Ref.get(tipAsked))).toEqual([]);
  });
});

// =============================================================================
// The drill regression, through a running variant
// =============================================================================

const noOpHistory: TransactionHistoryService = {
  put: () => Effect.void,
  getTransactionDetails: (hash) =>
    Effect.succeed({
      hash,
      block: { hash: '', height: 0, timestamp: 0 },
      status: 'SUCCESS' as const,
      identifiers: [] as readonly string[],
    }),
};

/**
 * The variant's context, wired to the shipped indexer-backed source and the shipped fold.
 *
 * @remarks
 *   Only the transport is stood in for. The sync service, the capability that folds what it emits, and the variant that
 *   turns a recorded version into a hand-over signal are the ones the package ships — which is the point: the drill
 *   found a gap between those three, not inside any one of them.
 */
const variantContextOf = (): RunningV1Variant.Context<
  string,
  WalletSyncUpdate,
  ledger.FinalizedTransaction,
  ledger.ZswapSecretKeys
> => {
  const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability();
  const keysCapability = makeDefaultKeysCapability();
  const coinSelection = () => undefined;

  return {
    serializationCapability: makeDefaultV1SerializationCapability(),
    syncService: service(20),
    syncCapability: makeEventsSyncCapability(),
    transactingCapability: makeDefaultTransactingCapability({ networkId }, () => ({
      coinSelection,
      coinsAndBalancesCapability,
      keysCapability,
    })),
    coinsAndBalancesCapability,
    keysCapability,
    coinSelection,
    transactionHistoryService: noOpHistory,
  };
};

describe('a wallet on the quiet side of a fork', () => {
  it('crosses on the watcher alone, without a single event ever arriving', async () => {
    // The drill, reproduced: a wallet caught up to the tip of a chain that has forked and then produced no shielded
    // traffic at all. Against a wallet with no version watcher this never resolves — the source has nothing to say and
    // the version is never observed, so the variant never asks to hand over.
    const observed = await Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make(syncedWallet(41n));
      const scope = yield* Scope.make();
      const variant = new RunningV1Variant(scope, { stateRef, activationRange }, variantContextOf());

      const handOver = yield* Effect.fork(
        variant.state.pipe(
          Stream.filterMap((change) =>
            StateChange.isVersionChange(change) && VersionChangeType.isVersion(change.change)
              ? Option.some(change.change.version)
              : Option.none(),
          ),
          Stream.take(1),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
          Effect.timeout(Duration.seconds(10)),
        ),
      );

      yield* Effect.forkScoped(
        variant.startSync(keys()).pipe(Stream.runScoped(Sink.drain), Effect.provideService(Scope.Scope, scope)),
      );

      const version = yield* Fiber.join(handOver);
      const state = yield* SubscriptionRef.get(stateRef);
      yield* Scope.close(scope, Exit.void);

      return { version, state };
    }).pipe(
      Effect.provideService(BlockHash.tag, servingTip(tipBlock(postForkVersion, 42), recorder())),
      Effect.provideService(ZswapEventTip.tag, servingEventTip(41, recorder())),
      Effect.provideService(ZswapEvents.tag, quietChain),
      Effect.scoped,
      Effect.runPromise,
    );

    // The signal the runtime acts on: this variant no longer owns the wallet.
    expect(observed.version).toBe(BigInt(postForkVersion));
    // And the state carries it, which is what the runtime reads when it decides which variant does.
    expect(observed.state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
    // Nothing of the chain was consumed to get there.
    expect(observed.state.progress.appliedIndex).toBe(41n);
  });
});
