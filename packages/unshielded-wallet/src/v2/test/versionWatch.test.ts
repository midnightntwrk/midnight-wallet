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
 * Noticing a protocol version the address's own timeline never mentions.
 *
 * @remarks
 *   An unshielded wallet learns which version the chain is on from the transactions it is served, and it is served only
 *   the transactions that touch its own address. The subscription's progress arm carries no version — it reports how
 *   far the address's timeline goes and nothing else — so on a chain that forks and then produces no traffic for this
 *   address, the wallet is never told. That is what the version watcher removes, by asking the chain its version on a
 *   timer and feeding the answer into the same `annotateVersion` path the transactions use.
 *
 *   The gate is the load-bearing half. Recording a version past the boundary is what triggers the hand-over, and the
 *   hand-over parks the sync cursor where it stands: a transaction still unapplied below the address's tip would then
 *   be re-fetched by the post-fork variant, and everything it created or spent would be applied by a variant that never
 *   saw the history leading to it. So the signal may be adopted only when the wallet is provably caught up on the
 *   source's **transaction ids**, which is why it carries the highest transaction id the source holds for this address
 *   and not merely a version.
 */

import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  BlockHash,
  UnshieldedTransactionTip,
  UnshieldedTransactions,
  type BlockHashQuery,
  type BlockHashQueryVariables,
  type UnshieldedTransactionTipSubscription,
  type UnshieldedTransactionTipSubscriptionVariables,
  type UnshieldedTransactionsSubscription,
  type UnshieldedTransactionsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type ClientError, ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Chunk, Effect, Ref, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultSyncCapability, makeDefaultSyncService } from '../Sync.js';
import { VersionSignalSyncUpdate, type WalletSyncUpdate } from '../SyncSchema.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { fixtureOwner, recordingHistory } from './syncFixtures.js';

const networkId = NetworkId.NetworkId.Undeployed;
const owner = fixtureOwner();

/** The variant under test owns `[0, 2_000_000)`. A version at or past that end is what triggers the hand-over. */
const activeRange = ProtocolVersion.makeRange(
  ProtocolVersion.ProtocolVersion(0n),
  ProtocolVersion.ProtocolVersion(2_000_000n),
);
const preForkVersion = 1_000_000;
const postForkVersion = 2_001_000;

/** A wallet that has applied the address's timeline up to `appliedId` and recorded the pre-fork version doing so. */
const syncedWallet = (appliedId: bigint): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.empty(),
    owner,
    { appliedId, highestTransactionId: appliedId },
    ProtocolVersion.ProtocolVersion(BigInt(preForkVersion)),
    networkId,
  );

// =============================================================================
// The fold
// =============================================================================

describe('folding a version signal into the wallet state', () => {
  const capability = makeDefaultSyncCapability(
    { indexerClientConnection: { indexerHttpUrl: 'http://unused' } },
    () => ({
      transactionHistoryService: recordingHistory().service,
    }),
  );

  it('records a post-boundary version once the wallet is caught up on the transaction ids', () => {
    const caughtUp = syncedWallet(41n);

    const state = capability
      .applyUpdate(caughtUp, VersionSignalSyncUpdate.create(postForkVersion, 41), activeRange)
      .pipe(EitherOps.getOrThrowLeft);

    // The version is the whole of it: recording one outside the activation range is what makes the runtime hand over.
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
    // A signal is an observation about the chain, not a piece of it. Nothing that describes what the wallet holds or
    // where its reading has got to may move.
    expect(state.progress.appliedId).toBe(caughtUp.progress.appliedId);
    expect(state.progress.highestTransactionId).toBe(caughtUp.progress.highestTransactionId);
    expect(state.progress.isConnected).toBe(caughtUp.progress.isConnected);
    expect(state.state).toBe(caughtUp.state);
  });

  it('ignores a signal while transactions below the address tip are still unapplied', () => {
    // The gate. Handing over here would park the cursor at 41 and leave transactions 42..97 to be applied by the
    // post-fork variant, which never saw the history leading to them.
    const behind = syncedWallet(41n);

    const state = capability
      .applyUpdate(behind, VersionSignalSyncUpdate.create(postForkVersion, 97), activeRange)
      .pipe(EitherOps.getOrThrowLeft);

    expect(state).toBe(behind);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(preForkVersion)));
  });

  it('adopts a signal from a chain that has never mentioned this address', () => {
    // The indexer reports the highest transaction id *for the subscribed address*, and zero when it holds none. A
    // fresh wallet on a forked chain that has never paid it is exactly the wallet that would otherwise sit pre-fork
    // forever, and nothing can be unapplied for it.
    const fresh = CoreWallet.init(owner, networkId);

    const state = capability
      .applyUpdate(fresh, VersionSignalSyncUpdate.create(postForkVersion, 0), activeRange)
      .pipe(EitherOps.getOrThrowLeft);

    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
  });

  it('leaves the state alone when the chain reports a version it has already passed', () => {
    // A reconnect against a lagging replica must not be able to drag a wallet back below a boundary it has crossed.
    const caughtUp = syncedWallet(41n);

    const state = capability
      .applyUpdate(caughtUp, VersionSignalSyncUpdate.create(7, 41), activeRange)
      .pipe(EitherOps.getOrThrowLeft);

    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(preForkVersion)));
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
    zswapEndIndex: 42,
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
 * A chain that has forked and gone quiet for this address: the subscription is open and will never say anything again.
 *
 * @remarks
 *   `Stream.never` rather than `Stream.empty`, and the difference is the whole point: an empty stream is a source that
 *   has finished, which is not the situation. The drill's chain kept its subscription open and simply had nothing to
 *   push, so the wallet sat there with no reason to believe anything had changed.
 */
