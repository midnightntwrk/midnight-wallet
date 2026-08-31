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
 * Noticing a protocol version the event timeline never mentions.
 *
 * @remarks
 *   A shielded wallet learns which version the chain is on from the events it is served, and the zswap event subscription
 *   carries no progress arm — it says nothing at all when there is nothing to say. On a chain that forks and then
 *   produces no shielded traffic, that wallet never hears about the fork: it stays on the pre-fork variant, and
 *   everything the facade builds through it stays routed to the pre-fork ledger. That is what the version watcher
 *   removes, by asking the chain its version on a timer and feeding the answer into the same state-recording path the
 *   events use.
 *
 *   The gate is the load-bearing half. Recording a version past the boundary is what triggers the hand-over, and the
 *   hand-over parks the sync cursor where it stands: any event still unread below the tip would then be re-fetched by
 *   the post-fork variant as bytes of the version that preceded it, which its ledger cannot deserialize — and, worse,
 *   an unread pre-fork event may be carrying a coin that would never enter the carried state. So the signal may be
 *   adopted only when the wallet is provably caught up on the source's **event ids**, which is why the signal carries
 *   the highest event id the source holds and not merely a version.
 */

import * as ledger from '@midnightntwrk/ledger-v9';
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
import { type ClientError, ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Chunk, Effect, Ref, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { VersionSignalSyncUpdate, makeEventsSyncCapability, makeEventsSyncService } from '../Sync.js';

const networkId = NetworkId.NetworkId.Undeployed;

/** The variant under test owns `[0, 2_000_000)`. A version at or past that end is what triggers the hand-over. */
const activeRange = ProtocolVersion.makeRange(
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
      activeRange,
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
      activeRange,
    );

    expect(state).toBe(behind);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(preForkVersion)));
    expect(result.changes).toEqual([]);
  });

  it('adopts a signal from a chain that holds no zswap events at all', () => {
    // Nothing has ever been indexed, so nothing can be unread: a fresh wallet on a forked chain that has never seen
    // shielded traffic is exactly the wallet that would otherwise sit pre-fork forever.
    const fresh = CoreWallet.initEmpty(keys(), networkId);

    const [state] = capability.applyUpdate(fresh, VersionSignalSyncUpdate.create(postForkVersion, null), activeRange);

    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
  });

  it('adopts a signal on a wallet still awaiting its coin hashes, and leaves the marker standing', () => {
    // A byte-crossed wallet is complete except for its coin hashes, which need keys a signal does not carry. The
    // observation is safe to record — the tree already exists — and the marker survives for the first keyed batch.
    const crossing = { ...syncedWallet(41n), coinHashesPending: true as const };

    const [state, result] = capability.applyUpdate(
      crossing,
      VersionSignalSyncUpdate.create(postForkVersion, 41),
      activeRange,
    );

    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
    expect(state.coinHashesPending).toBe(true);
    expect(result.changes).toEqual([]);
  });

  it('leaves the state alone when the chain reports a version it has already passed', () => {
    // A reconnect against a lagging replica must not be able to drag a wallet back below a boundary it has crossed.
    const caughtUp = syncedWallet(41n);

    const [state] = capability.applyUpdate(caughtUp, VersionSignalSyncUpdate.create(7, 41), activeRange);

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

    // Folded, this is the hand-over: a caught-up wallet records the version the chain moved to.
    const [state] = makeEventsSyncCapability().applyUpdate(caughtUp, Chunk.toArray(collected)[0], activeRange);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
  });

  it('reports no event id, without asking for one, when the chain has produced no zswap commitment', async () => {
    // A tree that has never grown cannot have had a nullifier spent against it either, so a chain at index zero
    // provably holds no zswap ledger event — the one case where "nothing is unread" is answerable from the tip alone.
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
    // A poll that fails says nothing about the chain, so it must not reach the state and must not take the sync stream
    // down with it: the retry is the next tick, which costs nothing to wait for.
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
    // The signal would be a provable no-op — the state's version only ever rises — so the tick stops at the tip query
    // and never opens the event-id probe. That is what keeps a settled wallet from polling a subscription forever.
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
