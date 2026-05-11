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
import { TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Effect, Schema } from 'effect';
import { type UnshieldedUpdate } from './SyncSchema.js';
import { SafeBigInt } from '@midnight-ntwrk/wallet-sdk-utilities';
import { TransactionHistoryError } from './WalletError.js';

const UtxoSchema = Schema.Struct({
  value: SafeBigInt.SafeBigInt,
  owner: Schema.String,
  tokenType: Schema.String,
  intentHash: Schema.String,
  outputIndex: Schema.Number,
});

export const UnshieldedSectionSchema = Schema.Struct({
  id: Schema.Number,
  createdUtxos: Schema.Array(UtxoSchema),
  spentUtxos: Schema.Array(UtxoSchema),
});

type UnshieldedSection = Schema.Schema.Type<typeof UnshieldedSectionSchema>;

export const UnshieldedTransactionHistoryEntrySchema = Schema.Struct({
  ...TransactionHistoryStorage.TransactionHistoryCommonSchema.fields,
  unshielded: UnshieldedSectionSchema,
});

export type UnshieldedTransactionHistoryEntry = Schema.Schema.Type<typeof UnshieldedTransactionHistoryEntrySchema>;

export type TransactionHistoryService = {
  put(update: UnshieldedUpdate): Effect.Effect<void, TransactionHistoryError>;
};

export type DefaultTransactionHistoryConfiguration = {
  txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<TransactionHistoryStorage.TransactionHistoryEntryWithHash>;
};

type StorageEntryWithUnshielded = Omit<
  TransactionHistoryStorage.TransactionHistoryCommon,
  'identifiers' | 'timestamp' | 'fees'
> & {
  readonly identifiers: readonly string[];
  readonly timestamp: Date;
  readonly fees: bigint | null;
  readonly unshielded: UnshieldedSection;
};

const convertUpdateToStorageEntry = ({
  transaction,
  createdUtxos,
  spentUtxos,
  status,
}: UnshieldedUpdate): StorageEntryWithUnshielded => ({
  hash: transaction.hash,
  protocolVersion: transaction.protocolVersion,
  status,
  identifiers: transaction.identifiers ?? [],
  timestamp: transaction.block.timestamp,
  fees: transaction.fees?.paidFees ?? null,
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
        try: () => txHistoryStorage.upsert(convertUpdateToStorageEntry(update)),
        catch: (e) => new TransactionHistoryError({ message: 'Failed to put transaction history entry', cause: e }),
      }),
  };
};