const quietChain = (
  _variables: UnshieldedTransactionsSubscriptionVariables,
): Stream.Stream<UnshieldedTransactionsSubscription, ClientError | ServerError, SubscriptionClient> => Stream.never;

type Recorder<T> = Ref.Ref<readonly T[]>;

const recorder = <T>(): Recorder<T> => Effect.runSync(Ref.make<readonly T[]>([]));

/** The indexer's answer about its tip, recording what it was asked. */
const servingTip =
  (answer: BlockHashQuery, asked: Recorder<BlockHashQueryVariables>) => (variables: BlockHashQueryVariables) =>
    Ref.update(asked, (all) => [...all, variables]).pipe(Effect.as(answer));

/** The indexer's answer about how far this address's timeline goes, recording the cursor it was asked from. */
const servingAddressTip =
  (answer: UnshieldedTransactionTipSubscription, asked: Recorder<UnshieldedTransactionTipSubscriptionVariables>) =>
  (
    variables: UnshieldedTransactionTipSubscriptionVariables,
  ): Stream.Stream<UnshieldedTransactionTipSubscription, ClientError | ServerError, SubscriptionClient> =>
    Stream.unwrap(Ref.update(asked, (all) => [...all, variables]).pipe(Effect.as(Stream.make(answer))));

/** The progress frame the indexer emits before its first sleep, on any address. */
const addressProgress = (highestTransactionId: number): UnshieldedTransactionTipSubscription => ({
  unshieldedTransactions: { type: 'UnshieldedTransactionsProgress', highestTransactionId },
});

/** A transaction frame: the probe opened one past the cursor, so this one message means unapplied history exists. */
const addressTransaction: UnshieldedTransactionTipSubscription = {
  unshieldedTransactions: { type: 'UnshieldedTransaction' },
};

const service = (intervalMs: number) =>
  makeDefaultSyncService({ indexerClientConnection, versionWatch: { intervalMs } });

const isVersionSignal = (update: WalletSyncUpdate): update is VersionSignalSyncUpdate =>
  update.type === 'VersionSignal';

