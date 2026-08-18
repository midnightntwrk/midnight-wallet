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
 * A dust wallet crossing a hard fork and re-discovering its dust from the replayed timeline.
 *
 * @remarks
 *   Every other test of this machinery specifies one seam. This drives all of them at once: a real ledger-v8 dust chain
 *   registers Night for dust generation, the pre-fork variant syncs the events it produced, the timeline reaches the
 *   boundary version, the wallet hands over to the ledger-v9 variant with a state holding _no dust_, and that variant
 *   finds the same dust again by syncing the indexer's replay.
 *
 *   Which is the whole point of the corrected design: nothing about the dust crosses the boundary. The migration is
 *   allowed to carry identity and a place in the timeline, and the dust is re-discovered by ordinary synchronization.
 *   If the wallet ends up whole here, it did so through the sync path it uses every day.
 *
 *   **Unit tier, and complete — with no integration companion.** The shielded proof needs one: its replay re-mints
 *   equivalent coins, so only the ledger team's real v8-to-v9 state translation can say whether the tree it rebuilds is
 *   the tree the fork actually produced. Dust needs no such thing, because the two ledger versions turn out to encode a
 *   `dustInitialUtxo` event identically apart from its header — so the replay here is the same event bytes, and the
 *   post-fork wallet's dust is comparable to the pre-fork wallet's directly, UTXO for UTXO and root for root. The
 *   `describe` block below establishes exactly that, and it is the load-bearing assumption of the whole file: if a
 *   ledger release ever changes the encoding, it fails and the model is retired rather than quietly becoming a
 *   fiction.
 *
 *   **What this proof does not do, and why.** The shielded proof ends by spending the re-discovered coins into the chain
 *   and watching it accept them, which is what ties the wallet's rebuilt Merkle path to a root the ledger holds. There
 *   is no dust analogue available here: dust is spent as the fee half of a transaction, which a chain has to validate,
 *   and this harness has no post-fork chain — the replay is an event log, which is what an indexer serves and all a
 *   fork's aftermath consists of. What stands in its place is stronger than the spend on one axis and weaker on
 *   another: the post-fork wallet's own commitment-tree root is asserted equal to the pre-fork wallet's, so the tree
 *   the path would be built against is byte-identical, but no ledger is asked to accept anything.
 */

import {
  DustSecretKey as PreForkSecretKey,
  Event as PreForkEvent,
  LedgerParameters as PreForkLedgerParameters,
} from '@midnight-ntwrk/ledger-v8';
import {
  DustSecretKey as PostForkSecretKey,
  LedgerParameters as PostForkLedgerParameters,
  Event as PostForkEvent,
} from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Deferred, Effect, Option, Queue, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet as PreForkWallet } from '../v1/CoreWallet.js';
import { V1Tag } from '../v1/RunningV1Variant.js';
import {
  DUST_EVENT_COUNT,
  buildDustChain,
  dustSeed,
  freshWallet as freshPreForkWallet,
} from '../v1/test/dustEvents.js';
import { CoreWallet as PostForkWallet } from '../v2/CoreWallet.js';
import { V2Tag } from '../v2/RunningV2Variant.js';
import { dustParameters as postForkDustParameters, freshWallet as freshPostForkWallet } from '../v2/test/dustEvents.js';
import { type TimelineEvent, numberedFrom, reframeAsPostFork } from './forkReplay.js';
import { makeForkWallet } from './forkWallet.js';
import {
  balanceAt,
  commitmentTreeRoot,
  dustCount,
  dustIdentities,
  dustIndices,
  generationTreeRoot,
} from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

/**
 * The boundary, stated once.
 *
 * `forkVersion` is where the post-fork variant is registered _and_ the version the indexer reports the replayed events
 * under — the same number reaching the runtime through registration and through the timeline, which is the whole point
 * of D5. It is deliberately an arbitrary number: the real fork's protocol version is not final, and nothing here may
 * depend on it.
 */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);

