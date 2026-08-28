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
import { ProtocolVersion, SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Either, Iterable, Order, pipe, Record, Array as Arr } from 'effect';
import { AnchoringError, InvalidCoinHashesError, type WalletError } from './WalletError.js';

export type PublicKeys = {
  coinPublicKey: ledger.CoinPublicKey;
  encryptionPublicKey: ledger.EncPublicKey;
};
export const PublicKeys = {
  fromSecretKeys: (secretKeys: ledger.ZswapSecretKeys): PublicKeys => {
    return {
      coinPublicKey: secretKeys.coinPublicKey,
      encryptionPublicKey: secretKeys.encryptionPublicKey,
    };
  },
};

export type CoinHashesMap = Readonly<
  Record<ledger.Nonce, { nullifier: ledger.Nullifier; commitment: ledger.CoinCommitment }>
>;
export const CoinHashesMap = {
  empty: {} satisfies CoinHashesMap,
  pickAllCoins(state: ledger.ZswapLocalState): readonly ledger.ShieldedCoinInfo[] {
    return [...state.coins, ...state.pendingOutputs.values().map(([coin]) => coin)];
  },
  assertValid(map: CoinHashesMap, state: ledger.ZswapLocalState): Either.Either<void, Set<ledger.Nonce>> {
    const coins = CoinHashesMap.pickAllCoins(state);
    const coinNonces = new Set(Iterable.map(coins, (coin) => coin.nonce));
    const definedNonces = new Set(Object.keys(map));
    const missingNonces = coinNonces.difference(definedNonces);
    return missingNonces.size === 0 ? Either.void : Either.left(missingNonces);
  },
  updateWithCoins(
    secretKeys: ledger.ZswapSecretKeys,
    existing: CoinHashesMap,
    coins: Iterable<ledger.ShieldedCoinInfo>,
  ): CoinHashesMap {
    return Record.fromIterableWith(coins, (coin) => [
      coin.nonce,
      existing[coin.nonce] ?? {
        commitment: ledger.coinCommitment(coin, secretKeys.coinPublicKey),
        nullifier: ledger.coinNullifier(coin, secretKeys.coinSecretKey),
      },
    ]);
  },
  updateWithNewCoins(
    secretKeys: ledger.ZswapSecretKeys,
    existing: CoinHashesMap,
    coins: Iterable<ledger.ShieldedCoinInfo>,
  ): CoinHashesMap {
    const newMap = CoinHashesMap.updateWithCoins(secretKeys, CoinHashesMap.empty, coins);
    return Record.union(existing, newMap, (a) => a);
  },
  init(secretKeys: ledger.ZswapSecretKeys, coins: Iterable<ledger.ShieldedCoinInfo>): CoinHashesMap {
    return CoinHashesMap.updateWithCoins(secretKeys, {}, coins);
  },
};

/**
 * A coin carried across the ledger-version boundary as plain data.
 *
 * @remarks
 *   The projection of the previous ledger's `QualifiedShieldedCoinInfo`: token type, nonce and value are what
 *   {@link ledger.ZswapLocalState.insertCoin} needs to re-create the coin, and `mtIndex` (the previous ledger's
 *   `mt_index`) is where its commitment sits in the global tree — the position the re-created coin must land at again
 *   for its Merkle paths to be the chain's. Plain strings and bigints on purpose: this is the shape that crosses a
 *   WASM-module boundary and a serialization boundary unchanged.
 */
export type CarriedCoin = Readonly<{
  type: string;
  nonce: string;
  value: bigint;
  mtIndex: bigint;
}>;

/**
 * What a wallet still owes itself after crossing the ledger-version boundary: its coins, and the tree they lived in.
 *
 * @remarks
 *   Present on a {@link CoreWallet} from the cross-ledger migration until {@link CoreWallet.anchor} completes, and
 *   serialized with the wallet so a snapshot taken mid-crossing loses nothing. `treeSize` is the previous local state's
 *   `firstFree`: the index the rebuilt commitment tree has to reach — coins where the wallet's own commitments sit,
 *   collapsed updates everywhere else — before the wallet can sync or spend on this side of the fork.
 */
export type PendingAnchor = Readonly<{
  coins: readonly CarriedCoin[];
  treeSize: bigint;
}>;

