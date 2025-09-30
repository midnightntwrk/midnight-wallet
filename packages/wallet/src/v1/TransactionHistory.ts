import { CoreWallet } from './CoreWallet';
import { FinalizedTransaction, ProofErasedTransaction } from './Transaction';

export type ProgressUpdate = {
  appliedIndex: bigint | undefined;
  highestRelevantWalletIndex: bigint | undefined;
  highestIndex: bigint | undefined;
  highestRelevantIndex: bigint | undefined;
};

export type TransactionHistoryCapability<TState, TTransaction> = {
  updateTxHistory(state: TState, newTxs: TTransaction[]): TState;
  transactionHistory(state: TState): readonly TTransaction[];
  progress(state: TState): ProgressUpdate;
};

export const makeDefaultTransactionHistoryCapability = (): TransactionHistoryCapability<
  CoreWallet,
  FinalizedTransaction
> => {
  return {
    updateTxHistory: (state: CoreWallet, newTxs: FinalizedTransaction[]): CoreWallet => {
      return newTxs.reduce((acc, tx) => CoreWallet.addTransaction(acc, tx), state);
    },
    transactionHistory: (state: CoreWallet): readonly FinalizedTransaction[] => {
      return state.txHistoryArray;
    },
    progress: (state: CoreWallet): ProgressUpdate => {
      return {
        appliedIndex: state.progress.appliedIndex,
        highestRelevantWalletIndex: state.progress.highestRelevantWalletIndex,
        highestIndex: state.progress.highestIndex,
        highestRelevantIndex: state.progress.highestRelevantIndex,
      };
    },
  };
};

export const makeSimulatorTransactionHistoryCapability = (): TransactionHistoryCapability<
  CoreWallet,
  ProofErasedTransaction
> => {
  return {
    updateTxHistory: (state: CoreWallet, newTxs: ProofErasedTransaction[]): CoreWallet => {
      return CoreWallet.updateTxHistory(state, newTxs as unknown as readonly FinalizedTransaction[]); // @TODO fix this cast
    },
    transactionHistory: (state: CoreWallet): readonly ProofErasedTransaction[] => {
      return state.txHistoryArray as unknown as readonly ProofErasedTransaction[]; // @TODO fix this cast
    },
    progress: (state: CoreWallet): ProgressUpdate => {
      return {
        appliedIndex: state.progress.appliedIndex,
        highestRelevantWalletIndex: state.progress.highestRelevantWalletIndex,
        highestIndex: state.progress.highestIndex,
        highestRelevantIndex: state.progress.highestRelevantIndex,
      };
    },
  };
};

export const makeDiscardTransactionHistoryCapability = (): TransactionHistoryCapability<
  CoreWallet,
  FinalizedTransaction
> => {
  return {
    updateTxHistory: (state: CoreWallet): CoreWallet => {
      return state;
    },
    transactionHistory: (state: CoreWallet): readonly FinalizedTransaction[] => {
      return state.txHistoryArray;
    },
    progress: (state: CoreWallet): ProgressUpdate => {
      return {
        appliedIndex: state.progress.appliedIndex,
        highestRelevantWalletIndex: state.progress.highestRelevantWalletIndex,
        highestIndex: state.progress.highestIndex,
        highestRelevantIndex: state.progress.highestRelevantIndex,
      };
    },
  };
};
