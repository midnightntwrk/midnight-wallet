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

// TODO Upcoming refactor for CoreWallet to convert to an object from a class
// PM-19583 Refactor CoreWallet
export class CoreWallet {
  readonly state: ledger.ZswapLocalState;
  readonly publicKeys: PublicKeys;
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;

  readonly progress: SyncProgress;
  readonly networkId: ledger.NetworkId;
  readonly txHistoryArray: readonly FinalizedTransaction[];
  readonly coinHashes: CoinHashesMap;

  constructor(
    state: ledger.ZswapLocalState,
    publicKeys: PublicKeys,
    networkId: ledger.NetworkId,
    coinHashes: CoinHashesMap,
    txHistory: readonly FinalizedTransaction[] = [],
    syncProgress?: Omit<SyncProgressData, 'isConnected'>,
    protocolVersion?: ProtocolVersion.ProtocolVersion,
  ) {
    this.state = state;
    this.networkId = networkId;
    this.protocolVersion = protocolVersion || ProtocolVersion.MinSupportedVersion;
    this.txHistoryArray = txHistory;
    this.progress = syncProgress ? createSyncProgress(syncProgress) : createSyncProgress();
    this.publicKeys = publicKeys;
    this.coinHashes = coinHashes;
  }

  applyCollapsedUpdate(collapsedUpdate: ledger.MerkleTreeCollapsedUpdate): CoreWallet {
    const newState = this.state.applyCollapsedUpdate(collapsedUpdate);
    return new CoreWallet(
      newState,
      this.publicKeys,
      this.networkId,
      this.coinHashes,
      this.txHistoryArray,
      this.progress,
    );
  }

  applyTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    res: ledger.TransactionResult,
  ): CoreWallet {
    const newState = this.state.applyTx(secretKeys, tx, res.type);
    const newCoinHashes = CoinHashesMap.updateWithCoins(
      secretKeys,
      this.coinHashes,
      CoinHashesMap.pickAllCoins(newState),
    );

    return new CoreWallet(newState, this.publicKeys, this.networkId, newCoinHashes, this.txHistoryArray, this.progress);
  }

  applyFailed(tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>): CoreWallet {
    const newState = pipe(
      tx.fallibleOffer?.entries() ?? ([] as Array<[number, ledger.ZswapOffer<ledger.Proofish>]>),
      Iterable.map(([, offer]) => offer),
      Iterable.prependAll(pipe(tx.guaranteedOffer, Option.fromNullable, Option.toArray)),
      Iterable.reduce(this.state, (previousState, offer) => previousState.applyFailed(offer)),
    );

    return new CoreWallet(
      newState,
      this.publicKeys,
      this.networkId,
      this.coinHashes,
      this.txHistoryArray,
      this.progress,
    );
  }

  updateProgress({
    appliedIndex,
    highestRelevantWalletIndex,
    highestIndex,
    highestRelevantIndex,
    isConnected,
  }: Partial<SyncProgressData>): CoreWallet {
    const updatedProgress = createSyncProgress({
      appliedIndex: appliedIndex ?? this.progress.appliedIndex,
      highestRelevantWalletIndex: highestRelevantWalletIndex ?? this.progress.highestRelevantWalletIndex,
      highestIndex: highestIndex ?? this.progress.highestIndex,
      highestRelevantIndex: highestRelevantIndex ?? this.progress.highestRelevantIndex,
      isConnected: isConnected ?? this.progress.isConnected,
    });

    return new CoreWallet(
      this.state,
      this.publicKeys,
      this.networkId,
      this.coinHashes,
      this.txHistoryArray,
      updatedProgress,
    );
  }

  addTransaction(tx: FinalizedTransaction): CoreWallet {
    return new CoreWallet(
      this.state,
      this.publicKeys,
      this.networkId,
      this.coinHashes,
      [...this.txHistoryArray, tx],
      this.progress,
    );
  }

  revertTransaction<TTransaction extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>>(
    tx: TTransaction,
  ): CoreWallet {
    return this.applyFailed(tx);
  }

  updateTxHistory(newTxs: readonly FinalizedTransaction[]): CoreWallet {
    return new CoreWallet(
      this.state,
      this.publicKeys,
      this.networkId,
      this.coinHashes,
      [...this.txHistoryArray, ...newTxs],
      this.progress,
    );
  }

  static init(
    localState: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    networkId: ledger.NetworkId,
  ): CoreWallet {
    const coinHashes = CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(localState));
    return new CoreWallet(localState, PublicKeys.fromSecretKeys(secretKeys), networkId, coinHashes);
  }

  static readonly initEmpty = (keys: ledger.ZswapSecretKeys, networkId: ledger.NetworkId): CoreWallet => {
    return CoreWallet.empty(keys, networkId);
  };

  static empty(publicKeys: PublicKeys, networkId: ledger.NetworkId): CoreWallet {
    return new CoreWallet(new ledger.ZswapLocalState(), publicKeys, networkId, CoinHashesMap.empty);
  }

  static restore(
    localState: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    txHistory: readonly FinalizedTransaction[],
    syncProgress: Omit<SyncProgressData, 'isConnected'>,
    protocolVersion: bigint,
    networkId: ledger.NetworkId,
  ): CoreWallet {
    return new CoreWallet(
      localState,
      PublicKeys.fromSecretKeys(secretKeys),
      networkId,
      CoinHashesMap.init(secretKeys, CoinHashesMap.pickAllCoins(localState)),
      txHistory,
      syncProgress,
      ProtocolVersion.ProtocolVersion(protocolVersion),
    );
  }

  static restoreWithCoinHashes(
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
        onRight: () =>
          new CoreWallet(
            localState,
            publicKeys,
            networkId,
            coinHashes,
            txHistory,
            syncProgress,
            ProtocolVersion.ProtocolVersion(protocolVersion),
          ),
      }),
    );
  }

  // TODO Upcoming refactor for CoreWallet, this will be part of the CoreWallet object.
  static spendCoins(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    coins: ReadonlyArray<ledger.QualifiedShieldedCoinInfo>,
    // TODO: Introduce proper type for segment
    segment: number,
  ): [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, CoreWallet] {
    const [output, newLocalState] = pipe(
      coins,
      Arr.reduce(
        [[], state.state] as [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, ledger.ZswapLocalState],
        (
          [offers, localState]: [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, ledger.ZswapLocalState],
          coinToSpend,
        ) => {
          const [newState, newInput] = localState.spend(secretKeys, coinToSpend, segment);
          const inputOffer = ledger.ZswapOffer.fromInput(newInput, coinToSpend.type, coinToSpend.value);
          return [offers.concat([inputOffer]), newState] as [
            ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>,
            ledger.ZswapLocalState,
          ];
        },
      ),
    );
    const updatedState = new CoreWallet(
      newLocalState,
      state.publicKeys,
      state.networkId,
      state.coinHashes,
      state.txHistoryArray,
      state.progress,
      state.protocolVersion,
    );
    return [output, updatedState];
  }

  // TODO Upcoming refactor for CoreWallet, this will be part of the CoreWallet object.
  static watchCoins(
    secretKeys: ledger.ZswapSecretKeys,
    state: CoreWallet,
    coins: ReadonlyArray<ledger.ShieldedCoinInfo>,
  ): CoreWallet {
    const newLocalState = coins.reduce(
      (localState: ledger.ZswapLocalState, coin) => localState.watchFor(state.publicKeys.coinPublicKey, coin),
      state.state,
    );
    const newCoinHashes = CoinHashesMap.updateWithNewCoins(secretKeys, state.coinHashes, coins);

    return new CoreWallet(
      newLocalState,
      state.publicKeys,
      state.networkId,
      newCoinHashes,
      state.txHistoryArray,
      state.progress,
      state.protocolVersion,
    );
  }
}
