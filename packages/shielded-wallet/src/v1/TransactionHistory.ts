// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { CoreWallet } from './CoreWallet.js';
import { TransactionHistoryStorage, TransactionHistoryEntry, TransactionHash } from '../storage/index.js';

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: TransactionHistoryStorage;
};

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

const convertUpdateToEntry = ({ transaction, status }: UnshieldedUpdate): TransactionHistoryEntry => {
  return {
    id: transaction.id,
    hash: transaction.hash,
    protocolVersion: transaction.protocolVersion, // TODO up to here  + coins recevied/spent..
    identifiers: transaction.identifiers ? transaction.identifiers : [],
    status, //SUCCEEDED>..
    timestamp: transaction.block?.timestamp ?? null, // TODO we might need the indexer team...
    fees: transaction.fees?.paidFees ?? null,
  };
};

export const makeDefaultTransactionHistoryCapability = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryCapability<CoreWallet, ledger.FinalizedTransaction> => {
  const { txHistoryStorage } = config;

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
