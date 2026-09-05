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
import { Either, Iterable, pipe, Record, Array as Arr } from 'effect';
import { InvalidCoinHashesError, type WalletError } from './WalletError.js';

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

export type CoreWallet = Readonly<{
  state: ledger.ZswapLocalState;
  publicKeys: PublicKeys;
  protocolVersion: ProtocolVersion.ProtocolVersion;
  progress: SyncProgress.SyncProgress;
  networkId: string;
  coinHashes: CoinHashesMap;
  /**
   * This wallet's coin hashes have never been computed, and {@link CoinHashesMap.empty} means "not yet", not "none".
   *
   * @remarks
   *   Set by the cross-ledger migration and cleared by the first sync update, which is the first moment secret keys are
   *   at hand — see {@link CoreWallet.fromPreviousVersion} and {@link CoreWallet.resolveCoinHashes}. Stated as a field
   *   rather than inferred from "empty map beside a non-empty state" because an empty map is a perfectly good value for
   *   a wallet holding nothing, and overloading it would make one shape mean two things. Being a field, it is also what
   *   lets a snapshot taken mid-crossing declare itself: {@link CoreWallet.restoreWithCoinHashes} goes on rejecting a
   *   snapshot whose hashes do not cover its coins, because only a wallet carrying this marker is permitted the gap.
   *   `true` is the only inhabitant, so "pending" and "absent" are the only two states.
   */
  coinHashesPending?: true;
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

  /**
   * Restores a wallet whose coin hashes were never computed — a snapshot taken mid-crossing.
   *
   * @remarks
   *   The counterpart of {@link CoreWallet.restoreWithCoinHashes} for the one shape that validation would otherwise
   *   refuse: a full local state, carried across the ledger-version boundary as bytes, beside an empty hash map. The
   *   hashes are commitments and nullifiers, and computing them needs the secret keys a deserializer does not hold, so
   *   the wallet comes back still marked pending and the first sync update fills them in
   *   ({@link CoreWallet.resolveCoinHashes}). Total: there is nothing here to reject, which is exactly why it is a
   *   separate entry point rather than a flag on the validating one.
   * @param publicKeys The identity the snapshot declared.
   * @param localState The local state the snapshot carried.
   * @param syncProgress Where the snapshot's reading had got to.
   * @param protocolVersion The version the snapshot was written under.
   * @param networkId The network the snapshot claims.
   * @returns A wallet holding that state, its coin hashes still pending.
   */
  restoreWithPendingCoinHashes(
    publicKeys: PublicKeys,
    localState: ledger.ZswapLocalState,
    syncProgress: SyncProgress.SyncProgressData,
    protocolVersion: bigint,
    networkId: string,
  ): CoreWallet {
    return {
      state: localState,
      publicKeys,
      networkId,
      coinHashes: CoinHashesMap.empty,
      coinHashesPending: true,
      progress: SyncProgress.createSyncProgress(syncProgress),
      protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
    };
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
   * Adopts a wallet inherited from the previous ledger version: its local state, its identity, and its position.
   *
   * @remarks
   *   The state passed in is this ledger version's own object, decoded from the previous version's bytes — the two majors
   *   share the `zswap-local-state` codec, so the crossing is a round-trip rather than a reconstruction (see
   *   `Migration.makeCrossLedgerMigration`, and the characterization test that pins the codec). So everything the
   *   previous wallet's tree held arrives intact: its coins at the Merkle indices the chain gave them, the height it
   *   had reached, and the outputs it was still expecting. What also crosses is the public keys, the network, the
   *   protocol version that triggered the hand-over (kept so the new variant starts inside its own activation range
   *   rather than immediately signalling backwards), and the cursor the previous variant stopped at.
   *
   *   **Sync progress is parked at the fork, not rewound**: the previous wallet's cursor crosses unchanged. The indexer
   *   numbers ledger-v9 events onwards from whatever id it had reached when the fork happened, never from zero, so
   *   resuming from the inherited cursor is what puts this wallet in front of them. Rewinding to zero would park it on
   *   a stretch of history that this ledger version's events do not occupy. What does not cross is `isConnected`: no
   *   sync is running behind this state yet.
   *
   *   The one thing the bytes cannot supply is the coin hashes: commitments and nullifiers are computed from the secret
   *   keys, which a migration by design does not hold. They are therefore left empty and marked
   *   {@link CoreWallet.coinHashesPending}, for {@link CoreWallet.resolveCoinHashes} to fill in at the first sync update
   *   — the first place in this variant where keys and state meet.
   * @param previous The identity and position read off the previous ledger version's wallet, and its decoded state.
   * @returns A wallet of this ledger version holding what its predecessor held, positioned at the fork.
   */
  fromPreviousVersion(previous: {
    readonly state: ledger.ZswapLocalState;
    readonly publicKeys: PublicKeys;
    readonly networkId: string;
    readonly protocolVersion: bigint;
    readonly progress: SyncProgress.SyncProgressData;
  }): CoreWallet {
    return {
      state: previous.state,
      publicKeys: previous.publicKeys,
      networkId: previous.networkId,
      coinHashes: CoinHashesMap.empty,
      coinHashesPending: true,
      progress: SyncProgress.createSyncProgress({ ...previous.progress, isConnected: false }),
      protocolVersion: ProtocolVersion.ProtocolVersion(previous.protocolVersion),
    };
  },

  /**
   * Computes the coin hashes a wallet crossed the ledger-version boundary without.
   *
   * @remarks
   *   The other half of {@link CoreWallet.fromPreviousVersion}. A migrated wallet arrives holding its whole local state
   *   but no commitments or nullifiers for it, because deriving those needs the secret keys — so the first sync update,
   *   which carries them, is where the gap closes. Applied at the head of both sync capabilities, before anything else
   *   they do, so a batch that turns out to be empty still resolves them: a wallet that crossed into a quiet timeline
   *   must not be left unable to name its own coins.
   *
   *   Idempotent and self-clearing: without the marker this is the identity, so it costs a field read on every update
   *   thereafter and nothing else.
   * @param wallet The wallet to complete.
   * @param secretKeys The keys the update arrived with.
   * @returns `wallet` unchanged if its hashes were never pending, otherwise a copy holding them.
   */
  resolveCoinHashes(wallet: CoreWallet, secretKeys: ledger.ZswapSecretKeys): CoreWallet {
    return wallet.coinHashesPending === undefined
      ? wallet
      : {
          state: wallet.state,
          publicKeys: wallet.publicKeys,
          networkId: wallet.networkId,
          coinHashes: CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(wallet.state)),
          progress: wallet.progress,
          protocolVersion: wallet.protocolVersion,
        };
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
