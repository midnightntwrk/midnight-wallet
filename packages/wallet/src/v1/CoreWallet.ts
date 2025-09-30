import * as ledger from '@midnight-ntwrk/ledger';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Either, Iterable, Option, pipe, Record, Array as Arr } from 'effect';
import { createSyncProgress, SyncProgress, SyncProgressData } from './SyncProgress';
import { FinalizedTransaction } from './Transaction';
import { InvalidCoinHashesError, WalletError } from './WalletError';

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
        commitment: ledger.coin_commitment(coin, secretKeys.coinPublicKey),
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
  progress: SyncProgress;
  networkId: ledger.NetworkId;
  txHistoryArray: readonly FinalizedTransaction[];
  coinHashes: CoinHashesMap;
}>;

export const CoreWallet = {
  init(
    localState: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    networkId: ledger.NetworkId,
  ): CoreWallet {
    const publicKeys = PublicKeys.fromSecretKeys(secretKeys);
    const coinHashes = CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(localState));
    const progress = createSyncProgress();
    const protocolVersion = ProtocolVersion.MinSupportedVersion;
    return { state: localState, publicKeys, networkId, coinHashes, txHistoryArray: [], progress, protocolVersion };
  },

  empty(publicKeys: PublicKeys, networkId: ledger.NetworkId): CoreWallet {
    return {
      state: new ledger.ZswapLocalState(),
      publicKeys,
      networkId,
      coinHashes: CoinHashesMap.empty,
      txHistoryArray: [],
      progress: createSyncProgress(),
      protocolVersion: ProtocolVersion.MinSupportedVersion,
    };
  },

  restore(
    localState: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    txHistory: readonly FinalizedTransaction[],
    syncProgress: Omit<SyncProgressData, 'isConnected'>,
    protocolVersion: bigint,
    networkId: ledger.NetworkId,
  ): CoreWallet {
    const publicKeys = PublicKeys.fromSecretKeys(secretKeys);
    const coinHashes = CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(localState));
    return {
      state: localState,
      publicKeys,
      networkId,
      coinHashes,
      txHistoryArray: txHistory,
      progress: createSyncProgress(syncProgress),
      protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
    };
  },

  restoreWithCoinHashes(
    publicKeys: PublicKeys,
    localState: ledger.ZswapLocalState,
    txHistory: readonly FinalizedTransaction[],
    coinHashes: CoinHashesMap,
    syncProgress: SyncProgressData,
    protocolVersion: bigint,
    networkId: ledger.NetworkId,
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
          txHistoryArray: txHistory,
          progress: createSyncProgress(syncProgress),
          protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
        }),
      }),
    );
  },

  initEmpty(keys: ledger.ZswapSecretKeys, networkId: ledger.NetworkId): CoreWallet {
    return this.empty(PublicKeys.fromSecretKeys(keys), networkId);
  },

  applyCollapsedUpdate(wallet: CoreWallet, collapsed: ledger.MerkleTreeCollapsedUpdate): CoreWallet {
    const newState = wallet.state.applyCollapsedUpdate(collapsed);
    return { ...wallet, state: newState };
  },

  applyTransaction(
    wallet: CoreWallet,
    secretKeys: ledger.ZswapSecretKeys,
    tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    res: ledger.TransactionResult,
  ): CoreWallet {
    const newState = wallet.state.applyTx(secretKeys, tx, res.type);
    const newCoinHashes = CoinHashesMap.updateWithCoins(
      secretKeys,
      wallet.coinHashes,
      CoinHashesMap.pickAllCoins(newState),
    );
    return { ...wallet, state: newState, coinHashes: newCoinHashes };
  },

  applyFailed<TTx extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>>(
    wallet: CoreWallet,
    tx: TTx,
  ): CoreWallet {
    const newState = pipe(
      tx.fallibleOffer?.entries() ?? ([] as Array<[number, ledger.ZswapOffer<ledger.Proofish>]>),
      Iterable.map(([, offer]) => offer),
      Iterable.prependAll(pipe(tx.guaranteedOffer, Option.fromNullable, Option.toArray)),
      Iterable.reduce(wallet.state, (previousState, offer) => previousState.applyFailed(offer)),
    );
    return { ...wallet, state: newState };
  },

  updateProgress(
    wallet: CoreWallet,
    {
      appliedIndex,
      highestRelevantWalletIndex,
      highestIndex,
      highestRelevantIndex,
      isConnected,
    }: Partial<SyncProgressData>,
  ): CoreWallet {
    const updatedProgress = createSyncProgress({
      appliedIndex: appliedIndex ?? wallet.progress.appliedIndex,
      highestRelevantWalletIndex: highestRelevantWalletIndex ?? wallet.progress.highestRelevantWalletIndex,
      highestIndex: highestIndex ?? wallet.progress.highestIndex,
      highestRelevantIndex: highestRelevantIndex ?? wallet.progress.highestRelevantIndex,
      isConnected: isConnected ?? wallet.progress.isConnected,
    });
    return { ...wallet, progress: updatedProgress };
  },

  addTransaction(wallet: CoreWallet, tx: FinalizedTransaction): CoreWallet {
    return { ...wallet, txHistoryArray: [...wallet.txHistoryArray, tx] };
  },

  revertTransaction<TTx extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>>(
    wallet: CoreWallet,
    tx: TTx,
  ): CoreWallet {
    return CoreWallet.applyFailed(wallet, tx);
  },

  updateTxHistory(wallet: CoreWallet, newTxs: readonly FinalizedTransaction[]): CoreWallet {
    return { ...wallet, txHistoryArray: [...wallet.txHistoryArray, ...newTxs] };
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
