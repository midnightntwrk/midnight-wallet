import { V1State } from './RunningV1Variant';
import * as zswap from '@midnight-ntwrk/zswap';

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

export const makeDefaultTransactionHistoryCapability = (): TransactionHistoryCapability<V1State, zswap.Transaction> => {
  return {
    updateTxHistory: (state: V1State, newTxs: zswap.Transaction[]): V1State => {
      return newTxs.reduce((acc, tx) => acc.addTransaction(tx), state);
    },
    transactionHistory: (state: V1State): readonly zswap.Transaction[] => {
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
  zswap.ProofErasedTransaction
> => {
  return {
    updateTxHistory: (state: V1State, newTxs: zswap.ProofErasedTransaction[]): V1State => {
      return state.updateTxHistory(newTxs as unknown as readonly zswap.Transaction[]);
    },
    transactionHistory: (state: V1State): readonly zswap.ProofErasedTransaction[] => {
      return state.txHistoryArray as readonly zswap.ProofErasedTransaction[];
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

export const makeDiscardTransactionHistoryCapability = (): TransactionHistoryCapability<V1State, zswap.Transaction> => {
  return {
    updateTxHistory: (state: V1State): V1State => {
      return state;
    },
    transactionHistory: (state: V1State): readonly zswap.Transaction[] => {
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
