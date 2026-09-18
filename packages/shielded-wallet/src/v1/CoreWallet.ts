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
import * as ledger from '@midnight-ntwrk/ledger-v8';
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
   *   No coin data crosses the boundary here, and that is a decision rather than an oversight. This is the oldest variant
   *   the wallet registers and no ledger version below it exists, so nothing ever hands a state to this projection: it
   *   is shape parity with the twin at `src/v2`, which is the variant a real crossing lands in. That twin adopts the
   *   previous wallet's local state whole, by deserializing its bytes — the two ledger majors share the
   *   `zswap-local-state` codec — because the chain's state translation continues the commitment tree across the fork
   *   and the indexer re-emits none of the ledger-v8 timeline (see `src/v2/Migration.ts`). Mirroring that into a seam
   *   no chain can reach would buy nothing, so this side stays as it is.
   *
   *   What crosses is therefore identity and position: the public keys — which decide whose coins the far side can
   *   decrypt — the network, the protocol version that triggered the hand-over, kept so the new variant starts inside
   *   its own activation range rather than immediately signalling backwards, and the cursor the previous variant
   *   stopped at.
   *
   *   **Sync progress is parked at the fork, not rewound**: the previous wallet's cursor crosses unchanged. A fork does
   *   not restart the timeline — event ids run onwards from whatever the indexer had reached when it happened, never
   *   from zero — so resuming from the inherited cursor is what puts this wallet in front of what comes next. Rewinding
   *   to zero would park it on a stretch of history that this ledger version's events do not occupy. What does not
   *   cross is `isConnected`: no sync is running behind this state yet.
   *
   *   Coin hashes start empty for the same reason the tree does: they are commitments and nullifiers computed under the
   *   previous ledger's codec, and this version recomputes its own from the keys and whatever state it ends up with.
   * @param previous The plain data read off the previous ledger version's wallet.
   * @returns A wallet of this ledger version holding no coins, positioned at the fork.
   */
  fromPreviousVersion(previous: {
    readonly publicKeys: PublicKeys;
    readonly networkId: string;
    readonly protocolVersion: bigint;
    readonly progress: SyncProgress.SyncProgressData;
  }): CoreWallet {
    return {
      state: new ledger.ZswapLocalState(),
      publicKeys: previous.publicKeys,
      networkId: previous.networkId,
      coinHashes: CoinHashesMap.empty,
      progress: SyncProgress.createSyncProgress({ ...previous.progress, isConnected: false }),
      protocolVersion: ProtocolVersion.ProtocolVersion(previous.protocolVersion),
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
