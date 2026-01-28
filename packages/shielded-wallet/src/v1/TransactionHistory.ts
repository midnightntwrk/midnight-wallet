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
import { TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Schema } from 'effect';
import { CoreWallet } from './CoreWallet.js';

export const QualifiedShieldedCoinInfoSchema = Schema.Struct({
  type: Schema.String,
  nonce: Schema.String,
  value: Schema.BigInt,
  mt_index: Schema.BigInt,
});

export type QualifiedShieldedCoinInfo = Schema.Schema.Type<typeof QualifiedShieldedCoinInfoSchema>;

export const ShieldedTransactionHistoryEntrySchema = Schema.Struct({
  hash: TransactionHistoryStorage.TransactionHashSchema,
  protocolVersion: Schema.Number,
  status: Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'),
  receivedCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
  spentCoins: Schema.Array(QualifiedShieldedCoinInfoSchema),
});

export type ShieldedTransactionHistoryEntry = Schema.Schema.Type<typeof ShieldedTransactionHistoryEntrySchema>;

export type DefaultTransactionHistoryConfiguration = {
  shieldedTxHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<ShieldedTransactionHistoryEntry>;
};

// TODO IAN - This is being changed to an alternative location!

// export type ProgressUpdate = {
//   appliedIndex: bigint | undefined;
//   highestRelevantWalletIndex: bigint | undefined;
//   highestIndex: bigint | undefined;
//   highestRelevantIndex: bigint | undefined;
// };

export type TransactionHistoryCapability<TState> = {
  create(state: TState, changes: ledger.ZswapStateChanges): Promise<void>;
  get(hash: TransactionHistoryStorage.TransactionHash): Promise<ShieldedTransactionHistoryEntry | undefined>;
  getAll(): AsyncIterableIterator<ShieldedTransactionHistoryEntry>;
  delete(hash: TransactionHistoryStorage.TransactionHash): Promise<ShieldedTransactionHistoryEntry | undefined>;
  // progress(state: TState): ProgressUpdate;
};

const convertUpdateToEntry = (
  state: CoreWallet,
  changes: ledger.ZswapStateChanges,
): ShieldedTransactionHistoryEntry => {
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
): TransactionHistoryCapability<CoreWallet> => {
  const { shieldedTxHistoryStorage } = config;

  return {
    create: async (state: CoreWallet, changes: ledger.ZswapStateChanges): Promise<void> => {
      // TODO IAN Hardcode protocol version to 1 - maybe....
      const entry = convertUpdateToEntry(state, changes);
      console.log('IAN !! here is the entry i will add to the history', entry);
      await shieldedTxHistoryStorage.create(entry);
    },
    get: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<ShieldedTransactionHistoryEntry | undefined> => {
      return shieldedTxHistoryStorage.get(hash);
    },
    getAll: (): AsyncIterableIterator<ShieldedTransactionHistoryEntry> => {
      return shieldedTxHistoryStorage.getAll();
    },
    delete: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<ShieldedTransactionHistoryEntry | undefined> => {
      return shieldedTxHistoryStorage.delete(hash);
    },

    // progress: (state: CoreWallet): ProgressUpdate => {
    //   // TODO IAN Need to move this, why is it in the history capability ?
    //   return {
    //     appliedIndex: state.progress.appliedIndex,
    //     highestRelevantWalletIndex: state.progress.highestRelevantWalletIndex,
    //     highestIndex: state.progress.highestIndex,
    //     highestRelevantIndex: state.progress.highestRelevantIndex,
    //   };
    // },
  };
};

export const makeSimulatorTransactionHistoryCapability = (): TransactionHistoryCapability<CoreWallet> => {
  return {
    create: async (state: CoreWallet, changes: ledger.ZswapStateChanges): Promise<void> => {
      const entry = convertUpdateToEntry(state, changes);
      // await txHistoryStorage.create(entry);
      return Promise.resolve();
    },
    get: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<ShieldedTransactionHistoryEntry | undefined> => {
      // return await txHistoryStorage.get(hash);
      return Promise.resolve(undefined);
    },
    getAll: (): AsyncIterableIterator<ShieldedTransactionHistoryEntry> => {
      // return txHistoryStorage.getAll();
      return (async function* (): AsyncIterableIterator<ShieldedTransactionHistoryEntry> {
        // empty
      })();
    },
    delete: async (
      hash: TransactionHistoryStorage.TransactionHash,
    ): Promise<ShieldedTransactionHistoryEntry | undefined> => {
      // return txHistoryStorage.delete(hash);
      return Promise.resolve(undefined);
    },

    // progress: (state: CoreWallet): ProgressUpdate => {
    //   return {
    //     appliedIndex: state.progress.appliedIndex,
    //     highestRelevantWalletIndex: state.progress.highestRelevantWalletIndex,
    //     highestIndex: state.progress.highestIndex,
    //     highestRelevantIndex: state.progress.highestRelevantIndex,
    //   };
    // },
  };
};
