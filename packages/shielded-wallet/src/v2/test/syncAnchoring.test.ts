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
 * The anchor step at the head of sync.
 *
 * @remarks
 *   A wallet that crossed the ledger-version boundary arrives with its coins as plain data and an empty tree. Rebuilding
 *   that tree is the sync layer's job because only sync holds the secret keys, and it has to happen **before the first
 *   event is applied**: the indexer numbers post-fork commitments onwards from where the pre-fork chain left off, so an
 *   event applied to an empty tree is the `values inserted non-linearly` wedge this whole feature exists to remove.
 *
 *   Both sources therefore lead with an anchor update — the indexer one fetches the collapsed updates, the simulator one
 *   constructs them off the chain it is simulating — and both capabilities fold it through `CoreWallet.anchor`. The
 *   chains here are real: one payment per block, so every commitment's Merkle index is its block's position, and the
 *   collapsed updates are the ones a source would genuinely hand over.
 */

import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion, type SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, type SimulatorState, genesisStrictness } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import {
  ZswapEvents,
  ZswapMerkleTreeCollapsedUpdate,
  type ZswapEventsSubscription,
  type ZswapEventsSubscriptionVariables,
  type ZswapMerkleTreeCollapsedUpdateQuery,
  type ZswapMerkleTreeCollapsedUpdateQueryVariables,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { type SubscriptionClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { type ClientError, ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Array as EArray, Chunk, Effect, Option, Order, Ref, type Scope, Stream, SubscriptionRef, pipe } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';
import { CoreWallet, type PendingAnchor, PublicKeys } from '../CoreWallet.js';
import {
  AnchorSyncUpdate,
  type EventsSyncUpdate,
  SimulatorSyncUpdate,
  WalletSyncUpdate,
  makeEventsSyncCapability,
  makeEventsSyncService,
  makeSimulatorSyncCapability,
  makeSimulatorSyncService,
} from '../Sync.js';
import { AnchoringError, SyncWalletError } from '../WalletError.js';

const networkId = NetworkId.NetworkId.Undeployed;
const tokenType = ledger.shieldedToken().raw;
const indexerClientConnection = {
  indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
  indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
};

/** The wallet under test, and the other party whose coins sit between its own. */
const myKeys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 3));
const theirKeys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 4));

/** The variant under test owns `[0, 7)`; the version that triggered the hand-over sits inside it. */
const activeRange = ProtocolVersion.makeRange(ProtocolVersion.ProtocolVersion(0n), ProtocolVersion.ProtocolVersion(7n));
const forkVersion = ProtocolVersion.ProtocolVersion(3n);

type Ownership = 'mine' | 'theirs';

/** One commitment on the simulated chain: whose coin it is, what it is, and where it landed. */
type ChainCoin = Readonly<{ owner: Ownership; coin: ledger.ShieldedCoinInfo; mtIndex: bigint }>;

type BuiltChain = Readonly<{
  simulator: Simulator;
  coins: readonly ChainCoin[];
  /** Height of the first block the chain has not produced — where a wallet that has seen all of it is parked. */
  nextBlockNumber: bigint;
}>;

/** Pays a fresh coin to `keys`: one output, therefore one commitment, therefore one Merkle index. */
const paymentTo = (
  keys: ledger.ZswapSecretKeys,
  value: bigint,
): [ledger.ShieldedCoinInfo, ledger.ProofErasedTransaction] => {
  const coin = ledger.createShieldedCoinInfo(tokenType, value);
  const output = ledger.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput(output, coin.type, coin.value);
  return [coin, ledger.Transaction.fromParts(networkId, offer, undefined, undefined).eraseProofs()];
};

/** Pays one coin on the chain and waits for the block carrying it, so payments and blocks stay in step. */
const payOnChain = (simulator: Simulator, owner: Ownership, value: bigint) =>
  Effect.gen(function* () {
    const [coin, tx] = paymentTo(owner === 'mine' ? myKeys() : theirKeys(), value);
    // Genesis strictness: these payments mint from nothing, exactly as the simulator's own genesis mints do.
    yield* simulator.submitTransaction(tx, { strictness: genesisStrictness });
    return coin;
  });

/**
 * Builds a chain holding one coin per entry of `ownerships`, in that order.
 *
 * @remarks
 *   One payment per block, awaited in turn, so each commitment gets an index of its own and the interleaving is exactly
 *   the one asked for: the coin at position `i` sits at Merkle index `i`. The premise is checked against the chain
 *   rather than assumed.
 */