describe('watching the chain for a version this address never hears about', () => {
  it('keeps signalling the tip version on a quiet chain, with the highest transaction id the address has', async () => {
    const caughtUp = syncedWallet(41n);
    const tipAsked = recorder<BlockHashQueryVariables>();
    const addressTipAsked = recorder<UnshieldedTransactionTipSubscriptionVariables>();

    const collected = await service(20)
      .updates(caughtUp)
      .pipe(
        Stream.filter(isVersionSignal),
        Stream.take(2),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(postForkVersion), tipAsked)),
        Effect.provideService(UnshieldedTransactionTip.tag, servingAddressTip(addressProgress(41), addressTipAsked)),
        Effect.provideService(UnshieldedTransactions.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([
      VersionSignalSyncUpdate.create(postForkVersion, 41),
      VersionSignalSyncUpdate.create(postForkVersion, 41),
    ]);
    // The tip is what the chain is on now, so the question is asked without an offset.
    expect(Effect.runSync(Ref.get(tipAsked))).toEqual([{ offset: null }, { offset: null }]);
    // One PAST the wallet's own cursor, unlike the sync stream. The indexer's cursor is inclusive, so asking at the
    // cursor itself would re-deliver the already-applied boundary transaction, and that frame racing the progress one
    // would look like unapplied history forever.
    expect(Effect.runSync(Ref.get(addressTipAsked))).toEqual([
      { address: owner.address, transactionId: 42 },
      { address: owner.address, transactionId: 42 },
    ]);

    // Folded, this is the hand-over: a caught-up wallet records the version the chain moved to.
    const state = makeDefaultSyncCapability({ indexerClientConnection }, () => ({
      transactionHistoryService: recordingHistory().service,
    }))
      .applyUpdate(caughtUp, Chunk.toArray(collected)[0], activeRange)
      .pipe(EitherOps.getOrThrowLeft);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
  });

  it('says nothing on a tick that finds a transaction waiting one past the cursor', async () => {
    // The probe is opened where the wallet has applied nothing yet, so a transaction frame is proof of unapplied
    // history. There is no version to be read off it — the tip's version is the chain's, not that transaction's — so
    // the tick is skipped and the transaction itself will carry the version when sync reaches it.
    const caughtUp = syncedWallet(41n);

    const collected = await service(5)
      .updates(caughtUp)
      .pipe(
        Stream.filter(isVersionSignal),
        Stream.interruptAfter('150 millis'),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(postForkVersion), recorder())),
        Effect.provideService(UnshieldedTransactionTip.tag, servingAddressTip(addressTransaction, recorder())),
        Effect.provideService(UnshieldedTransactions.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([]);
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
            : Effect.succeed(tipBlock(postForkVersion)),
        ),
      );

    const collected = await service(20)
      .updates(caughtUp)
      .pipe(
        Stream.filter(isVersionSignal),
        Stream.take(1),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, flaky),
        Effect.provideService(UnshieldedTransactionTip.tag, servingAddressTip(addressProgress(41), recorder())),
        Effect.provideService(UnshieldedTransactions.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([VersionSignalSyncUpdate.create(postForkVersion, 41)]);
    expect(Effect.runSync(Ref.get(attempts))).toHaveLength(2);
  });

  it('says nothing at all when the chain is still on the version the wallet started from', async () => {
    // The signal would be a provable no-op — the state's version only ever rises — so the tick stops at the tip query
    // and never opens the address probe. That is what keeps a settled wallet from polling a subscription forever.
    const caughtUp = syncedWallet(41n);
    const addressTipAsked = recorder<UnshieldedTransactionTipSubscriptionVariables>();

    const collected = await service(5)
      .updates(caughtUp)
      .pipe(
        Stream.filter(isVersionSignal),
        Stream.interruptAfter('150 millis'),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(preForkVersion), recorder())),
        Effect.provideService(UnshieldedTransactionTip.tag, servingAddressTip(addressProgress(41), addressTipAsked)),
        Effect.provideService(UnshieldedTransactions.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([]);
    expect(Effect.runSync(Ref.get(addressTipAsked))).toEqual([]);
  });

  it('does not watch at all when the interval is turned off', async () => {
    const caughtUp = syncedWallet(41n);
    const tipAsked = recorder<BlockHashQueryVariables>();

    const collected = await service(0)
      .updates(caughtUp)
      .pipe(
        Stream.interruptAfter('100 millis'),
        Stream.runCollect,
        Effect.provideService(BlockHash.tag, servingTip(tipBlock(postForkVersion), tipAsked)),
        Effect.provideService(UnshieldedTransactionTip.tag, servingAddressTip(addressProgress(41), recorder())),
        Effect.provideService(UnshieldedTransactions.tag, quietChain),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected)).toEqual([]);
    expect(Effect.runSync(Ref.get(tipAsked))).toEqual([]);
  });
});