/** A version bump the pre-fork variant owns: inside `[MinSupportedVersion, forkVersion)`, so it must not migrate. */
const withinRangeVersion = ProtocolVersion.ProtocolVersion(5n);

/** What the indexer reports the pre-fork history under. */
const preForkVersion = Number(ProtocolVersion.MinSupportedVersion);

/**
 * The event id the replay opens at.
 *
 * @remarks
 *   One past the pre-fork history, because there is only one id space: the indexer numbers its replay onwards from the id
 *   it had reached when the fork happened. This is therefore also where a migrated wallet's parked cursor is waiting.
 */
const boundaryId = DUST_EVENT_COUNT + 1;

/** Where the replay ends, and so where a wallet that consumed all of it lands. */
const replayEndId = boundaryId + DUST_EVENT_COUNT - 1;

/** Every dust UTXO the fixture's registrations produce, in commitment order. */
const dustIndicesAtFork = [0n, 1n, 2n, 3n];

/** The pre-fork history as the indexer served it: the fixture's events, numbered from one, at the pre-fork version. */
const preForkHistory = (eventBytes: readonly Uint8Array[]): readonly TimelineEvent[] =>
  numberedFrom(eventBytes, 1, preForkVersion);

/** The replay: the same events again, renumbered from the boundary and reported at the post-fork version. */
const replayOf = (eventBytes: readonly Uint8Array[]): readonly TimelineEvent[] =>
  numberedFrom(eventBytes, boundaryId, Number(forkVersion));

/** Re-reports the last event of a run at `version`, which is how a timeline announces a version change. */
const reportedAt = (events: readonly TimelineEvent[], version: ProtocolVersion.ProtocolVersion) =>
  events.map((event, index) => (index === events.length - 1 ? { ...event, protocolVersion: Number(version) } : event));

/**
 * What a wallet that read this whole history holds, computed by the pre-fork ledger and nothing else.
 *
 * @remarks
 *   The independent oracle. The fixture's dust is sampled fresh per chain — the backing Night nonces are random — so
 *   there are no constants to write down the way the shielded proof writes down its coin values. This stands in for
 *   them: `CoreWallet` folding the events directly, with no variant, no runtime and no fork anywhere near it. A
 *   post-fork wallet that agrees with this agrees with a reading the fork machinery had no hand in producing.
 */
const walletOfHistory = (eventBytes: readonly Uint8Array[], at: Date): PreForkWallet => {
  const [wallet] = PreForkWallet.applyEventsWithChanges(
    freshPreForkWallet(),
    PreForkSecretKey.fromSeed(dustSeed()),
    eventBytes.map((bytes) => PreForkEvent.deserialize(bytes)),
    at,
  );
  return wallet;
};

