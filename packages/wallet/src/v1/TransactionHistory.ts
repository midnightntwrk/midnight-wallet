import * as ledger from '@midnight-ntwrk/ledger-v6';
import { CoreWallet } from './CoreWallet';

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
  ledger.FinalizedTransaction
> => {
  return {
    updateTxHistory: (state: CoreWallet, newTxs: ledger.FinalizedTransaction[]): CoreWallet => {
      return newTxs.reduce((acc, tx) => CoreWallet.addTransaction(acc, tx), state);
    },
    transactionHistory: (state: CoreWallet): readonly ledger.FinalizedTransaction[] => {
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
  ledger.ProofErasedTransaction
> => {
  return {
    updateTxHistory: (state: CoreWallet, newTxs: ledger.ProofErasedTransaction[]): CoreWallet => {
      return CoreWallet.updateTxHistory(state, newTxs as unknown as readonly ledger.FinalizedTransaction[]); // @TODO fix this cast
    },
    transactionHistory: (state: CoreWallet): readonly ledger.ProofErasedTransaction[] => {
      return state.txHistoryArray as unknown as readonly ledger.ProofErasedTransaction[]; // @TODO fix this cast
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
  ledger.FinalizedTransaction
> => {
  return {
    updateTxHistory: (state: CoreWallet): CoreWallet => {
      return state;
    },
    transactionHistory: (state: CoreWallet): readonly ledger.FinalizedTransaction[] => {
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