const buildChain = (ownerships: readonly Ownership[]): Effect.Effect<BuiltChain, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const simulator = yield* Simulator.init({});
    const coins = yield* Effect.forEach(ownerships, (owner, index) =>
      payOnChain(simulator, owner, BigInt((index + 1) * 100)),
    );
    const firstFree = yield* simulator.query((state) => state.ledger.zswap.firstFree);

    expect(firstFree).toBe(BigInt(ownerships.length));

    return {
      simulator,
      coins: coins.map((coin, index): ChainCoin => ({ owner: ownerships[index], coin, mtIndex: BigInt(index) })),
      // The genesis block holds no payments, so the chain is one block taller than the number of coins.
      nextBlockNumber: BigInt(ownerships.length) + 1n,
    };
  });

/** What the migration would have carried across for the wallet under test, given this chain. */
const carriedFrom = (chain: BuiltChain): PendingAnchor => ({
  coins: pipe(
    chain.coins,
    EArray.filter((entry) => entry.owner === 'mine'),
    EArray.map(({ coin, mtIndex }) => ({ type: coin.type, nonce: coin.nonce, value: coin.value, mtIndex })),
  ),
  treeSize: BigInt(chain.coins.length),
});

const parkedProgress = (appliedIndex: bigint): SyncProgress.SyncProgressData => ({
  appliedIndex,
  highestRelevantWalletIndex: appliedIndex,
  highestIndex: appliedIndex,
  highestRelevantIndex: appliedIndex,
  isConnected: false,
});

/** A wallet as the cross-ledger migration leaves it: identity and position, coins still pending. */
const crossedWallet = (pendingAnchor: PendingAnchor, appliedIndex: bigint): CoreWallet =>
  CoreWallet.fromPreviousVersion({
    publicKeys: PublicKeys.fromSecretKeys(myKeys()),
    networkId,
    protocolVersion: forkVersion,
    progress: parkedProgress(appliedIndex),
    pendingAnchor,
  });

/** The collapsed updates a source would hand back for `gaps`, taken off the chain the wallet is anchored to. */
const updatesFor = (
  zswap: ledger.ZswapChainState,
  gaps: readonly Readonly<{ start: bigint; end: bigint }>[],
): readonly ledger.MerkleTreeCollapsedUpdate[] =>
  gaps.map((gap) => new ledger.MerkleTreeCollapsedUpdate(zswap, gap.start, gap.end));

/** The Merkle root of a chain's tree, read through a local state — the chain state does not expose one. */
const chainRoot = (zswap: ledger.ZswapChainState): bigint => {
  const root = new ledger.ZswapLocalState().applyCollapsedUpdate(
    new ledger.MerkleTreeCollapsedUpdate(zswap, 0n, zswap.firstFree - 1n),
  ).merkleTreeRoot;

  // A root every assertion below compares against, so a fixture without one would make them all vacuous.
  if (root === undefined) {
    throw new Error('The chain fixture has no Merkle root');
  }
  return root;
};

const coinIndices = (wallet: CoreWallet): readonly bigint[] =>
  pipe(
    [...wallet.state.coins],
    EArray.map((coin) => coin.mt_index),
    EArray.sort(Order.bigint),
  );

const balanceOf = (wallet: CoreWallet): bigint => [...wallet.state.coins].reduce((sum, coin) => sum + coin.value, 0n);

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * A chain, frozen into what the tests need of it once it has stopped growing.
 *
 * @remarks
 *   The simulator itself is scoped, but the ledger objects it produced outlive it, so the capability suites — which need
 *   a chain state and a payload, not a running chain — take this and build no simulator of their own.
 */
type Fixture = Readonly<{
  zswap: ledger.ZswapChainState;
  state: SimulatorState;
  pendingAnchor: PendingAnchor;
  /** The chain's events, encoded as the indexer serves them; kept as bytes because replaying consumes the objects. */
  eventHex: readonly string[];
}>;

const fixtureOf = (ownerships: readonly Ownership[]): Promise<Fixture> =>
  Effect.gen(function* () {
    const chain = yield* buildChain(ownerships);
    const state = yield* chain.simulator.getLatestState();

    return {
      zswap: state.ledger.zswap,
      state,
      pendingAnchor: carriedFrom(chain),
      eventHex: state.blocks.flatMap((block) =>
        block.transactions.flatMap((tx) => tx.result.events.map((event) => hex(event.serialize()))),
      ),
    };
  }).pipe(Effect.scoped, Effect.runPromise);

