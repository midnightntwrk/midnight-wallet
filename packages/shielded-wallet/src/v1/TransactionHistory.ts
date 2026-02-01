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
  // updateTxHistory(state: TState, newTxs: TTransaction[]): TState;
  // transactionHistory(state: TState): readonly TTransaction[];
  create(state: TState, changes: ledger.ZswapStateChanges): Promise<void>;
  get(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<TransactionHistoryEntry>;
  delete(hash: TransactionHash): Promise<TransactionHistoryEntry | undefined>;
  progress(state: TState): ProgressUpdate;
};

const convertUpdateToEntry = (state: CoreWallet, changes: ledger.ZswapStateChanges): TransactionHistoryEntry => {
  return {
    hash: changes.source,
    protocolVersion: Number(state.protocolVersion),
    status: 'SUCCESS',
    receivedCoins: changes.receivedCoins,
    spentCoins: changes.spentCoins,
  };
};

export const makeDefaultTransactionHistoryCapability = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryCapability<CoreWallet, TransactionHistoryEntry> => {
  const { txHistoryStorage } = config;

  return {
    // updateTxHistory: (state: CoreWallet, newTxs: TransactionHistoryEntry[]): CoreWallet => {
    //   return newTxs.reduce((acc, tx) => CoreWallet.addTransaction(acc, tx), state);
    // },
    // transactionHistory: (state: CoreWallet): readonly TransactionHistoryEntry[] => {
    //   return state.txHistoryArray;
    // },

    create: async (state: CoreWallet, changes: ledger.ZswapStateChanges): Promise<void> => {
      const entry = convertUpdateToEntry(state, changes);
      await txHistoryStorage.create(entry);
    },
    get: async (hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> => {
      return await txHistoryStorage.get(hash);
    },
    getAll: (): AsyncIterableIterator<TransactionHistoryEntry> => {
      return txHistoryStorage.getAll();
    },
    delete: async (hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> => {
      return txHistoryStorage.delete(hash);
    },

    progress: (state: CoreWallet): ProgressUpdate => {
      // TODO IAN Need to move this, why is it in the history capability ?
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
    // updateTxHistory: (state: CoreWallet, newTxs: ledger.ProofErasedTransaction[]): CoreWallet => {
    //   return CoreWallet.updateTxHistory(state, newTxs as unknown as readonly ledger.FinalizedTransaction[]); // @TODO fix this cast
    // },
    // transactionHistory: (state: CoreWallet): readonly ledger.ProofErasedTransaction[] => {
    //   return state.txHistoryArray as unknown as readonly ledger.ProofErasedTransaction[]; // @TODO fix this cast
    // },
    create: async (state: CoreWallet, changes: ledger.ZswapStateChanges): Promise<void> => {
      const entry = convertUpdateToEntry(state, changes);
      // await txHistoryStorage.create(entry);
      return Promise.resolve();
    },
    get: async (hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> => {
      // return await txHistoryStorage.get(hash);
      return Promise.resolve(undefined);
    },
    getAll: (): AsyncIterableIterator<TransactionHistoryEntry> => {
      // return txHistoryStorage.getAll();
      return (async function* (): AsyncIterableIterator<TransactionHistoryEntry> {
        // empty
      })();
    },
    delete: async (hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> => {
      // return txHistoryStorage.delete(hash);
      return Promise.resolve(undefined);
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

// TODO IAN - Why is this here ? We are not using it.
export const makeDiscardTransactionHistoryCapability = (): TransactionHistoryCapability<
  CoreWallet,
  TransactionHistoryEntry
> => {
  return {
    // updateTxHistory: (state: CoreWallet): CoreWallet => {
    //   return state;
    // },
    // transactionHistory: (state: CoreWallet): readonly TransactionHistoryEntry[] => {
    //   return state.txHistoryArray;
    // },
    create: async (state: CoreWallet, changes: ledger.ZswapStateChanges): Promise<void> => {
      const entry = convertUpdateToEntry(state, changes);
      // await txHistoryStorage.create(entry);
      return Promise.resolve();
    },
    get: async (hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> => {
      // return await txHistoryStorage.get(hash);
      return Promise.resolve(undefined);
    },
    getAll: (): AsyncIterableIterator<TransactionHistoryEntry> => {
      // return txHistoryStorage.getAll();
      return (async function* (): AsyncIterableIterator<TransactionHistoryEntry> {
        // empty
      })();
    },
    delete: async (hash: TransactionHash): Promise<TransactionHistoryEntry | undefined> => {
      // return txHistoryStorage.delete(hash);
      return Promise.resolve(undefined);
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
