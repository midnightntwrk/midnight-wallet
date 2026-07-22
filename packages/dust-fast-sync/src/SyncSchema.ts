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
import { Data, Effect, HashMap, ParseResult, pipe, Schema } from 'effect';
// The rc ledger (8.2.0-rc.1) carries the projections-sync additions (DustGenerationTreeInsertionPath,
// dustFirstNonce, ...) that ledger 8.1.0 lacks. Everything parsed here feeds rc-instance state operations in
// EventLessSync/StateOps, so every WASM-backed value in this module MUST be produced by the rc module — mixing
// instances across the two loaded WASM copies fails at runtime.
import {
  type DustSecretKey,
  DustStateMerkleTreeCollapsedUpdate,
  DustGenerationTreeInsertionPath,
  type DustCommitment,
  type DustNullifier,
  type QualifiedDustOutput,
  dustFirstNonce,
  dustNullifier,
  type TransactionHash,
  LedgerParameters,
} from '@midnight-ntwrk/ledger-v8-rc';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  type BlockData,
  type DustGenerationInfo,
  type PublicKey,
  SyncSchema as DustWalletSyncSchema,
} from '@midnightntwrk/wallet-sdk-dust-wallet/v1';

const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

const DustStateMerkleTreeCollapsedUpdateSchema = Schema.declare(
  (input: unknown): input is DustStateMerkleTreeCollapsedUpdate => input instanceof DustStateMerkleTreeCollapsedUpdate,
).annotations({
  identifier: 'DustStateMerkleTreeCollapsedUpdate',
});

const DustStateMerkleTreeCollapsedUpdateFromUInt8Array: Schema.Schema<DustStateMerkleTreeCollapsedUpdate, Uint8Array> =
  Schema.asSchema(
    Schema.transformOrFail(Uint8ArraySchema, DustStateMerkleTreeCollapsedUpdateSchema, {
      encode: (value) => {
        return Effect.try({
          try: () => {
            return value.serialize();
          },
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not serialize DustStateMerkleTreeCollapsedUpdate');
          },
        });
      },
      decode: (bytes) =>
        Effect.try({
          try: () => DustStateMerkleTreeCollapsedUpdate.deserialize(bytes),
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not deserialize DustStateMerkleTreeCollapsedUpdate');
          },
        }),
    }),
  );

const HexedDustStateMerkleTreeCollapsedUpdate: Schema.Schema<DustStateMerkleTreeCollapsedUpdate, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(DustStateMerkleTreeCollapsedUpdateFromUInt8Array),
);

export const CollapsedMerkleTreeSchema = Schema.Struct({
  startIndex: Schema.Number,
  endIndex: Schema.Number,
  update: HexedDustStateMerkleTreeCollapsedUpdate,
  protocolVersion: Schema.Number,
});

export type CollapsedMerkleTree = Schema.Schema.Type<typeof CollapsedMerkleTreeSchema>;

export const WireDustGenerationsUpdateSchema = Schema.Struct({
  __typename: Schema.Literal('DustGenerationsItem'),
  commitmentMtIndex: Schema.Number,
  generationMtIndex: Schema.Number,
  owner: Schema.String,
  value: Schema.String,
  initialValue: Schema.String,
  backingNight: Schema.String,
  ctime: Schema.Number,
  transactionId: Schema.Number,
  transactionHash: Schema.String,
  collapsedMerkleTree: Schema.Union(CollapsedMerkleTreeSchema, Schema.Null),
});

