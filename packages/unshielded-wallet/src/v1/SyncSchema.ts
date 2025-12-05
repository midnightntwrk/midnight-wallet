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
import { Effect, Schema, ParseResult } from 'effect';

export const BigIntSchema = Schema.declare((input: unknown): input is bigint => typeof input === 'bigint').annotations({
  identifier: 'BigIntSchema',
});

export const SafeBigInt: Schema.Schema<bigint, string> = Schema.transformOrFail(Schema.String, BigIntSchema, {
  decode: (value) =>
    Effect.try({
      try: () => BigInt(value),
      catch: (err) => new ParseResult.Unexpected(err, 'Could not parse bigint'),
    }),
  encode: (value) => Effect.succeed(value.toString()),
});

const DateFromMillis = Schema.transform(Schema.Number, Schema.DateFromSelf, {
  strict: true,
  decode: (millis) => new Date(millis),
  encode: (date) => date.getTime(),
});

const WireUtxoSchema = Schema.Struct({
  value: SafeBigInt,
  owner: Schema.String,
  tokenType: Schema.String,
  intentHash: Schema.String,
  outputIndex: Schema.Number,
  ctime: Schema.NullOr(Schema.Number),
  registeredForDustGeneration: Schema.Boolean,
});

const UtxoWithMetaSchema = Schema.transform(
  WireUtxoSchema,
  Schema.typeSchema(
    Schema.Struct({
      utxo: Schema.Struct({
        value: BigIntSchema,
        owner: Schema.String,
        type: Schema.String,
        intentHash: Schema.String,
        outputNo: Schema.Number,
      }),
      meta: Schema.Struct({
        ctime: Schema.NullOr(Schema.DateFromSelf),
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
        ctime: wire.ctime !== null ? new Date(wire.ctime * 1000) : null,
        registeredForDustGeneration: wire.registeredForDustGeneration,
      },
    }),
    encode: (domain) => ({
      value: domain.utxo.value,
      owner: domain.utxo.owner,
      tokenType: domain.utxo.type,
      intentHash: domain.utxo.intentHash,
      outputIndex: domain.utxo.outputNo,
      ctime: domain.meta.ctime !== null ? Math.floor(domain.meta.ctime.getTime() / 1000) : null,
      registeredForDustGeneration: domain.meta.registeredForDustGeneration,
    }),
  },
);

export type UtxoWithMeta = Schema.Schema.Type<typeof UtxoWithMetaSchema>;

export const UnshieldedTransactionSchema = Schema.Data(
  Schema.Struct({
    id: Schema.Number,
    hash: Schema.String,
    type: Schema.Literal('RegularTransaction', 'SystemTransaction'),
    protocolVersion: Schema.Number,
    identifiers: Schema.optional(Schema.Array(Schema.String)),
    block: Schema.Struct({
      timestamp: DateFromMillis,
    }),
    fees: Schema.optional(
      Schema.Struct({
        paidFees: SafeBigInt,
        estimatedFees: SafeBigInt,
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
      status: Schema.Literal('SUCCESS', 'FAILURE'),
    }),
  ),
  {
    strict: true,
    decode: (wire) => {
      const status: 'SUCCESS' | 'FAILURE' =
        wire.transaction.transactionResult?.status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
      return {
        ...wire,
        status,
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

export type WalletSyncUpdate = Schema.Schema.Type<typeof WalletSyncUpdateSchema>;