// Two coins of this wallet's, at indices 1 and 4, with four of somebody else's around them.
const interleaved: readonly Ownership[] = ['theirs', 'mine', 'theirs', 'theirs', 'mine', 'theirs'];

describe('folding the anchor step into the wallet state', () => {
  const eventsCapability = makeEventsSyncCapability();
  const simulatorCapability = makeSimulatorSyncCapability();

  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await fixtureOf(interleaved);
  });

  /** The anchor update a source hands over for this fixture's wallet: one collapsed update per gap, in gap order. */
  const anchorUpdate = (): AnchorSyncUpdate =>
    AnchorSyncUpdate.create(updatesFor(fixture.zswap, CoreWallet.anchorGaps(fixture.pendingAnchor)), myKeys());

  /** An event batch of the chain's own events, all of them past the parked cursor so nothing filters them out. */
  const eventBatch = (): WalletSyncUpdate =>
    WalletSyncUpdate.create(
      fixture.eventHex.map((raw, index): EventsSyncUpdate => ({
        _tag: 'EventsSyncUpdate',
        id: 11 + index,
        protocolVersion: Number(forkVersion),
        maxId: 11 + fixture.eventHex.length,
        raw,
      })),
      myKeys(),
    );

  it('rebuilds the carried coins into the state and reports no chain changes', () => {
    const parked = crossedWallet(fixture.pendingAnchor, 10n);

    const [state, result] = eventsCapability.applyUpdate(parked, anchorUpdate(), activeRange);

    expect(state.pendingAnchor).toBeUndefined();
    expect(coinIndices(state)).toEqual([1n, 4n]);
    expect(balanceOf(state)).toBe(700n);
    expect(state.state.firstFree).toBe(6n);
    expect(state.state.merkleTreeRoot).toBe(chainRoot(fixture.zswap));
    // Anchoring is not an observation of the chain: nothing that describes where sync has got to may move.
    expect(state.progress).toEqual(parked.progress);
    expect(state.protocolVersion).toBe(forkVersion);
    expect(result.changes).toEqual([]);
    expect(result.protocolVersion).toBe(Number(forkVersion));
  });

  it('rebuilds the same state through the simulator capability', () => {
    const parked = crossedWallet(fixture.pendingAnchor, 10n);

    const [state, result] = simulatorCapability.applyUpdate(parked, anchorUpdate(), activeRange);

    expect(state.pendingAnchor).toBeUndefined();
    expect(coinIndices(state)).toEqual([1n, 4n]);
    expect(state.state.merkleTreeRoot).toBe(chainRoot(fixture.zswap));
    expect(state.progress).toEqual(parked.progress);
    expect(result.changes).toEqual([]);
  });

  it('raises the anchoring failure rather than folding a wrong tree into the state', () => {
    // As many updates as gaps, but the first two swapped. The ledger applies a misaligned collapsed update without
    // complaint, so only the fold's own arithmetic stands between this and a silently wrong tree — and a wrong tree
    // must not become the wallet's state, so the failure is raised, exactly as a failure to read an event is.
    const [first, second, ...rest] = updatesFor(fixture.zswap, CoreWallet.anchorGaps(fixture.pendingAnchor));
    const parked = crossedWallet(fixture.pendingAnchor, 10n);

    expect(() =>
      eventsCapability.applyUpdate(parked, AnchorSyncUpdate.create([second, first, ...rest], myKeys()), activeRange),
    ).toThrow(AnchoringError);
  });

  it('leaves an event batch arriving before the anchor step untouched', () => {
    // Unreachable through either service, which lead with the anchor; asserted anyway, because applying events to an
    // un-anchored tree is precisely the wedge, and a no-op leaves the cursor where a re-fetch will find it.
    const parked = crossedWallet(fixture.pendingAnchor, 10n);

    const [state, result] = eventsCapability.applyUpdate(parked, eventBatch(), activeRange);

    expect(state).toBe(parked);
    expect(state.progress.appliedIndex).toBe(10n);
    expect(state.pendingAnchor).toEqual(fixture.pendingAnchor);
    expect(coinIndices(state)).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('leaves a block update arriving before the anchor step untouched', () => {
    const parked = crossedWallet(fixture.pendingAnchor, 0n);

    const [state, result] = simulatorCapability.applyUpdate(
      parked,
      SimulatorSyncUpdate.create(fixture.state, myKeys()),
      activeRange,
    );

    expect(state).toBe(parked);
    expect(state.progress.appliedIndex).toBe(0n);
    expect(state.pendingAnchor).toEqual(fixture.pendingAnchor);
    expect(coinIndices(state)).toEqual([]);
    expect(result.changes).toEqual([]);
  });
});