describe('the two ledger versions agree on what a dust event says', () => {
  it('derives the same dust public key from one seed, which is what makes the replayed dust the same dust', () => {
    // The lemma everything below rests on. A `dustInitialUtxo` event names its owner's dust public key, and a wallet
    // only takes the events addressed to its own; if the two ledger versions derived different keys from one seed, the
    // replay would be somebody else's dust and the post-fork wallet would end up empty.
    const seed = dustSeed();

    expect(PostForkSecretKey.fromSeed(seed).publicKey).toBe(PreForkSecretKey.fromSeed(seed).publicKey);
  });

  it('values dust against the same initial parameters', () => {
    // Dust's local state is parameterised where shielded's is not, and the migration supplies the post-fork parameters
    // rather than carrying the pre-fork ones. Comparing balances across the boundary only means something because the
    // two sets agree.
    const preFork = PreForkLedgerParameters.initialParameters().dust;
    const postFork = PostForkLedgerParameters.initialParameters().dust;

    expect(postFork.nightDustRatio).toBe(preFork.nightDustRatio);
    expect(postFork.generationDecayRate).toBe(preFork.generationDecayRate);
    expect(postFork.dustGracePeriodSeconds).toBe(preFork.dustGracePeriodSeconds);
  });

  it('refuses the other version framing, which is why a replayed event has to be re-framed at all', async () => {
    const chain = await buildDustChain();

    // Not a modelling convenience: a ledger-v9 wallet cannot be handed a ledger-v8 event, full stop. Whatever replays
    // the timeline after a fork has to re-emit it under the new version, and this is the wall that says so.
    expect(() => PostForkEvent.deserialize(chain.eventBytes[0])).toThrowError(/midnight:event/);
  });

  it('builds the same dust from a re-framed event as from the original', async () => {
    const chain = await buildDustChain();

    const preFork = walletOfHistory(chain.eventBytes, chain.syncTime);
    const [postFork] = PostForkWallet.applyEventsWithChanges(
      freshPostForkWallet(),
      PostForkSecretKey.fromSeed(dustSeed()),
      chain.eventBytes.map((bytes) => PostForkEvent.deserialize(reframeAsPostFork(bytes))),
      chain.syncTime,
    );

    // The claim the replay model stands on, and the reason this package needs no state translation to prove a fork:
    // re-framing changes the header and nothing else, so ledger-v9 reconstructs the very dust ledger-v8 did.
    expect(dustIdentities(postFork)).toEqual(dustIdentities(preFork));
    expect(commitmentTreeRoot(postFork)).toBe(commitmentTreeRoot(preFork));
    expect(generationTreeRoot(postFork)).toBe(generationTreeRoot(preFork));
    expect(balanceAt(postFork, chain.syncTime)).toBe(balanceAt(preFork, chain.syncTime));
  });
});

