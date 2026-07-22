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
import { Effect, ParseResult, pipe, Schema } from 'effect';
import { type DustSecretKey, Event as LedgerEvent, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { Uint8ArraySchema } from './Serialization.js';

const LedgerParametersSchema = Schema.declare(
  (input: unknown): input is LedgerParameters => input instanceof LedgerParameters,
).annotations({
  identifier: 'ledger.Parameters',
});

const LedgerParametersFromUint8Array: Schema.Schema<LedgerParameters, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, LedgerParametersSchema, {
    encode: (e) => {
      return Effect.try({
        try: () => e.serialize(),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize Ledger Parameters');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => LedgerParameters.deserialize(bytes),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize Ledger Parameters');
        },
      }),
  }),
);

const HexedLedgerParameters: Schema.Schema<LedgerParameters, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(LedgerParametersFromUint8Array),
);

const LedgerEventSchema = Schema.declare(
  (input: unknown): input is LedgerEvent => input instanceof LedgerEvent,
).annotations({
  identifier: 'ledger.Event',
});

const LedgerEventFromUInt8Array: Schema.Schema<LedgerEvent, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, LedgerEventSchema, {
    encode: (e) => {
      return Effect.try({
        try: () => e.serialize(),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize Ledger Event');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => LedgerEvent.deserialize(bytes),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize Ledger Event');
        },
      }),
  }),
);

export const HexedEvent: Schema.Schema<LedgerEvent, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(LedgerEventFromUInt8Array),
);

export const SyncEventsUpdateSchema = Schema.Struct({
  id: Schema.Number,
  raw: HexedEvent,
  maxId: Schema.Number,
});

export type WalletSyncSubscription = Schema.Schema.Type<typeof SyncEventsUpdateSchema>;

export type WalletSyncUpdate = {
  updates: WalletSyncSubscription[];
  secretKey: DustSecretKey;
  timestamp: Date;
};
export const WalletSyncUpdate = {
  create: (updates: WalletSyncSubscription[], secretKey: DustSecretKey, timestamp: Date): WalletSyncUpdate => {
    return {
      updates,
      secretKey,
      timestamp,
    };
  },
};

export const WireBlockDataSchema = Schema.Struct({
  height: Schema.Number,
  hash: Schema.String,
  ledgerParameters: HexedLedgerParameters,
  timestamp: Schema.Number,
  zswapEndIndex: Schema.Number,
  dustCommitmentEndIndex: Schema.Number,
  dustGenerationEndIndex: Schema.Number,
  // nullable in the indexer schema: a block may carry no dust state
  dustCommitmentMerkleTreeRoot: Schema.NullOr(Schema.String),
  dustGenerationMerkleTreeRoot: Schema.NullOr(Schema.String),
});

export const BlockDataSchema = Schema.transform(
  WireBlockDataSchema,
  Schema.typeSchema(
    Schema.Struct({
      height: Schema.Number,
      hash: Schema.String,
      ledgerParameters: HexedLedgerParameters,
      timestamp: Schema.DateFromSelf,
      zswapEndIndex: Schema.Number,
      dustCommitmentEndIndex: Schema.Number,
      dustGenerationEndIndex: Schema.Number,
      dustCommitmentMerkleTreeRoot: Schema.String,
      dustGenerationMerkleTreeRoot: Schema.String,
    }),
  ),
  {
    strict: true,
    decode: (wire) => {
      return {
        ...wire,
        timestamp: new Date(wire.timestamp),
        // '' is the local encoding for "no root" — it matches the wallet-side encoding of an empty tree
        dustCommitmentMerkleTreeRoot: wire.dustCommitmentMerkleTreeRoot ?? '',
        dustGenerationMerkleTreeRoot: wire.dustGenerationMerkleTreeRoot ?? '',
      };
    },
    encode: (domain) => ({
      ...domain,
      timestamp: domain.timestamp.getTime(),
      dustCommitmentMerkleTreeRoot:
        domain.dustCommitmentMerkleTreeRoot === '' ? null : domain.dustCommitmentMerkleTreeRoot,
      dustGenerationMerkleTreeRoot:
        domain.dustGenerationMerkleTreeRoot === '' ? null : domain.dustGenerationMerkleTreeRoot,
    }),
  },
);

export type BlockData = Schema.Schema.Type<typeof BlockDataSchema>;
