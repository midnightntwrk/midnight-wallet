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
 * Noticing a protocol version the dust event timeline never mentions.
 *
 * @remarks
 *   A dust wallet learns which version the chain is on from the events it is served, and the dust event subscription
 *   carries no progress arm — it says nothing at all when there is nothing to say. On a chain that forks and then
 *   produces no dust traffic, that wallet is never told: it stays on the variant it was running, and everything the
 *   facade builds through it stays routed to that variant's ledger. That is what the version watcher removes, by asking
 *   the chain its version on a timer and feeding the answer into the same `annotateVersion` path the events use.
 *
 *   The gate is the load-bearing half. Recording a version past the boundary is what triggers the hand-over, and the
 *   hand-over parks the sync cursor where it stands: any event still unread below the tip would then be re-fetched by
 *   the V2 variant as bytes of the version that preceded it, which its ledger cannot deserialize. So the signal may be
 *   adopted only when the wallet is provably caught up on the source's **event ids**, which is why it carries the
 *   highest dust event id the source holds and not merely a version.
 */

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  BlockHash,
  DustLedgerEventTip,
  DustLedgerEvents,
  type BlockHashQuery,
  type BlockHashQueryVariables,
  type DustLedgerEventTipSubscription,
  type DustLedgerEventTipSubscriptionVariables,
  type DustLedgerEventsSubscription,
  type DustLedgerEventsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { type ClientError, ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Chunk, Effect, Ref, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultSyncCapability, makeDefaultSyncService } from '../Sync.js';
import { VersionSignalSyncUpdate, type WalletSyncUpdate } from '../SyncSchema.js';
import { fixtureSecretKey, freshWallet } from './dustEvents.js';

const networkId = 'undeployed';

/** The variant under test owns `[0, 2_000_000)`. A version at or past that end is what triggers the hand-over. */
const activeRange = ProtocolVersion.makeRange(
  ProtocolVersion.ProtocolVersion(0n),
  ProtocolVersion.ProtocolVersion(2_000_000n),
);
const v8Version = 1_000_000;
const v9Version = 2_001_000;

/** A wallet that has read the dust timeline up to `appliedIndex` and recorded the ledger-v8 version doing so. */
const syncedWallet = (appliedIndex: bigint): CoreWallet =>
  CoreWallet.withProtocolVersion(
    CoreWallet.updateProgress(freshWallet(), {
      appliedIndex,
      highestRelevantWalletIndex: appliedIndex,
      isConnected: true,
    }),
    ProtocolVersion.ProtocolVersion(BigInt(v8Version)),
  );

// =============================================================================
// The fold
// =============================================================================

describe('folding a version signal into the wallet state', () => {
  const capability = makeDefaultSyncCapability();

  it('records a post-boundary version once the wallet is caught up on the event ids', () => {
    const caughtUp = syncedWallet(41n);

    const [state, result] = capability.applyUpdate(
      caughtUp,
      VersionSignalSyncUpdate.create(v9Version, 41),
      activeRange,
    );

    // The version is the whole of it: recording one outside the activation range is what makes the runtime hand over.
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(v9Version)));
    // A signal is an observation about the chain, not a piece of it. Nothing that describes what the wallet holds or
    // where its reading has got to may move.
    expect(state.progress.appliedIndex).toBe(caughtUp.progress.appliedIndex);
    expect(state.progress.highestRelevantWalletIndex).toBe(caughtUp.progress.highestRelevantWalletIndex);
    expect(state.progress.isConnected).toBe(caughtUp.progress.isConnected);
    expect(state.state).toBe(caughtUp.state);
    expect(state.pendingDust).toBe(caughtUp.pendingDust);
    expect(result.changes).toEqual([]);
    expect(result.protocolVersion).toBe(v8Version);
  });

  it('ignores a signal while events below the source tip are still unread', () => {
    // The gate. Handing over here would park the cursor at 41 and leave events 42..97 to be re-fetched by the
    // V2 variant as bytes of the version that preceded it, which its ledger cannot read.
    const behind = syncedWallet(41n);

    const [state, result] = capability.applyUpdate(behind, VersionSignalSyncUpdate.create(v9Version, 97), activeRange);

    expect(state).toBe(behind);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(v8Version)));
    expect(result.changes).toEqual([]);
  });

  it('leaves the state alone when the chain reports a version it has already passed', () => {
    // A reconnect against a lagging replica must not be able to drag a wallet back below a boundary it has crossed.
    const caughtUp = syncedWallet(41n);

    const [state] = capability.applyUpdate(caughtUp, VersionSignalSyncUpdate.create(7, 41), activeRange);

    expect(state).toBe(caughtUp);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(v8Version)));
  });
});

