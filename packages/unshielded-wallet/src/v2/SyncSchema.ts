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
import { Schema } from 'effect';
import { SafeBigInt } from '@midnightntwrk/wallet-sdk-utilities';

const DateFromMillis = Schema.transform(Schema.Number, Schema.DateFromSelf, {
  strict: true,
  decode: (millis) => new Date(millis),
  encode: (date) => date.getTime(),
});

const WireUtxoSchema = Schema.Struct({
  value: SafeBigInt.SafeBigInt,
  owner: Schema.String,
  tokenType: Schema.String,
  intentHash: Schema.String,
  outputIndex: Schema.Number,
  ctime: Schema.Number,
  registeredForDustGeneration: Schema.Boolean,
});

const UtxoWithMetaSchema = Schema.transform(
  WireUtxoSchema,
  Schema.typeSchema(
    Schema.Struct({
      utxo: Schema.Struct({
        value: SafeBigInt.BigIntSchema,
        owner: Schema.String,
        type: Schema.String,
        intentHash: Schema.String,
        outputNo: Schema.Number,
      }),
      meta: Schema.Struct({
        ctime: Schema.DateFromSelf,
        registeredForDustGeneration: Schema.Boolean,
      }),
    }),
  ),
  {
    strict: true,
    decode: (wire) => ({
      utxo: {
        value: wire.value,
        owner: wire.owner,
        type: wire.tokenType,
        intentHash: wire.intentHash,
        outputNo: wire.outputIndex,
      },
      meta: {
        ctime: new Date(wire.ctime * 1000),
        registeredForDustGeneration: wire.registeredForDustGeneration,
      },
    }),
    encode: (domain) => ({
      value: domain.utxo.value,
      owner: domain.utxo.owner,
      tokenType: domain.utxo.type,
      intentHash: domain.utxo.intentHash,
      outputIndex: domain.utxo.outputNo,
      ctime: Math.floor(domain.meta.ctime.getTime() / 1000),
      registeredForDustGeneration: domain.meta.registeredForDustGeneration,
    }),
  },
);

export type UtxoWithMeta = Schema.Schema.Type<typeof UtxoWithMetaSchema>;

export const UnshieldedTransactionSchema = Schema.Data(
  Schema.Struct({
    id: Schema.Number,
    hash: Schema.String,
    type: Schema.Literal('RegularTransaction', 'SystemTransaction', 'BridgeClaimTransaction'),
    protocolVersion: Schema.Number,
    identifiers: Schema.optional(Schema.Array(Schema.String)),
    block: Schema.Struct({
      hash: Schema.String,
      height: Schema.Number,
      timestamp: DateFromMillis,
    }),
    fees: Schema.optional(
      Schema.Struct({
        paidFees: SafeBigInt.SafeBigInt,
        estimatedFees: SafeBigInt.SafeBigInt,
      }),
    ),
    transactionResult: Schema.optional(
      Schema.Struct({
        status: Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'),
        segments: Schema.NullOr(
          Schema.Array(
            Schema.Struct({
              id: Schema.Number,
              success: Schema.Boolean,
            }),
          ),
        ),
      }),
    ),
  }),
);

export type UnshieldedTransaction = Schema.Schema.Type<typeof UnshieldedTransactionSchema>;

const UnshieldedUpdateWireSchema = Schema.Struct({
  type: Schema.Literal('UnshieldedTransaction'),
  transaction: UnshieldedTransactionSchema,
  createdUtxos: Schema.Array(UtxoWithMetaSchema),
  spentUtxos: Schema.Array(UtxoWithMetaSchema),
});

export const UnshieldedUpdateSchema = Schema.transform(
  UnshieldedUpdateWireSchema,
  Schema.typeSchema(
    Schema.Struct({
      type: Schema.Literal('UnshieldedTransaction'),
      transaction: UnshieldedTransactionSchema,
      createdUtxos: Schema.Array(Schema.typeSchema(UtxoWithMetaSchema)),
      spentUtxos: Schema.Array(Schema.typeSchema(UtxoWithMetaSchema)),
      status: Schema.Literal('SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS'),
    }),
  ),
  {
    strict: true,
    decode: (wire) => {
      const isStatusImplicitlySuccess = ['SystemTransaction', 'BridgeClaimTransaction'].includes(wire.transaction.type);
      return {
        ...wire,
        status: isStatusImplicitlySuccess ? 'SUCCESS' : wire.transaction.transactionResult!.status,
      };
    },
    encode: ({ status: _status, ...rest }) => rest,
  },
);

export type UnshieldedUpdate = Schema.Schema.Type<typeof UnshieldedUpdateSchema>;

export const ProgressSchema = Schema.Struct({
  type: Schema.Literal('UnshieldedTransactionsProgress'),
  highestTransactionId: Schema.Number,
});

export const WalletSyncUpdateSchema = Schema.Union(UnshieldedUpdateSchema, ProgressSchema);

/** What the indexer's subscription says, decoded: either a transaction touching this address, or how far it has got. */
export type IndexerSyncUpdate = Schema.Schema.Type<typeof WalletSyncUpdateSchema>;

/**
 * What the chain says about itself when this address's timeline says nothing.
 *
 * @remarks
 *   An observation, not a piece of the chain: it moves no cursor, creates and spends nothing. All it can do is record a
 *   protocol version, which is enough, because recording one outside the running variant's activation range is exactly
 *   what makes the runtime hand over. It is not decoded off the wire like the other two arms — the source assembles it
 *   from two answers the indexer gives separately — so it is a plain type rather than a schema.
 *
 *   `highestTransactionId` is what makes the record safe to make. Handing over parks the sync cursor where it stands, and
 *   the variant that takes over resumes from there — so a transaction still unapplied below the address's tip would be
 *   created and spent into a state assembled by a variant that never saw the history leading to it. The signal
 *   therefore travels with the far end of this address's timeline, so the capability can refuse it while anything
 *   remains unapplied. Zero means the indexer holds no transaction for this address at all, which is the one case where
 *   nothing can be unapplied no matter what the wallet has done.
 */
export type VersionSignalSyncUpdate = Readonly<{
  type: 'VersionSignal';
  /** The protocol version the chain's tip was reported under. */
  version: number;
  /** The highest transaction id the source holds for this wallet's address; zero when it holds none. */
  highestTransactionId: number;
}>;
export const VersionSignalSyncUpdate = {
  create: (version: number, highestTransactionId: number): VersionSignalSyncUpdate => {
    return {
      type: 'VersionSignal',
      version,
      highestTransactionId,
    };
  },
};

/**
 * What the indexer-backed sync source emits.
 *
 * @remarks
 *   Ordinarily what the subscription decoded; and, on a timer, what the chain says about its own version when the
 *   subscription says nothing.
 */
export type WalletSyncUpdate = IndexerSyncUpdate | VersionSignalSyncUpdate;
