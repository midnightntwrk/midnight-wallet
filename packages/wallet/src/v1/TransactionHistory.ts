import { V1State } from './RunningV1Variant';
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
  V1State,
  FinalizedTransaction
> => {
  return {
    updateTxHistory: (state: V1State, newTxs: FinalizedTransaction[]): V1State => {
      return newTxs.reduce((acc, tx) => acc.addTransaction(tx), state);
    },
    transactionHistory: (state: V1State): readonly FinalizedTransaction[] => {
      return state.txHistoryArray;
    },
    progress: (state: V1State): ProgressUpdate => {
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
  V1State,
  ProofErasedTransaction
> => {
  return {
    updateTxHistory: (state: V1State, newTxs: ProofErasedTransaction[]): V1State => {
      return state.updateTxHistory(newTxs as unknown as readonly FinalizedTransaction[]); // @TODO fix this cast
    },
    transactionHistory: (state: V1State): readonly ProofErasedTransaction[] => {
      return state.txHistoryArray as unknown as readonly ProofErasedTransaction[]; // @TODO fix this cast
    },
    progress: (state: V1State): ProgressUpdate => {
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
  V1State,
  FinalizedTransaction
> => {
  return {
    updateTxHistory: (state: V1State): V1State => {
      return state;
    },
    transactionHistory: (state: V1State): readonly FinalizedTransaction[] => {
      return state.txHistoryArray;
    },
    progress: (state: V1State): ProgressUpdate => {
      return {
        appliedIndex: state.progress.appliedIndex,
        highestRelevantWalletIndex: state.progress.highestRelevantWalletIndex,
        highestIndex: state.progress.highestIndex,
        highestRelevantIndex: state.progress.highestRelevantIndex,
      };
    },
  };
};
