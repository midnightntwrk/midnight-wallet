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
 *   the transactions that touch its own address. On a chain that has forked and then produced no traffic for this
 *   address, that is nothing at all, and the wallet would stay on the variant it was running with everything built
 *   through it routed to that variant's ledger.
 *
 *   The subscription's progress arm is what closes it. It reports how far this address's timeline goes, it arrives on a
 *   silent address exactly as it does on a busy one, and it carries the protocol version at the chain's tip. The source
 *   splits that version off into a `VersionSignal` emitted alongside the progress bookkeeping, and the signal feeds the
 *   same `annotateVersion` path a transaction's own version feeds.
 *
 *   The gate is the load-bearing half. Recording a version past the boundary is what triggers the hand-over, and the
 *   hand-over parks the sync cursor where it stands: a transaction still unapplied below the address's tip would then
 *   be re-fetched by the post-fork variant, and everything it created or spent would be applied by a variant that never
 *   saw the history leading to it. So the signal may be adopted only when the wallet is provably caught up on the
 *   source's **transaction ids**, which is why it carries the highest transaction id the source holds for this address
 *   and not merely a version. One frame states both, so the two can no longer disagree with each other.
 *
 *   The last suite is that scenario end to end, through a real running variant: the shipped indexer-backed source and the
 *   shipped capability, over a chain that has forked and gone silent. What it asserts is the hand-over signal itself,
 *   which is what the runtime acts on.
 */

import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  UnshieldedTransactions,
  type UnshieldedTransactionsSubscription,
  type UnshieldedTransactionsSubscriptionVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { StateChange, VersionChangeType } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type ClientError, type ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Chunk, Duration, Effect, Exit, Fiber, Option, Scope, Sink, Stream, SubscriptionRef } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { RunningV2Variant } from '../RunningV2Variant.js';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
import { makeDefaultSigningService } from '../Signing.js';
import { makeDefaultSyncCapability, makeDefaultSyncService } from '../Sync.js';
import { VersionSignalSyncUpdate, type WalletSyncUpdate } from '../SyncSchema.js';
import { makeDefaultTransactingCapability } from '../Transacting.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { fixtureOwner, fixtureTransaction, recordingHistory } from './syncFixtures.js';

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

const indexerClientConnection = {
  indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
  indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
};

const capabilityOf = () =>
  makeDefaultSyncCapability({ indexerClientConnection }, () => ({
    transactionHistoryService: recordingHistory().service,
  }));

// =============================================================================
// The fold
// =============================================================================

describe('folding a version signal into the wallet state', () => {
  const capability = capabilityOf();

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

  it('still splits the timeline on a transaction that carries the version itself', () => {
    // The other route to the same annotation, unchanged by any of this: a transaction reported at or past the boundary
    // is left entirely unapplied and only its version is recorded, so the next variant re-fetches it from a cursor that
    // never moved.
    const caughtUp = syncedWallet(41n);

    const state = capability
      .applyUpdate(caughtUp, fixtureTransaction({ id: 42, protocolVersion: postForkVersion }), activeRange)
      .pipe(EitherOps.getOrThrowLeft);

    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
    expect(state.progress.appliedId).toBe(41n);
    expect(state.state).toBe(caughtUp.state);
  });
});

// =============================================================================
// The source
// =============================================================================

/**
 * The progress frame the indexer emits before its first sleep, and keeps emitting while nothing happens.
 *
 * @remarks
 *   `protocolVersion` is the version at the chain's TIP, not the version of anything on this address's timeline, and zero
 *   is not a version at all — it is the indexer saying it has indexed no block yet.
 */
const progressFrame = (highestTransactionId: number, protocolVersion: number): UnshieldedTransactionsSubscription => ({
  unshieldedTransactions: { type: 'UnshieldedTransactionsProgress', highestTransactionId, protocolVersion },
});

type ChainSource = (
  variables: UnshieldedTransactionsSubscriptionVariables,
) => Stream.Stream<UnshieldedTransactionsSubscription, ClientError | ServerError, SubscriptionClient>;

/**
 * A chain that serves these frames and then closes, so a collection over it terminates on its own.
 *
 * @remarks
 *   Used wherever the assertion is about the exact sequence the source produced, which a closing stream makes exact
 *   rather than time-bounded.
 */
const chainServing =
  (...frames: readonly UnshieldedTransactionsSubscription[]): ChainSource =>
  () =>
    Stream.fromIterable(frames);

/**
 * A chain that serves these frames and then goes quiet without ever closing.
 *
 * @remarks
 *   The drill's situation, and the difference from {@link chainServing} is the whole point: the subscription stayed open
 *   and simply had nothing more to push, so the wallet had no reason to believe anything had changed.
 */
const chainPushing =
  (...frames: readonly UnshieldedTransactionsSubscription[]): ChainSource =>
  () =>
    Stream.concat(Stream.fromIterable(frames), Stream.never);

const collect = (wallet: CoreWallet, chain: ChainSource): Promise<readonly WalletSyncUpdate[]> =>
  makeDefaultSyncService({ indexerClientConnection })
    .updates(wallet)
    .pipe(
      Stream.runCollect,
      Effect.map(Chunk.toArray),
      Effect.provideService(UnshieldedTransactions.tag, chain),
      Effect.scoped,
      Effect.runPromise,
    );