// =============================================================================
// The source
// =============================================================================

/** A tip block as the indexer serves it, with the field the watcher reads and the rest filled in. */
const tipBlock = (protocolVersion: number): BlockHashQuery => ({
  block: {
    height: 100,
    hash: '0xabc',
    protocolVersion,
    ledgerParameters: '0x00',
    timestamp: 1_700_000_000,
    zswapEndIndex: 0,
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
  _variables: DustLedgerEventsSubscriptionVariables,
): Stream.Stream<DustLedgerEventsSubscription, ClientError | ServerError, SubscriptionClient> => Stream.never;

type Recorder<T> = Ref.Ref<readonly T[]>;

const recorder = <T>(): Recorder<T> => Effect.runSync(Ref.make<readonly T[]>([]));

/** The indexer's answer about its tip, recording what it was asked. */
const servingTip =
  (answer: BlockHashQuery, asked: Recorder<BlockHashQueryVariables>) => (variables: BlockHashQueryVariables) =>
    Ref.update(asked, (all) => [...all, variables]).pipe(Effect.as(answer));

/** The indexer's answer about how far its dust event timeline goes, recording the cursor it was asked from. */
const servingEventTip =
  (maxId: number, asked: Recorder<DustLedgerEventTipSubscriptionVariables>) =>
  (
    variables: DustLedgerEventTipSubscriptionVariables,
  ): Stream.Stream<DustLedgerEventTipSubscription, ClientError | ServerError, SubscriptionClient> =>
    Stream.unwrap(
      Ref.update(asked, (all) => [...all, variables]).pipe(
        Effect.as(Stream.make({ dustLedgerEvents: { id: 1, maxId } })),
      ),
    );

/**
 * A chain that holds no dust event at all: the probe subscribes and the indexer has nothing to answer with.
 *
 * @remarks
 *   Not an empty stream — the indexer keeps the subscription open and simply never yields, because there is no dust
 *   ledger event of any kind for it to serve.
 */
const silentEventTip =
  (asked: Recorder<DustLedgerEventTipSubscriptionVariables>) =>
  (
    variables: DustLedgerEventTipSubscriptionVariables,
  ): Stream.Stream<DustLedgerEventTipSubscription, ClientError | ServerError, SubscriptionClient> =>
    Stream.unwrap(Ref.update(asked, (all) => [...all, variables]).pipe(Effect.as(Stream.never)));

/** Batching turned down so far that the event stream contributes nothing to what a short window collects. */
const service = (intervalMs: number) =>
  makeDefaultSyncService({
    indexerClientConnection,
    networkId,
    batchUpdates: { size: 100, timeout: 60_000, spacing: 0 },
    versionWatch: { intervalMs },
  });

const isVersionSignal = (update: WalletSyncUpdate): update is VersionSignalSyncUpdate =>
  update._tag === 'VersionSignal';

describe('watching the chain for a version the dust events never mention', () => {
  it('keeps signalling the tip version on a quiet chain, with the highest dust event id the source holds', async () => {
    const caughtUp = syncedWallet(41n);
    const tipAsked = recorder<BlockHashQueryVariables>();
    const eventTipAsked = recorder<DustLedgerEventTipSubscriptionVariables>();

    const collected = await service(20)
      .updates(caughtUp, fixtureSecretKey())
      .pipe(
        Stream.filter(isVersionSignal),
        Stream.take(2),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(v9Version), tipAsked)),
        Effect.provideService(DustLedgerEventTip.tag, servingEventTip(41, eventTipAsked)),
        Effect.provideService(DustLedgerEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([
      VersionSignalSyncUpdate.create(v9Version, 41),
      VersionSignalSyncUpdate.create(v9Version, 41),
    ]);
    // The tip is what the chain is on now, so the question is asked without an offset.
    expect(Effect.runSync(Ref.get(tipAsked))).toEqual([{ offset: null }, { offset: null }]);
    // The event-id question is asked from the wallet's own cursor: the event it last applied provably exists, so the
    // answer comes back at once, and the source has the least backfill to abandon.
    expect(Effect.runSync(Ref.get(eventTipAsked))).toEqual([{ id: 40 }, { id: 40 }]);

    // Folded, this is the hand-over: a caught-up wallet records the version the chain moved to.
    const [state] = makeDefaultSyncCapability().applyUpdate(caughtUp, Chunk.toArray(collected)[0], activeRange);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(v9Version)));
  });

  it('says nothing on a chain whose dust timeline has never held an event', async () => {
    // The one case the tip alone cannot settle. A dust ledger event does not have to touch either tree — a `ParamChange`
    // is one and moves neither — so `dustCommitmentEndIndex`/`dustGenerationEndIndex` at zero would be an unsound
    // proof that nothing is unread. Without a proof, the tick is skipped, and such a chain crosses on its first dust
    // event instead.
    const fresh = freshWallet();
    const eventTipAsked = recorder<DustLedgerEventTipSubscriptionVariables>();

    const collected = await service(5)
      .updates(fresh, fixtureSecretKey())
      .pipe(
        Stream.filter(isVersionSignal),
        Stream.interruptAfter('300 millis'),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(v9Version), recorder())),
        Effect.provideService(DustLedgerEventTip.tag, silentEventTip(eventTipAsked)),
        Effect.provideService(DustLedgerEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([]);
    // The probe was genuinely opened — the silence above is the indexer's, not a short circuit's.
    expect(Effect.runSync(Ref.get(eventTipAsked)).length).toBeGreaterThan(0);
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
            : Effect.succeed(tipBlock(v9Version)),
        ),
      );

    const collected = await service(20)
      .updates(caughtUp, fixtureSecretKey())
      .pipe(
        Stream.filter(isVersionSignal),
        Stream.take(1),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, flaky),
        Effect.provideService(DustLedgerEventTip.tag, servingEventTip(41, recorder())),
        Effect.provideService(DustLedgerEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([VersionSignalSyncUpdate.create(v9Version, 41)]);
    expect(Effect.runSync(Ref.get(attempts))).toHaveLength(2);
  });

  it('says nothing at all when the chain is still on the version the wallet started from', async () => {
    // The signal would be a provable no-op — the state's version only ever rises — so the tick stops at the tip query
    // and never opens the event-id probe. That is what keeps a settled wallet from polling a subscription forever.
    const caughtUp = syncedWallet(41n);
    const eventTipAsked = recorder<DustLedgerEventTipSubscriptionVariables>();

    const collected = await service(5)
      .updates(caughtUp, fixtureSecretKey())
      .pipe(
        Stream.filter(isVersionSignal),
        Stream.interruptAfter('150 millis'),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(v8Version), recorder())),
        Effect.provideService(DustLedgerEventTip.tag, servingEventTip(41, eventTipAsked)),
        Effect.provideService(DustLedgerEvents.tag, quietChain),
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
      .updates(caughtUp, fixtureSecretKey())
      .pipe(
        Stream.interruptAfter('100 millis'),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(v9Version), tipAsked)),
        Effect.provideService(DustLedgerEventTip.tag, servingEventTip(41, recorder())),
        Effect.provideService(DustLedgerEvents.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([]);
    expect(Effect.runSync(Ref.get(tipAsked))).toEqual([]);
  });
});