describe('fetching the anchor from the indexer', () => {
  let fixture: Fixture;
  let allMine: Fixture;

  beforeAll(async () => {
    fixture = await fixtureOf(interleaved);
    allMine = await fixtureOf(['mine', 'mine']);
  });

  /** The ranges the service asked the indexer for, in the order it asked. */
  const requests = (): Ref.Ref<readonly ZswapMerkleTreeCollapsedUpdateQueryVariables[]> =>
    Effect.runSync(Ref.make<readonly ZswapMerkleTreeCollapsedUpdateQueryVariables[]>([]));

  /**
   * The indexer's answer for a range: the real collapsed update off the chain, hex-encoded as the wire carries it.
   *
   * @remarks
   *   Injected at the query's own tag, so nothing reaches the wire and the service is exercised through the same code
   *   path it uses against a real indexer.
   */
  const collapsedUpdates =
    (zswap: ledger.ZswapChainState, seen: Ref.Ref<readonly ZswapMerkleTreeCollapsedUpdateQueryVariables[]>) =>
    (variables: ZswapMerkleTreeCollapsedUpdateQueryVariables) =>
      Ref.update(seen, (all) => [...all, variables]).pipe(
        Effect.map((): ZswapMerkleTreeCollapsedUpdateQuery => ({
          zswapMerkleTreeCollapsedUpdate: {
            startIndex: variables.startIndex,
            endIndex: variables.endIndex,
            update: hex(
              new ledger.MerkleTreeCollapsedUpdate(
                zswap,
                BigInt(variables.startIndex),
                BigInt(variables.endIndex),
              ).serialize(),
            ),
            protocolVersion: 2_000_000,
          },
        })),
      );

  const noEvents = (_variables: ZswapEventsSubscriptionVariables) =>
    Stream.empty as Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient>;

  const oneEvent =
    (raw: string) =>
    (
      _variables: ZswapEventsSubscriptionVariables,
    ): Stream.Stream<ZswapEventsSubscription, ClientError | ServerError, SubscriptionClient> =>
      Stream.make({ zswapLedgerEvents: { id: 11, raw, protocolVersion: Number(forkVersion), maxId: 11 } });

  const service = () => makeEventsSyncService({ indexerClientConnection, batchUpdates: { spacing: 0 } });

  it('emits the anchor before any event, built from exactly the ranges the gaps ask for', async () => {
    const parked = crossedWallet(fixture.pendingAnchor, 10n);
    const gaps = CoreWallet.anchorGaps(fixture.pendingAnchor);
    const seen = requests();

    const collected = await service()
      .updates(parked, myKeys())
      .pipe(
        Stream.runCollect,
        Effect.provideService(ZswapMerkleTreeCollapsedUpdate.tag, collapsedUpdates(fixture.zswap, seen)),
        Effect.provideService(ZswapEvents.tag, oneEvent(fixture.eventHex[0])),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected).map((update) => update._tag)).toEqual(['Anchor', 'Events']);
    expect(Effect.runSync(Ref.get(seen))).toEqual(
      gaps.map((gap) => ({ startIndex: Number(gap.start), endIndex: Number(gap.end) })),
    );

    // The updates are the right ones, in the right order: folding them rebuilds the very tree the chain has. A
    // reordered or misdeserialized batch cannot reach this root.
    const [anchored] = makeEventsSyncCapability().applyUpdate(parked, Chunk.toArray(collected)[0], activeRange);

    expect(anchored.state.firstFree).toBe(6n);
    expect(coinIndices(anchored)).toEqual([1n, 4n]);
    expect(anchored.state.merkleTreeRoot).toBe(chainRoot(fixture.zswap));
  });

  it('still anchors a wallet whose coins leave no gaps, without asking the indexer for anything', async () => {
    // Anchoring is not only the collapsed updates: it is what inserts the coins and clears the marker, so a payload
    // with nothing to fast-forward over still has to be delivered.
    const parked = crossedWallet(allMine.pendingAnchor, 10n);
    const seen = requests();

    const collected = await service()
      .updates(parked, myKeys())
      .pipe(
        Stream.runCollect,
        Effect.provideService(ZswapMerkleTreeCollapsedUpdate.tag, collapsedUpdates(allMine.zswap, seen)),
        Effect.provideService(ZswapEvents.tag, noEvents),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(CoreWallet.anchorGaps(allMine.pendingAnchor)).toEqual([]);
    expect(Chunk.toArray(collected).map((update) => update._tag)).toEqual(['Anchor']);
    expect(Effect.runSync(Ref.get(seen))).toEqual([]);

    const [anchored] = makeEventsSyncCapability().applyUpdate(parked, Chunk.toArray(collected)[0], activeRange);

    expect(anchored.pendingAnchor).toBeUndefined();
    expect(coinIndices(anchored)).toEqual([0n, 1n]);
    expect(anchored.state.firstFree).toBe(2n);
  });

  it('opens straight on the event subscription for a wallet that is not crossing', async () => {
    const settled = CoreWallet.initEmpty(myKeys(), networkId);
    const seen = requests();

    const collected = await service()
      .updates(settled, myKeys())
      .pipe(
        Stream.runCollect,
        Effect.provideService(ZswapMerkleTreeCollapsedUpdate.tag, collapsedUpdates(fixture.zswap, seen)),
        Effect.provideService(ZswapEvents.tag, oneEvent(fixture.eventHex[0])),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(Chunk.toArray(collected).map((update) => update._tag)).toEqual(['Events']);
    expect(Effect.runSync(Ref.get(seen))).toEqual([]);
  });

  it('surfaces an indexer failure in the stream error channel, where the retry schedule can see it', async () => {
    const parked = crossedWallet(fixture.pendingAnchor, 10n);
    const failing = (_variables: ZswapMerkleTreeCollapsedUpdateQueryVariables) =>
      Effect.fail(new ServerError({ message: 'the indexer is down' }));

    const error = await service()
      .updates(parked, myKeys())
      .pipe(
        Stream.runCollect,
        Effect.flip,
        Effect.provideService(ZswapMerkleTreeCollapsedUpdate.tag, failing),
        Effect.provideService(ZswapEvents.tag, noEvents),
        Effect.scoped,
        Effect.runPromise,
      );

    expect(error).toBeInstanceOf(SyncWalletError);
  });
});

describe('anchoring against the simulated chain', () => {
  /** The first state the wallet reaches that satisfies `predicate`. */
  const firstWhere = (
    walletRef: SubscriptionRef.SubscriptionRef<CoreWallet>,
    predicate: (wallet: CoreWallet) => boolean,
  ): Effect.Effect<CoreWallet> =>
    walletRef.changes.pipe(Stream.filter(predicate), Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow));

  it('anchors first, then applies the blocks that follow on top of the anchored tree', async () => {
    await Effect.gen(function* () {
      const chain = yield* buildChain(interleaved);
      const pendingAnchor = carriedFrom(chain);
      const parked = crossedWallet(pendingAnchor, chain.nextBlockNumber);
      const capability = makeSimulatorSyncCapability();

      const walletRef = yield* SubscriptionRef.make(parked);
      const tags = yield* Ref.make<readonly string[]>([]);

      yield* Effect.forkScoped(
        makeSimulatorSyncService({ simulator: chain.simulator })
          .updates(parked, myKeys())
          .pipe(
            Stream.runForEach((update) =>
              Ref.update(tags, (all) => [...all, update._tag]).pipe(
                Effect.andThen(
                  SubscriptionRef.update(walletRef, (wallet) => capability.applyUpdate(wallet, update, activeRange)[0]),
                ),
              ),
            ),
          ),
      );

      const anchored = yield* firstWhere(walletRef, (wallet) => wallet.pendingAnchor === undefined);

      // The balance is there without a single event having been applied: the pre-fork chain is not replayed.
      expect((yield* Ref.get(tags))[0]).toBe('Anchor');
      expect(coinIndices(anchored)).toEqual([1n, 4n]);
      expect(balanceOf(anchored)).toBe(700n);
      expect(anchored.state.firstFree).toBe(6n);
      expect(anchored.progress.appliedIndex).toBe(chain.nextBlockNumber);

      // The regression the drill found: the next commitment the chain produces lands at the index the pre-fork tree
      // ended on. Against an un-anchored tree the ledger rejects it as a non-linear insertion; against this one it
      // simply applies.
      yield* payOnChain(chain.simulator, 'mine', 900n);
      const advanced = yield* firstWhere(walletRef, (wallet) => wallet.state.firstFree === 7n);

      expect(coinIndices(advanced)).toEqual([1n, 4n, 6n]);
      expect(balanceOf(advanced)).toBe(1600n);
      expect(advanced.progress.appliedIndex).toBe(chain.nextBlockNumber + 1n);
      expect(advanced.pendingAnchor).toBeUndefined();
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
