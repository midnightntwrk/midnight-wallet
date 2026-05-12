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

export const mergeUnshieldedSections = (
  existing: UnshieldedSection,
  incoming: UnshieldedSection,
): UnshieldedSection => ({
  ...existing,
  ...incoming,
});

/**
 * Unshielded entry schema. Extends the common entry shape with an optional `unshielded` section. Tightening — required
 * `unshielded` plus required `protocolVersion`/`status`/`timestamp` — happens at the writer-input type, not on the
 * stored shape. Fees are not unshielded's concern (dust pays them); unshielded never writes `fees`.
 */
export const UnshieldedTransactionHistoryEntrySchema = TransactionHistoryStorage.extendEntrySchema({
  unshielded: Schema.optional(UnshieldedSectionSchema),
});

export type UnshieldedTransactionHistoryEntry = Schema.Schema.Type<typeof UnshieldedTransactionHistoryEntrySchema>;

export type TransactionHistoryService = {
  put(update: UnshieldedUpdate): Effect.Effect<void, TransactionHistoryError>;
};

export type UnshieldedHistoryStorage =
  TransactionHistoryStorage.TransactionHistoryReader<TransactionHistoryStorage.TransactionHistoryEntryWithHash> &
    TransactionHistoryStorage.TransactionHistoryWriter<UnshieldedTransactionHistoryEntry>;

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
