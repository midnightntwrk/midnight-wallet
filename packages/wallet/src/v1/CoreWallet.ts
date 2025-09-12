import * as ledger from '@midnight-ntwrk/ledger';
import { Iterable, Option, pipe } from 'effect';
import { createSyncProgress, SyncProgressData, SyncProgress } from './SyncProgress';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { FinalizedTransaction } from './types/ledger';

export class CoreWallet {
  readonly state: ledger.ZswapLocalState;
  readonly secretKeys: ledger.ZswapSecretKeys;
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;

  readonly isConnected: boolean;
  readonly progress: SyncProgress;
  readonly networkId: ledger.NetworkId;
  readonly txHistoryArray: readonly FinalizedTransaction[];

  constructor(
    state: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    networkId: ledger.NetworkId,
    txHistory: readonly FinalizedTransaction[] = [],
    syncProgress?: SyncProgressData,
    protocolVersion?: ProtocolVersion.ProtocolVersion,
  ) {
    this.state = state;
    this.secretKeys = secretKeys;
    this.networkId = networkId;
    this.protocolVersion = protocolVersion || ProtocolVersion.MinSupportedVersion;
    this.isConnected = true;
    this.txHistoryArray = txHistory;
    this.progress = syncProgress ? createSyncProgress(syncProgress) : createSyncProgress();
  }

  applyCollapsedUpdate(collapsedUpdate: ledger.MerkleTreeCollapsedUpdate): CoreWallet {
    const newState = this.state.applyCollapsedUpdate(collapsedUpdate);
    return new CoreWallet(newState, this.secretKeys, this.networkId, this.txHistoryArray, this.progress);
  }

  applyTransaction(tx: FinalizedTransaction, _res: ledger.TransactionResult): CoreWallet {
    const newState = this.state.applyTx(this.secretKeys, tx, _res.type);

    return new CoreWallet(newState, this.secretKeys, this.networkId, this.txHistoryArray, this.progress);
  }

  applyProofErasedTx(
    tx: ledger.Transaction<ledger.Signaturish, ledger.NoProof, ledger.NoBinding>,
    result: ledger.TransactionResult,
  ): CoreWallet {
    const newState = this.state.applyTx(this.secretKeys, tx, result.type);
    return new CoreWallet(newState, this.secretKeys, this.networkId, this.txHistoryArray, this.progress);
  }

  applyFailed(tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>): CoreWallet {
    const newState = pipe(
      tx.fallibleOffer?.entries() ?? ([] as Array<[number, ledger.ZswapOffer<ledger.Proofish>]>),
      Iterable.map(([, offer]) => offer),
      Iterable.prependAll(pipe(tx.guaranteedOffer, Option.fromNullable, Option.toArray)),
      Iterable.reduce(this.state, (previousState, offer) => previousState.applyFailed(offer)),
    );

    return new CoreWallet(newState, this.secretKeys, this.networkId, this.txHistoryArray, this.progress);
  }

  applyFailedProofErased(offer: ledger.ZswapOffer<ledger.NoProof>): CoreWallet {
    const newState = this.state.applyFailed(offer);
    return new CoreWallet(newState, this.secretKeys, this.networkId, this.txHistoryArray, this.progress);
  }

  updateProgress({
    appliedIndex,
    highestRelevantWalletIndex,
    highestIndex,
    highestRelevantIndex,
  }: Partial<SyncProgressData>): CoreWallet {
    const updatedProgress = createSyncProgress({
      appliedIndex: appliedIndex ?? this.progress.appliedIndex,
      highestRelevantWalletIndex: highestRelevantWalletIndex ?? this.progress.highestRelevantWalletIndex,
      highestIndex: highestIndex ?? this.progress.highestIndex,
      highestRelevantIndex: highestRelevantIndex ?? this.progress.highestRelevantIndex,
    });

    return new CoreWallet(this.state, this.secretKeys, this.networkId, this.txHistoryArray, updatedProgress);
  }

  addTransaction(tx: FinalizedTransaction): CoreWallet {
    return new CoreWallet(this.state, this.secretKeys, this.networkId, [...this.txHistoryArray, tx], this.progress);
  }

  revertTransaction<TTransaction extends ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>>(
    tx: TTransaction,
  ): CoreWallet {
    return this.applyFailed(tx);
  }

  updateTxHistory(newTxs: readonly FinalizedTransaction[]): CoreWallet {
    return new CoreWallet(
      this.state,
      this.secretKeys,
      this.networkId,
      [...this.txHistoryArray, ...newTxs],
      this.progress,
    );
  }

  static empty(
    localState: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    networkId: ledger.NetworkId,
  ): CoreWallet {
    return new CoreWallet(localState, secretKeys, networkId);
  }

  static restore(
    localState: ledger.ZswapLocalState,
    secretKeys: ledger.ZswapSecretKeys,
    txHistory: readonly FinalizedTransaction[],
    syncProgress: SyncProgressData,
    protocolVersion: bigint,
    networkId: ledger.NetworkId,
  ): CoreWallet {
    return new CoreWallet(
      localState,
      secretKeys,
      networkId,
      txHistory,
      syncProgress,
      ProtocolVersion.ProtocolVersion(protocolVersion),
    );
  }
}
