import * as zswap from '@midnight-ntwrk/zswap';
import { createSyncProgress, SyncProgressData, SyncProgress } from './SyncProgress';
import { ProtocolVersion } from '@midnight-ntwrk/abstractions';

export class CoreWallet {
  readonly state: zswap.LocalState;
  readonly secretKeys: zswap.SecretKeys;
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;

  readonly isConnected: boolean;
  readonly progress: SyncProgress;
  readonly networkId: zswap.NetworkId;
  readonly txHistoryArray: readonly zswap.Transaction[];

  constructor(
    state: zswap.LocalState,
    secretKeys: zswap.SecretKeys,
    networkId: zswap.NetworkId,
    txHistory: readonly zswap.Transaction[] = [],
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

  applyCollapsedUpdate(collapsedUpdate: zswap.MerkleTreeCollapsedUpdate): CoreWallet {
    const newState = this.state.applyCollapsedUpdate(collapsedUpdate);
    return new CoreWallet(newState, this.secretKeys, this.networkId, this.txHistoryArray, this.progress);
  }

  applyTransaction(tx: zswap.Transaction, res: 'success' | 'partialSuccess' | 'failure'): CoreWallet {
    const newState = this.state.applyTx(this.secretKeys, tx, res);
    return new CoreWallet(newState, this.secretKeys, this.networkId, this.txHistoryArray, this.progress);
  }

  applyState(state: zswap.LocalState): CoreWallet {
    return new CoreWallet(state, this.secretKeys, this.networkId, this.txHistoryArray, this.progress);
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

  addTransaction(tx: zswap.Transaction): CoreWallet {
    return new CoreWallet(this.state, this.secretKeys, this.networkId, [...this.txHistoryArray, tx], this.progress);
  }

  updateTxHistory(newTxs: readonly zswap.Transaction[]): CoreWallet {
    return new CoreWallet(
      this.state,
      this.secretKeys,
      this.networkId,
      [...this.txHistoryArray, ...newTxs],
      this.progress,
    );
  }

  static empty(localState: zswap.LocalState, secretKeys: zswap.SecretKeys, networkId: zswap.NetworkId): CoreWallet {
    return new CoreWallet(localState, secretKeys, networkId);
  }

  static restore(
    localState: zswap.LocalState,
    secretKeys: zswap.SecretKeys,
    txHistory: readonly zswap.Transaction[],
    syncProgress: SyncProgressData,
    protocolVersion: bigint,
    networkId: zswap.NetworkId,
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