export const DustGenerationsUpdateSchema = Schema.transform(
  WireDustGenerationsUpdateSchema,
  Schema.typeSchema(
    Schema.Struct({
      __typename: Schema.Literal('DustGenerationsItem'),
      commitmentMtIndex: Schema.Number,
      generationMtIndex: Schema.Number,
      owner: Schema.String,
      value: Schema.String,
      initialValue: Schema.String,
      backingNight: Schema.String,
      ctime: Schema.DateFromSelf,
      transactionId: Schema.Number,
      transactionHash: Schema.String,
      collapsedMerkleTree: Schema.Union(CollapsedMerkleTreeSchema, Schema.Null),
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

export type NewDustGeneration = {
  dustNullifier: DustNullifier;
  genInfo: DustGenerationInfo;
  generationMtIndex: number;
  qdo: QualifiedDustOutput;
  transactionId: number;
  transactionHash: TransactionHash;
};

export type DustGenerationDtimUpdate = {
  generationMtIndex: number;
  nightUtxoHash: string;
  newDtime: Date;
  treeInsertionPath: DustGenerationTreeInsertionPath;
};

export type DustUtxoUpdate = {
  dustNullifier: DustNullifier;
  qdo: QualifiedDustOutput;
  isSpent: boolean;
  transactionId: number;
  transactionHash: TransactionHash;
  genInfo: DustGenerationInfo;
};

export const ProgressSchema = Schema.Struct({
  __typename: Schema.Literal('DustGenerationsProgress'),
  highestIndex: Schema.Number,
  collapsedMerkleTree: Schema.Union(CollapsedMerkleTreeSchema, Schema.Null),
});

const DustGenerationTreeInsertionPathSchema = Schema.declare(
  (input: unknown): input is DustGenerationTreeInsertionPath => input instanceof DustGenerationTreeInsertionPath,
).annotations({
  identifier: 'DustGenerationTreeInsertionPath',
});

const DustGenerationTreeInsertionPathFromUInt8Array: Schema.Schema<DustGenerationTreeInsertionPath, Uint8Array> =
  Schema.asSchema(
    Schema.transformOrFail(Uint8ArraySchema, DustGenerationTreeInsertionPathSchema, {
      encode: (value) => {
        return Effect.try({
          try: () => {
            return value.serialize();
          },
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not serialize DustGenerationTreeInsertionPath');
          },
        });
      },
      decode: (bytes) =>
        Effect.try({
          try: () => DustGenerationTreeInsertionPath.deserialize(bytes),
          catch: (err) => {
            return new ParseResult.Unexpected(err, 'Could not deserialize DustGenerationTreeInsertionPath');
          },
        }),
    }),
  );

const HexedDustGenerationTreeInsertionPath: Schema.Schema<DustGenerationTreeInsertionPath, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(DustGenerationTreeInsertionPathFromUInt8Array),
);

export const DustGenerationDtimeUpdateItemSchema = Schema.transform(
  Schema.Struct({
    __typename: Schema.Literal('DustGenerationDtimeUpdateItem'),
    generationMtIndex: Schema.Number,
    nightUtxoHash: Schema.String,
    newDtime: Schema.Number,
    treeInsertionPath: HexedDustGenerationTreeInsertionPath,
  }),
  Schema.typeSchema(
    Schema.Struct({
      __typename: Schema.Literal('DustGenerationDtimeUpdateItem'),
      generationMtIndex: Schema.Number,
      nightUtxoHash: Schema.String,
      newDtime: Schema.DateFromSelf,
      treeInsertionPath: HexedDustGenerationTreeInsertionPath,
    }),
  ),
  {
    strict: true,
    decode: (wire) => ({
      ...wire,
      newDtime: new Date(wire.newDtime * 1000),
    }),
    encode: (domain) => ({
      ...domain,
      newDtime: Math.floor(domain.newDtime.getTime() / 1000),
    }),
  },
);

export const DustGenerationsSubscriptionSchema = Schema.Union(
  DustGenerationsUpdateSchema,
  ProgressSchema,
  DustGenerationDtimeUpdateItemSchema,
);

export type DustGenerationsSubscription = Schema.Schema.Type<typeof DustGenerationsSubscriptionSchema>;

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

export const TransactionEvent = Schema.Struct({
  id: Schema.Number,
  // Parsed with the base (8.1.0) ledger: the events are only read structurally (`raw.content`), never handed to an
  // rc-module function, and sharing the dust-wallet schema keeps a single Event decoder across both sync models.
  raw: DustWalletSyncSchema.HexedEvent,
  maxId: Schema.Number,
  protocolVersion: Schema.Number,
});

export type DustSpendProcessedEvent = {
  tag: 'dustSpendProcessed';
  commitment: DustCommitment;
  commitmentIndex: bigint;
  nullifier: DustNullifier;
  vFee: bigint;
  declaredTime: Date;
  blockTime: Date;
};

const NullifierBlockInfoSchema = Schema.Struct({
  ledgerParameters: HexedLedgerParameters,
});

const NullifierNonRegularTransactionSchema = Schema.Struct({
  __typename: Schema.Literal('SystemTransaction', 'BridgeClaimTransaction'),
  block: NullifierBlockInfoSchema,
});

const NullifierRegularTransactionSchema = Schema.Struct({
  __typename: Schema.Literal('RegularTransaction'),
  block: NullifierBlockInfoSchema,
  id: Schema.Number,
  hash: Schema.String,
  dustLedgerEvents: Schema.Array(TransactionEvent),
  zswapLedgerEvents: Schema.Array(TransactionEvent),
});
export type NullifierRegularTransaction = Schema.Schema.Type<typeof NullifierRegularTransactionSchema>;

const NullifierTransactionSchema = Schema.Union(
  NullifierNonRegularTransactionSchema,
  NullifierRegularTransactionSchema,
);

export const DustNullifierTransactionSubscriptionSchema = Schema.Struct({
  nullifierLeBytes: Schema.String,
  commitmentLeBytes: Schema.String,
  transactionId: Schema.Number,
  transactionHash: Schema.String,
  blockHeight: Schema.Number,
  blockHash: Schema.String,
  transaction: NullifierTransactionSchema,
});

export type DustNullifierTransactionsSubscription = Schema.Schema.Type<
  typeof DustNullifierTransactionSubscriptionSchema
>;

export type DustGenerationsSyncUpdate = {
  rawUpdates: DustGenerationsSubscription[];
  newGenerations: NewDustGeneration[];
  generationDtimeUpdates: DustGenerationDtimUpdate[];
};
export const DustGenerationsSyncUpdate = {
  create: (
    rawUpdates: DustGenerationsSubscription[],
    secretKey: DustSecretKey,
    publicKey: PublicKey,
    lastSyncedGenerationIndex: bigint,
  ): DustGenerationsSyncUpdate => {
    const { publicKey: dustPublicKey } = publicKey;
    const dustAddressHex = new DustAddress(dustPublicKey).hexString;
    const newGenerations = rawUpdates
      .filter((u) => u.__typename === 'DustGenerationsItem')
      .filter((u) => u.owner === dustAddressHex && u.generationMtIndex > lastSyncedGenerationIndex)
      .toSorted((u1, u2) => u1.generationMtIndex - u2.generationMtIndex)
      .map((u) => {
        const qdo = {
          initialValue: BigInt(u.initialValue),
          owner: dustPublicKey,
          nonce: dustFirstNonce(u.backingNight, dustPublicKey),
          seq: 0,
          ctime: u.ctime,
          backingNight: u.backingNight,
          mtIndex: BigInt(u.commitmentMtIndex),
        };
        return {
          dustNullifier: dustNullifier(qdo, secretKey),
          genInfo: {
            value: BigInt(u.value),
            owner: dustPublicKey,
            nonce: u.backingNight,
            dtime: undefined,
          },
          generationMtIndex: u.generationMtIndex,
          qdo,
          transactionId: u.transactionId,
          transactionHash: u.transactionHash,
        };
      });

    const generationDtimeUpdates = rawUpdates
      .filter((u) => u.__typename === 'DustGenerationDtimeUpdateItem')
      .toSorted((u1, u2) => u1.generationMtIndex - u2.generationMtIndex)
      .map(({ __typename, ...rest }) => rest);

    return {
      rawUpdates,
      newGenerations,
      generationDtimeUpdates,
    };
  },
};

export type DustUtxoEntry = {
  qdo: QualifiedDustOutput;
  transactionId: number;
  transactionHash: string;
  genInfo: DustGenerationInfo;
};

export type DustUtxoMap = HashMap.HashMap<DustNullifier, DustUtxoEntry>;

export const DustUtxoMap = {
  create: (generations: ReadonlyArray<NewDustGeneration>): DustUtxoMap =>
    HashMap.fromIterable(
      generations.map(
        (u) =>
          [
            u.dustNullifier,
            {
              qdo: u.qdo,
              transactionId: u.transactionId,
              transactionHash: u.transactionHash,
              genInfo: u.genInfo,
            },
          ] as const,
      ),
    ),
};

export type DustProjectionsUpdate = Data.TaggedEnum<{
  ProgressUpdate: { readonly appliedIndex?: number; readonly highestRelevantIndex?: number };
  StateUpdate: {
    readonly dustGenerations: DustGenerationsSyncUpdate;
    readonly newUtxos: DustUtxoMap;
    readonly spentUtxos: DustUtxoMap;
    readonly collapsedCommitments: CollapsedMerkleTree[];
    readonly latestBlock: BlockData;
  };
}>;
const DustProjectionsUpdate = Data.taggedEnum<DustProjectionsUpdate>();
export const isProgressUpdate = DustProjectionsUpdate.$is('ProgressUpdate');
export const { $match: match, StateUpdate, ProgressUpdate } = DustProjectionsUpdate;
