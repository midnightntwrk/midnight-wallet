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
import { DustSecretKey, Event as LedgerEvent } from '@midnight-ntwrk/ledger-v8';
import { Uint8ArraySchema } from './Serialization.js';

export const CollapsedMerkleTreeSchema = Schema.Struct({
  startIndex: Schema.Number,
  endIndex: Schema.Number,
  update: Schema.String,
  protocolVersion: Schema.Number,
});

export const WireDustGenerationsUpdateSchema = Schema.Struct({
  merkleIndex: Schema.Number,
  owner: Schema.String,
  value: Schema.String,
  nonce: Schema.String,
  ctime: Schema.Number,
  transactionId: Schema.Number,
  collapsedMerkleTree: Schema.optional(CollapsedMerkleTreeSchema),
});

export const DustGenerationsUpdateSchema = Schema.transform(
  WireDustGenerationsUpdateSchema,
  Schema.typeSchema(
    Schema.Struct({
      merkleIndex: Schema.Number,
      owner: Schema.String,
      value: Schema.String,
      nonce: Schema.String,
      ctime: Schema.DateFromSelf,
      transactionId: Schema.Number,
      collapsedMerkleTree: Schema.optional(CollapsedMerkleTreeSchema),
    }),
  ),
  {
    strict: true,
    decode: (wire) => ({
      ...wire,
      ctime: new Date(wire.ctime * 1000),
    }),
    encode: (domain) => ({
      ...domain,
      ctime: Math.floor(domain.ctime.getTime() / 1000),
    }),
  },
);

export type DustGenerationsUpdate = Schema.Schema.Type<typeof DustGenerationsUpdateSchema>;

export const ProgressSchema = Schema.Struct({
  type: Schema.Literal('DustGenerationsProgress'),
  highestIndex: Schema.Number,
  collapsedMerkleTree: Schema.optional(CollapsedMerkleTreeSchema),
});

export const DustGenerationsSubscriptionSchema = Schema.Union(DustGenerationsUpdateSchema, ProgressSchema);

export type DustGenerationsSubscription = Schema.Schema.Type<typeof DustGenerationsSubscriptionSchema>;

export type DustGenerationsSyncUpdate = {
  updates: DustGenerationsSubscription[];
  secretKey: DustSecretKey;
  timestamp: Date;
};
export const DustGenerationsSyncUpdate = {
  create: (
    updates: DustGenerationsSubscription[],
    secretKey: DustSecretKey,
    timestamp: Date,
  ): DustGenerationsSyncUpdate => {
    return {
      updates,
      secretKey,
      timestamp,
    };
  },
};

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

const HexedEvent: Schema.Schema<LedgerEvent, string> = pipe(
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
