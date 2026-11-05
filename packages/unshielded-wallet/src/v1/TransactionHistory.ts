// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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
import { type TransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, type Schema } from 'effect';
import { type UnshieldedUpdate } from './SyncSchema.js';
import { TransactionHistoryError } from './WalletError.js';
import {
  type UnshieldedSectionSchema,
  type UnshieldedHistoryStorage,
  type UnshieldedTransactionHistoryEntry,
} from '../types/UnshieldedWalletTypes.js';

type UnshieldedSection = Schema.Schema.Type<typeof UnshieldedSectionSchema>;

export type TransactionHistoryService = {
  put(update: UnshieldedUpdate): Effect.Effect<void, TransactionHistoryError>;
};

export {
  UnshieldedSectionSchema,
  UnshieldedTransactionHistoryEntrySchema,
  mergeUnshieldedSections,
  type UnshieldedHistoryStorage,
  type UnshieldedTransactionHistoryEntry,
} from '../types/UnshieldedWalletTypes.js';

/**
 * Writer input for unshielded's `gotFinalized`. The stored shape leaves fields optional, but at write time we know
 * `protocolVersion`, `status`, `timestamp`, and the `unshielded` section.
 */
type UnshieldedFinalizedInput = TransactionHistoryStorage.FinalizedEntryInput<UnshieldedTransactionHistoryEntry> & {
  readonly protocolVersion: number;
  readonly status: TransactionHistoryStorage.TransactionHistoryStatus;
  readonly timestamp: Date;
  readonly unshielded: UnshieldedSection;
};

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: UnshieldedHistoryStorage;
};

const convertUpdateToFinalizedInput = ({
  transaction,
  createdUtxos,
  spentUtxos,
  status,
}: UnshieldedUpdate): UnshieldedFinalizedInput => ({
  hash: transaction.hash,
  protocolVersion: transaction.protocolVersion,
  status,
  identifiers: transaction.identifiers ?? [],
  timestamp: transaction.block.timestamp,
  finalizedBlock: {
    hash: transaction.block.hash,
    height: transaction.block.height,
    timestamp: transaction.block.timestamp,
  },
  unshielded: {
    id: transaction.id,
    createdUtxos: createdUtxos.map(({ utxo }) => ({
      value: utxo.value,
      owner: utxo.owner,
      tokenType: utxo.type,
      intentHash: utxo.intentHash,
      outputIndex: utxo.outputNo,
    })),
    spentUtxos: spentUtxos.map(({ utxo }) => ({
      value: utxo.value,
      owner: utxo.owner,
      tokenType: utxo.type,
      intentHash: utxo.intentHash,
      outputIndex: utxo.outputNo,
    })),
  },
});

export const makeDefaultTransactionHistoryService = (
  config: DefaultTransactionHistoryConfiguration,
  _getContext: () => unknown,
): TransactionHistoryService => {
  const txHistoryStorage = config.txHistoryStorage;

  return {
    put: (update: UnshieldedUpdate): Effect.Effect<void, TransactionHistoryError> =>
      Effect.tryPromise({
        try: () => txHistoryStorage.gotFinalized(convertUpdateToFinalizedInput(update)),
        catch: (e) => new TransactionHistoryError({ message: 'Failed to record finalized history entry', cause: e }),
      }),
  };
};