export type CoreWallet = Readonly<{
  state: ledger.ZswapLocalState;
  publicKeys: PublicKeys;
  protocolVersion: ProtocolVersion.ProtocolVersion;
  progress: SyncProgress.SyncProgress;
  networkId: string;
  coinHashes: CoinHashesMap;
  /** Set between the cross-ledger migration and {@link CoreWallet.anchor}; absent on a wallet that is not crossing. */
  pendingAnchor?: PendingAnchor;
}>;

export const CoreWallet = {
  init(localState: ledger.ZswapLocalState, secretKeys: ledger.ZswapSecretKeys, networkId: string): CoreWallet {
    const publicKeys = PublicKeys.fromSecretKeys(secretKeys);
    const coinHashes = CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(localState));
    const progress = SyncProgress.createSyncProgress();
    const protocolVersion = ProtocolVersion.MinSupportedVersion;
    return { state: localState, publicKeys, networkId, coinHashes, progress, protocolVersion };
  },

  empty(publicKeys: PublicKeys, networkId: string): CoreWallet {
    return {
      state: new ledger.ZswapLocalState(),
      publicKeys,
      networkId,
      coinHashes: CoinHashesMap.empty,
      progress: SyncProgress.createSyncProgress(),
      protocolVersion: ProtocolVersion.MinSupportedVersion,
    };
  },

  restore(
    localState: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    syncProgress: Omit<SyncProgress.SyncProgressData, 'isConnected'>,
    protocolVersion: bigint,
    networkId: string,
  ): CoreWallet {
    const publicKeys = PublicKeys.fromSecretKeys(secretKeys);
    const coinHashes = CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(localState));
    return {
      state: localState,
      publicKeys,
      networkId,
      coinHashes,
      progress: SyncProgress.createSyncProgress(syncProgress),
      protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
    };
  },

  restoreWithCoinHashes(
    publicKeys: PublicKeys,
    localState: ledger.ZswapLocalState,
    coinHashes: CoinHashesMap,
    syncProgress: SyncProgress.SyncProgressData,
    protocolVersion: bigint,
    networkId: string,
  ): Either.Either<CoreWallet, WalletError> {
    return CoinHashesMap.assertValid(coinHashes, localState).pipe(
      Either.mapBoth({
        onLeft: (missingNonces) =>
          new InvalidCoinHashesError({ message: 'Missing coin hashes for coins present in the state', missingNonces }),
        onRight: () => ({
          state: localState,
          publicKeys,
          networkId,
          coinHashes,
          progress: SyncProgress.createSyncProgress(syncProgress),
          protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
        }),
      }),
    );
  },

  initEmpty(keys: ledger.ZswapSecretKeys, networkId: string): CoreWallet {
    return this.empty(PublicKeys.fromSecretKeys(keys), networkId);
  },

  /**
   * Records an observed protocol version on the wallet, never going backwards.
   *
   * @remarks
   *   The version is a signal, not a measurement: writing one outside the running variant's activation range is what
   *   makes it hand over to the next variant. A source that briefly reports an older version — a reconnect replaying
   *   from an earlier cursor, say — must therefore not be able to drag the wallet back below a boundary it has already
   *   crossed, which would ask the runtime to migrate backwards. Taking the maximum makes that unrepresentable.
   * @param wallet The wallet to annotate.
   * @param version The protocol version just observed.
   * @returns `wallet` unchanged if it already records `version` or a later one, otherwise a copy recording `version`.
   */
  withProtocolVersion(wallet: CoreWallet, version: ProtocolVersion.ProtocolVersion): CoreWallet {
    return version > wallet.protocolVersion ? { ...wallet, protocolVersion: version } : wallet;
  },

  /**
   * Projects a wallet inherited from the previous ledger version onto a fresh state of this one.
   *
   * @remarks
   *   No ledger object crosses the boundary. Serialized local state is not readable by this ledger version, so what
   *   crosses is identity, position, and — as plain data — the coins: the public keys, the network, the protocol
   *   version that triggered the hand-over (kept so the new variant starts inside its own activation range rather than
   *   immediately signalling backwards), the cursor the previous variant stopped at, and the {@link PendingAnchor}
   *   payload the migration projected out of the previous local state. The local Merkle tree itself starts empty:
   *   rebuilding it takes the secret keys — coins are indexed by nullifier — which migration by design does not hold.
   *   {@link CoreWallet.anchor}, run by the sync layer that does hold them, is what turns the payload back into a tree.
   *
   *   **Sync progress is parked at the fork, not rewound**: the previous wallet's cursor crosses unchanged. The indexer
   *   numbers post-fork events onwards from whatever id it had reached when the fork happened, never from zero, so
   *   resuming from the inherited cursor is what puts this wallet in front of them. Rewinding to zero would park it on
   *   a stretch of history that this ledger version's events do not occupy. What does not cross is `isConnected`: no
   *   sync is running behind this state yet.
   *
   *   Coin hashes start empty for the same reason the tree does: they are commitments and nullifiers computed under the
   *   previous ledger's codec, and this version recomputes its own from the keys once anchoring rebuilds the state.
   * @param previous The plain data read off the previous ledger version's wallet.
   * @returns A wallet of this ledger version positioned at the fork, its coins pending re-anchoring.
   */
  fromPreviousVersion(previous: {
    readonly publicKeys: PublicKeys;
    readonly networkId: string;
    readonly protocolVersion: bigint;
    readonly progress: SyncProgress.SyncProgressData;
    readonly pendingAnchor?: PendingAnchor;
  }): CoreWallet {
    return {
      state: new ledger.ZswapLocalState(),
      publicKeys: previous.publicKeys,
      networkId: previous.networkId,
      coinHashes: CoinHashesMap.empty,
      progress: SyncProgress.createSyncProgress({ ...previous.progress, isConnected: false }),
      protocolVersion: ProtocolVersion.ProtocolVersion(previous.protocolVersion),
      ...(previous.pendingAnchor !== undefined ? { pendingAnchor: previous.pendingAnchor } : {}),
    };
  },

  /**
   * The stretches of the pre-fork commitment tree that anchoring has to fast-forward over.
   *
   * @remarks
   *   The carried coins occupy some of the indices in `[0, treeSize)`; these are the maximal runs of everything else —
   *   the other parties' commitments the rebuilt tree needs as collapsed updates but not as coins. Bounds are
   *   **inclusive** on both ends, matching what `new MerkleTreeCollapsedUpdate(state, start, end)` takes, and the
   *   ranges come back ascending and non-adjacent whatever order the coins were listed in: together with the coin
   *   indices they partition `[0, treeSize)` exactly. No coins means one gap spanning the whole tree; `treeSize === 0`
   *   means no gaps at all.
   *
   *   Assumes what holds for any payload projected off a real ledger state: every `mtIndex` is distinct and below
   *   `treeSize`. A payload violating that cannot describe a tree, and {@link CoreWallet.anchor} answers it with a Left
   *   rather than anything here needing to.
   * @param pendingAnchor The carried coins and the size of the tree they lived in.
   * @returns The inclusive index ranges between and around the carried coins, ascending.
   */
  anchorGaps(pendingAnchor: PendingAnchor): readonly Readonly<{ start: bigint; end: bigint }>[] {
    const start: Readonly<{ cursor: bigint; gaps: readonly Readonly<{ start: bigint; end: bigint }>[] }> = {
      cursor: 0n,
      gaps: [],
    };
    const walked = pipe(
      pendingAnchor.coins,
      Arr.map((coin) => coin.mtIndex),
      Arr.sort(Order.bigint),
      Arr.reduce(start, ({ cursor, gaps }, index) => ({
        cursor: index + 1n,
        gaps: index > cursor ? [...gaps, { start: cursor, end: index - 1n }] : gaps,
      })),
    );
    return walked.cursor < pendingAnchor.treeSize
      ? [...walked.gaps, { start: walked.cursor, end: pendingAnchor.treeSize - 1n }]
      : walked.gaps;
  },

  /**
   * Rebuilds this wallet's local state from its carried coins and the collapsed updates covering everything else.
   *
   * @remarks
   *   The inverse of what the cross-ledger migration flattened: starting from an empty local state, the fold walks `[0,
   *   treeSize)` in Merkle-index order, inserting each carried coin at the index it used to occupy and applying one
   *   collapsed update per gap of {@link CoreWallet.anchorGaps} — `updates` must correspond to those gaps one to one, in
   *   order. On success the wallet's coin hashes are recomputed from the keys and the rebuilt state, the pending
   *   payload is cleared, and identity, cursor, network and protocol version cross unchanged.
   *
   *   The fold checks its own arithmetic instead of trusting the ledger to: applying a collapsed update built for the
   *   wrong range does **not** throw — the local tree silently adopts the range and jumps `firstFree` to its end — so
   *   after every update the fold verifies `firstFree` reached the end of the gap the update stood in for, before every
   *   insertion that the coin lands at its recorded index, and at the end that the tree is exactly `treeSize` tall.
   *   Total on purpose: every failure, the ledger's own throws included, comes back as a Left, and a wallet with
   *   nothing pending is refused rather than passed through — asking to anchor one is a wiring fault the caller should
   *   hear about, not smooth over.
   * @param wallet A wallet carrying a {@link PendingAnchor}.
   * @param secretKeys The wallet's keys; insertion indexes coins by nullifier, which cannot be computed without them.
   * @param updates One collapsed update per gap of {@link CoreWallet.anchorGaps}, in ascending gap order.
   * @returns The anchored wallet, or the {@link AnchoringError} (or ledger error) that stopped the rebuild.
   */
  anchor(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    updates: readonly ledger.MerkleTreeCollapsedUpdate[],
  ): Either.Either<CoreWallet, WalletError> {
    type Step = Readonly<{
      position: bigint;
      run: (state: ledger.ZswapLocalState) => Either.Either<ledger.ZswapLocalState, WalletError>;
    }>;

    const rebuild = (pending: PendingAnchor): Either.Either<ledger.ZswapLocalState, WalletError> => {
      const freshState: Either.Either<ledger.ZswapLocalState, WalletError> = Either.right(new ledger.ZswapLocalState());
      const gaps = CoreWallet.anchorGaps(pending);
      const gapSteps: readonly Step[] = Arr.zipWith(gaps, updates, (gap, update) => ({
        position: gap.start,
        run: (state) =>
          pipe(
            LedgerOps.ledgerTry(() => state.applyCollapsedUpdate(update)),
            Either.filterOrLeft(
              (next) => next.firstFree === gap.end + 1n,
              (next) =>
                new AnchoringError({
                  message: `A collapsed update did not cover the gap it stands in for: expected to fast-forward to index ${gap.end + 1n}, reached ${next.firstFree}`,
                }),
            ),
          ),
      }));
      const coinSteps: readonly Step[] = pending.coins.map((coin) => ({
        position: coin.mtIndex,
        run: (state) =>
          state.firstFree === coin.mtIndex
            ? LedgerOps.ledgerTry(() =>
                state.insertCoin(secretKeys, { type: coin.type, nonce: coin.nonce, value: coin.value }),
              )
            : Either.left(
                new AnchoringError({
                  message: `A carried coin would land at index ${state.firstFree} instead of the index ${coin.mtIndex} it had in the pre-fork tree`,
                }),
              ),
      }));

      return updates.length !== gaps.length
        ? Either.left(
            new AnchoringError({
              message: `Anchoring needs exactly one collapsed update per gap: ${gaps.length} gaps, ${updates.length} updates`,
            }),
          )
        : pipe(
            [...gapSteps, ...coinSteps],
            Arr.sort(Order.mapInput(Order.bigint, (step: Step) => step.position)),
            Arr.reduce(freshState, (acc, step) => Either.flatMap(acc, step.run)),
            Either.filterOrLeft(
              (state) => state.firstFree === pending.treeSize,
              (state) =>
                new AnchoringError({
                  message: `The rebuilt tree reached index ${state.firstFree} instead of the carried tree size ${pending.treeSize}`,
                }),
            ),
          );
    };

    return pipe(
      Either.fromNullable(
        wallet.pendingAnchor,
        () => new AnchoringError({ message: 'Nothing to anchor: this wallet carries no pending anchor payload' }),
      ),
      Either.flatMap(rebuild),
      Either.map((state): CoreWallet => ({
        state,
        publicKeys: wallet.publicKeys,
        networkId: wallet.networkId,
        coinHashes: CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(state)),
        progress: wallet.progress,
        protocolVersion: wallet.protocolVersion,
      })),
    );
  },

  applyCollapsedUpdate(wallet: CoreWallet, collapsed: ledger.MerkleTreeCollapsedUpdate): CoreWallet {
    const newState = wallet.state.applyCollapsedUpdate(collapsed);
    return { ...wallet, state: newState };
  },

  apply<TOffer extends ledger.ZswapOffer<ledger.Proofish>>(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    offer: TOffer,
  ): CoreWallet {
    const newState = wallet.state.apply(secretKeys, offer);
    const newCoinHashes = CoinHashesMap.updateWithCoins(
      secretKeys,
      wallet.coinHashes,
      CoinHashesMap.pickAllCoins(newState),
    );
    return { ...wallet, state: newState, coinHashes: newCoinHashes };
  },

  replayEventsWithChanges(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    events: ledger.Event[],
  ): [CoreWallet, ledger.ZswapStateChanges[]] {
    const stateWithChanges = wallet.state.replayEventsWithChanges(secretKeys, events);
    const newState = stateWithChanges.state;
    const newCoinHashes = CoinHashesMap.updateWithCoins(
      secretKeys,
      wallet.coinHashes,
      CoinHashesMap.pickAllCoins(newState),
    );

    const updatedWallet = { ...wallet, state: newState, coinHashes: newCoinHashes };

    return [updatedWallet, stateWithChanges.changes];
  },

  updateProgress(
    wallet: CoreWallet,
    {
      appliedIndex,
      highestRelevantWalletIndex,
      highestIndex,
      highestRelevantIndex,
      isConnected,
    }: Partial<SyncProgress.SyncProgressData>,
  ): CoreWallet {
    const updatedProgress = SyncProgress.createSyncProgress({
      appliedIndex: appliedIndex ?? wallet.progress.appliedIndex,
      highestRelevantWalletIndex: highestRelevantWalletIndex ?? wallet.progress.highestRelevantWalletIndex,
      highestIndex: highestIndex ?? wallet.progress.highestIndex,
      highestRelevantIndex: highestRelevantIndex ?? wallet.progress.highestRelevantIndex,
      isConnected: isConnected ?? wallet.progress.isConnected,
    });
    return { ...wallet, progress: updatedProgress };
  },

  // TODO: Remove after tx history is implemented
  addTransaction(wallet: CoreWallet, _tx: ledger.FinalizedTransaction): CoreWallet {
    return wallet;
  },

  /* not implemented until this is done https://shielded.atlassian.net/browse/PM-19678 */
  revertTransaction<TTx extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>>(
    wallet: CoreWallet,
    tx: TTx,
  ): CoreWallet {
    const newState = wallet.state.revertTransaction(tx);

    return { ...wallet, state: newState };
  },

  // TODO: Remove after tx history is implemented
  updateTxHistory(wallet: CoreWallet, _newTxs: readonly ledger.FinalizedTransaction[]): CoreWallet {
    return wallet;
  },

  spendCoins(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    coins: ReadonlyArray<ledger.QualifiedShieldedCoinInfo>,
    segment: number,
  ): [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, CoreWallet] {
    const [offers, newLocalState] = pipe(
      coins,
      Arr.reduce(
        [[], wallet.state] as [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, ledger.ZswapLocalState],
        ([accOffers, localState], coinToSpend) => {
          const [nextState, newInput] = localState.spend(secretKeys, coinToSpend, segment);
          const inputOffer = ledger.ZswapOffer.fromInput(newInput, coinToSpend.type, coinToSpend.value);
          return [accOffers.concat([inputOffer]), nextState] as [
            ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>,
            ledger.ZswapLocalState,
          ];
        },
      ),
    );
    const updated: CoreWallet = { ...wallet, state: newLocalState };
    return [offers, updated];
  },

  watchCoins(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    coins: ReadonlyArray<ledger.ShieldedCoinInfo>,
  ): CoreWallet {
    const newLocalState = coins.reduce(
      (localState: ledger.ZswapLocalState, coin) => localState.watchFor(wallet.publicKeys.coinPublicKey, coin),
      wallet.state,
    );
    const newCoinHashes = CoinHashesMap.updateWithNewCoins(secretKeys, wallet.coinHashes, coins);
    return { ...wallet, state: newLocalState, coinHashes: newCoinHashes };
  },
};