describe('a dust wallet crossing a hard fork', () => {
  it(
    'starts the new variant with no dust and re-discovers it from the replayed timeline',
    async () =>
      Effect.gen(function* () {
        const chain = yield* Effect.promise(() => buildDustChain());
        const replay = replayOf(chain.eventBytes);
        const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
        const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

        const wallet = makeForkWallet({
          preFork: Stream.fromQueue(wire),
          replayed: Deferred.await(replayed),
          networkId,
          forkVersion,
          seed: dustSeed(),
          dustParameters: {
            preFork: PreForkLedgerParameters.initialParameters().dust,
            postFork: postForkDustParameters(),
          },
          syncTime: chain.syncTime,
        });
        yield* Effect.addFinalizer(() => wallet.stop);
        yield* wallet.start;

        // --- pre-fork: the ledger-v8 variant syncs the ledger-v8 chain's events -----------------------------------
        yield* Queue.offer(wire, preForkHistory(chain.eventBytes));

        const preFork = yield* wallet.awaitState((state) => dustCount(state.state) === DUST_EVENT_COUNT);
        expect(yield* wallet.activeTag).toBe(V1Tag);
        expect(dustIndices(preFork.state)).toEqual(dustIndicesAtFork);
        expect(preFork.state.progress.appliedIndex).toBe(BigInt(DUST_EVENT_COUNT));
        // Everything the pre-fork wallet knows, recorded before the hand-over destroys the ledger-v8 objects holding it.
        const preForkDust = dustIdentities(preFork.state);
        const preForkCommitmentRoot = commitmentTreeRoot(preFork.state);
        const preForkGenerationRoot = generationTreeRoot(preFork.state);
        const preForkBalance = balanceAt(preFork.state, chain.syncTime);
        expect(preForkCommitmentRoot).toBeDefined();
        expect(preForkBalance).toBeGreaterThan(0n);

        // --- the fork: the indexer's first post-fork event reaches the still-open pre-fork subscription ------------
        // It is the replay's own opening event, delivered in the encoding the pre-fork variant can read. The pre-fork
        // variant will not apply it — it is past the end of that variant's range — so all that reaches the wallet from
        // it is the version it was reported under.
        yield* Queue.offer(wire, [replay[0]]);
        yield* Deferred.succeed(replayed, replay);

        const migration = yield* wallet.awaitMigration;
        expect(yield* wallet.activeTag).toBe(V2Tag);

        // What the pre-fork variant handed over: its identity, the version that triggered the hand-over, and a cursor
        // parked on the last event it applied — the boundary event was observed and annotated, deliberately not applied.
        expect(migration.from.dustPublicKey).toBe(PreForkSecretKey.fromSeed(dustSeed()).publicKey);
        expect(migration.from.protocolVersion).toBe(forkVersion);
        expect(migration.from.appliedIndex).toBe(BigInt(DUST_EVENT_COUNT));

        // And what it produced: a wallet holding no dust at all — no UTXOs, nothing pending, neither tree standing —
        // because exactly that dust is about to arrive again as replayed events, and carrying it would double-count what
        // the replay is delivering.
        const empty = freshPostForkWallet();
        expect(migration.to.dustCount).toBe(0);
        expect(migration.to.pendingDustCount).toBe(0);
        expect(migration.to.commitmentTreeRoot).toBe(commitmentTreeRoot(empty));
        expect(migration.to.generationTreeRoot).toBe(generationTreeRoot(empty));
        // **Parked, not rewound.** The one place the two cursor semantics are directly distinguishable: the state the
        // migration produced, before any sync has touched it. The replay continues the indexer's event ids from where the
        // fork found them, so this wallet resumes on the cursor its predecessor stopped at. A migration that reset to
        // zero fails here — and only here, because a cursor behind the replay still reads all of it.
        expect(migration.to.appliedIndex).toBe(migration.from.appliedIndex);
        expect(migration.to.appliedIndex).toBe(BigInt(DUST_EVENT_COUNT));
        // Identity is the one thing that does cross: without this key the replay decrypts into nothing.
        expect(migration.to.dustPublicKey).toBe(PostForkSecretKey.fromSeed(dustSeed()).publicKey);
        expect(migration.to.networkId).toBe(networkId);
        // Kept so the restarted variant sits inside its own activation range instead of signalling backwards at once.
        expect(migration.to.protocolVersion).toBe(forkVersion);
        // The empty state is valued against the parameters the migration was handed, not against anything carried over.
        expect(migration.to.nightDustRatio).toBe(postForkDustParameters().nightDustRatio);

        // --- post-fork: the dust is re-discovered, not carried -----------------------------------------------------
        const postFork = yield* wallet.awaitState(
          (state) => state.version >= forkVersion && dustCount(state.state) === DUST_EVENT_COUNT,
        );
        // The same dust, not merely the same amount of it: same nonces, same backing Night, same creation times, same
        // initial values, at the same commitment indices.
        expect(dustIdentities(postFork.state)).toEqual(preForkDust);
        // And the same trees, which is what a spend's Merkle path would be built against.
        expect(commitmentTreeRoot(postFork.state)).toBe(preForkCommitmentRoot);
        expect(generationTreeRoot(postFork.state)).toBe(preForkGenerationRoot);
        // Valued at the same instant on both sides, because dust generates and decays and a balance means nothing
        // without one.
        expect(balanceAt(postFork.state, chain.syncTime)).toBe(preForkBalance);
        // Read onwards from the boundary rather than from the start of anything: the replay opens where the parked
        // cursor is waiting and runs to its own end.
        expect(postFork.state.progress.appliedIndex).toBe(BigInt(replayEndId));
      }).pipe(Effect.scoped, Effect.runPromise),
    60_000,
  );

  it(
    'does not migrate on a version bump that stays inside the running variant range',
    async () =>
      Effect.gen(function* () {
        // Same timeline, same registration, one number different: the indexer reports a version the pre-fork variant
        // still owns. The version is written onto the state either way — what must not happen is a hand-over.
        const chain = yield* Effect.promise(() => buildDustChain());
        const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();
        const replayed = yield* Deferred.make<readonly TimelineEvent[]>();

        const wallet = makeForkWallet({
          preFork: Stream.fromQueue(wire),
          replayed: Deferred.await(replayed),
          networkId,
          forkVersion,
          seed: dustSeed(),
          dustParameters: {
            preFork: PreForkLedgerParameters.initialParameters().dust,
            postFork: postForkDustParameters(),
          },
          syncTime: chain.syncTime,
        });
        yield* Effect.addFinalizer(() => wallet.stop);
        yield* wallet.start;

        yield* Queue.offer(wire, reportedAt(preForkHistory(chain.eventBytes), withinRangeVersion));

        const state = yield* wallet.awaitState(
          (current) =>
            current.state.protocolVersion === withinRangeVersion && dustCount(current.state) === DUST_EVENT_COUNT,
        );

        // Seen and annotated on the wallet's own state — the annotation the runtime reads — and, being inside the range,
        // it decided nothing. (Asserted here rather than on `ProtocolState.version`, which the runtime publishes one
        // state emission behind a within-range bump.)
        expect(state.state.protocolVersion).toBe(withinRangeVersion);
        expect(yield* wallet.activeTag).toBe(V1Tag);
        expect(yield* wallet.migration).toStrictEqual(Option.none());
        // The bumped event was applied rather than deferred, so nothing was left behind for a variant that never ran.
        expect(state.state.progress.appliedIndex).toBe(BigInt(DUST_EVENT_COUNT));
        expect(dustIndices(state.state)).toEqual(dustIndicesAtFork);
      }).pipe(Effect.scoped, Effect.runPromise),
    60_000,
  );

  it(
    'migrates a wallet whose first sync already contains the fork',
    async () =>
      Effect.gen(function* () {
        // Scenario 2: a wallet started from seed after the fork has happened. Its pre-fork variant meets the whole
        // pre-fork history and the boundary in a single batch, so the split happens *within* one update rather than
        // across two.
        const chain = yield* Effect.promise(() => buildDustChain());
        const replay = replayOf(chain.eventBytes);
        const wire = yield* Queue.unbounded<readonly TimelineEvent[]>();

        const wallet = makeForkWallet({
          preFork: Stream.fromQueue(wire),
          replayed: Effect.succeed(replay),
          networkId,
          forkVersion,
          seed: dustSeed(),
          dustParameters: {
            preFork: PreForkLedgerParameters.initialParameters().dust,
            postFork: postForkDustParameters(),
          },
          syncTime: chain.syncTime,
        });
        yield* Effect.addFinalizer(() => wallet.stop);
        yield* wallet.start;

        yield* Queue.offer(wire, [...preForkHistory(chain.eventBytes), replay[0]]);

        const migration = yield* wallet.awaitMigration;
        expect(migration.from.appliedIndex).toBe(BigInt(DUST_EVENT_COUNT));
        expect(migration.to.dustCount).toBe(0);
        // Reached in one batch rather than two, and the cursor still parks on the boundary: where the split happened
        // does not change what the next variant inherits.
        expect(migration.to.appliedIndex).toBe(BigInt(DUST_EVENT_COUNT));

        // The end state is the same as the live transition reaches, which is the point: how the timeline was delivered is
        // not supposed to change what the wallet ends up holding.
        const postFork = yield* wallet.awaitState(
          (state) => state.version >= forkVersion && dustCount(state.state) === DUST_EVENT_COUNT,
        );
        expect(yield* wallet.activeTag).toBe(V2Tag);
        // Compared against the history folded straight into a `CoreWallet`, because this run never exposes a pre-fork
        // state to compare with — the boundary arrived in the wallet's very first batch.
        const expected = walletOfHistory(chain.eventBytes, chain.syncTime);
        expect(dustIdentities(postFork.state)).toEqual(dustIdentities(expected));
        expect(commitmentTreeRoot(postFork.state)).toBe(commitmentTreeRoot(expected));
        expect(balanceAt(postFork.state, chain.syncTime)).toBe(balanceAt(expected, chain.syncTime));
        expect(postFork.state.progress.appliedIndex).toBe(BigInt(replayEndId));
      }).pipe(Effect.scoped, Effect.runPromise),
    60_000,
  );
});