describe('reading the chain version off the progress frames', () => {
  it('signals the tip version alongside the progress it already reported', async () => {
    // The headline. Nothing on this address's timeline says anything, and the wallet still learns the chain moved.
    const collected = await collect(syncedWallet(41n), chainServing(progressFrame(41, postForkVersion)));

    expect(collected).toEqual([
      { type: 'UnshieldedTransactionsProgress', highestTransactionId: 41, protocolVersion: postForkVersion },
      VersionSignalSyncUpdate.create(postForkVersion, 41),
    ]);

    // Folded, this is the hand-over: a caught-up wallet records the version the chain moved to.
    const state = capabilityOf()
      .applyUpdate(syncedWallet(41n), collected[1], activeRange)
      .pipe(EitherOps.getOrThrowLeft);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
  });

  it('says nothing when the chain is still on the version the wallet started from', async () => {
    // A signal here could only ever be a no-op — the recorded version never goes backwards — so it is not made, and a
    // settled wallet's progress frames stay pure bookkeeping however often they arrive.
    const collected = await collect(syncedWallet(41n), chainServing(progressFrame(41, preForkVersion)));

    expect(collected).toEqual([
      { type: 'UnshieldedTransactionsProgress', highestTransactionId: 41, protocolVersion: preForkVersion },
    ]);
  });

  it('ignores the zero a source that has indexed no block yet reports', async () => {
    // Zero is the indexer saying it cannot answer, not a chain at version zero. Read as a version it would be a claim
    // about the chain that nobody made.
    const fresh = CoreWallet.init(owner, networkId);

    const collected = await collect(fresh, chainServing(progressFrame(0, 0), progressFrame(0, postForkVersion)));

    expect(collected).toEqual([
      { type: 'UnshieldedTransactionsProgress', highestTransactionId: 0, protocolVersion: 0 },
      { type: 'UnshieldedTransactionsProgress', highestTransactionId: 0, protocolVersion: postForkVersion },
      VersionSignalSyncUpdate.create(postForkVersion, 0),
    ]);
  });

  it('carries the tip of the timeline with the version, so unread history still holds the hand-over back', async () => {
    // Gate parity, now fed from one frame instead of two requests. The source states what it saw; refusing it is the
    // capability's job, and it refuses because 97 transactions exist and 41 have been applied.
    const behind = syncedWallet(41n);

    const collected = await collect(behind, chainServing(progressFrame(97, postForkVersion)));

    expect(collected).toEqual([
      { type: 'UnshieldedTransactionsProgress', highestTransactionId: 97, protocolVersion: postForkVersion },
      VersionSignalSyncUpdate.create(postForkVersion, 97),
    ]);

    const state = collected.reduce(
      (wallet, update) => capabilityOf().applyUpdate(wallet, update, activeRange).pipe(EitherOps.getOrThrowLeft),
      behind,
    );
    // The progress bookkeeping landed; the version did not.
    expect(state.progress.highestTransactionId).toBe(97n);
    expect(state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(preForkVersion)));
  });
});

// =============================================================================
// The drill regression, through a running variant
// =============================================================================

/**
 * The variant's context, wired to the shipped indexer-backed source and the shipped fold.
 *
 * @remarks
 *   Only the transport is stood in for. The sync service, the capability that folds what it emits, and the variant that
 *   turns a recorded version into a hand-over signal are the ones the package ships — which is the point: the drill
 *   found a gap between those three, not inside any one of them.
 */
const variantContextOf = (): RunningV2Variant.Context<string, WalletSyncUpdate> => {
  const configuration = { indexerClientConnection, networkId };
  const coinsAndBalancesCapability = makeDefaultCoinsAndBalancesCapability();
  const keysCapability = makeDefaultKeysCapability();
  const coinSelection = () => undefined;
  const transactionHistoryService = recordingHistory().service;

  return {
    serializationCapability: makeDefaultV2SerializationCapability(),
    syncService: makeDefaultSyncService(configuration),
    syncCapability: makeDefaultSyncCapability(configuration, () => ({ transactionHistoryService })),
    transactingCapability: makeDefaultTransactingCapability(configuration, () => ({
      coinSelection,
      coinsAndBalancesCapability,
      keysCapability,
    })),
    signingService: makeDefaultSigningService(),
    coinsAndBalancesCapability,
    keysCapability,
    coinSelection,
    transactionHistoryService,
  };
};

describe('an unshielded wallet on the quiet side of a fork', () => {
  it('crosses on a progress frame alone, without a single transaction ever arriving', async () => {
    // The drill, reproduced: a wallet caught up to the tip of a chain that has forked and then produced no traffic for
    // this address at all. The only thing it is ever served is the frame the indexer emits when it has nothing to say.
    const observed = await Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make(syncedWallet(41n));
      const scope = yield* Scope.make();
      const variant = new RunningV2Variant(scope, { stateRef, activationRange: activeRange }, variantContextOf());

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
        variant.startSync().pipe(Stream.runScoped(Sink.drain), Effect.provideService(Scope.Scope, scope)),
      );

      const version = yield* Fiber.join(handOver);
      const state = yield* SubscriptionRef.get(stateRef);
      yield* Scope.close(scope, Exit.void);

      return { version, state };
    }).pipe(
      Effect.provideService(UnshieldedTransactions.tag, chainPushing(progressFrame(41, postForkVersion))),
      Effect.scoped,
      Effect.runPromise,
    );

    // The signal the runtime acts on: this variant no longer owns the wallet.
    expect(observed.version).toBe(BigInt(postForkVersion));
    // And the state carries it, which is what the runtime reads when it decides which variant does.
    expect(observed.state.protocolVersion).toBe(ProtocolVersion.ProtocolVersion(BigInt(postForkVersion)));
    // Nothing of the chain was consumed to get there.
    expect(observed.state.progress.appliedId).toBe(41n);
  });
});
