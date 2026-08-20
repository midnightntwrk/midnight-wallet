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
import { Buffer } from 'buffer';
import { Data, Effect, Either, HashMap, ParseResult, pipe, Schema } from 'effect';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { LedgerParametersCodec } from '@midnightntwrk/wallet-sdk-capabilities/codecs';
import {
  type DustSecretKey,
  Event as LedgerEvent,
  DustStateMerkleTreeCollapsedUpdate,
  DustGenerationTreeInsertionPath,
  type DustCommitment,
  type DustNullifier,
  type QualifiedDustOutput,
  dustFirstNonce,
  dustNullifier,
  type TransactionHash,
  LedgerParameters,
} from '@midnightntwrk/ledger-v9';
import { Uint8ArraySchema } from './Serialization.js';
import { type DustGenerationInfo } from './types/index.js';
import { type PublicKey } from './CoreWallet.js';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';

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

export const TransactionEvent = Schema.Struct({
  id: Schema.Number,
  raw: HexedEvent,
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

export const SyncEventsUpdateSchema = Schema.Struct({
  id: Schema.Number,
  raw: HexedEvent,
  maxId: Schema.Number,
  /**
   * The protocol version the indexer reported this event under, when it reports one at all.
   *
   * @remarks
   *   Optional because dust's subscription does not select the field yet — the schema defines it on `DustLedgerEvent`,
   *   but adding the selection-set line waits on confirmation from a deployed indexer. Until then every item arrives
   *   without it, and an absent value means "the indexer did not say", which is treated as in-range: the event applies
   *   normally and the wallet's recorded version is left alone. Reading it as zero instead would drag the recorded
   *   version down and, on a wallet already past the boundary, look like a migration backwards.
   */
  protocolVersion: Schema.optional(Schema.Number),
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

/**
 * The block as the indexer sends it: `ledgerParameters` is still hex, and `protocolVersion` says which ledger version
 * produced that hex.
 *
 * @remarks
 *   The parameters deliberately stay undecoded here, the same way the shielded event payload keeps its `raw` string.
 *   Decoding on arrival means picking a ledger version before reading the one field that says which version to pick,
 *   which is how a block from the other side of a fork takes down the whole fetch.
 */
export const WireBlockDataSchema = Schema.Struct({
  height: Schema.Number,
  hash: Schema.String,
  protocolVersion: Schema.Number,
  ledgerParameters: Schema.String,
  timestamp: Schema.Number,
  zswapEndIndex: Schema.Number,
  dustCommitmentEndIndex: Schema.Number,
  dustGenerationEndIndex: Schema.Number,
  // nullable in the indexer schema: a block may carry no dust state
  dustCommitmentMerkleTreeRoot: Schema.NullOr(Schema.String),
  dustGenerationMerkleTreeRoot: Schema.NullOr(Schema.String),
});

// The protocol version survives the decode: it is what chose the codec, and keeping it means a `BlockData` still says
// which ledger version wrote it once the parameters are an opaque object.
const BlockDataStructSchema = Schema.typeSchema(
  Schema.Struct({
    height: Schema.Number,
    hash: Schema.String,
    protocolVersion: Schema.Number,
    ledgerParameters: HexedLedgerParameters,
    timestamp: Schema.DateFromSelf,
    zswapEndIndex: Schema.Number,
    dustCommitmentEndIndex: Schema.Number,
    dustGenerationEndIndex: Schema.Number,
    dustCommitmentMerkleTreeRoot: Schema.String,
    dustGenerationMerkleTreeRoot: Schema.String,
  }),
);

/**
 * The ledger parameters codecs this variant reads blocks with, unless it is told otherwise.
 *
 * @remarks
 *   Open-ended from the minimum supported version, so a wallet whose variant has not been given a narrower range keeps
 *   reading every block exactly as it did before this became routable. A two-variant dust wallet replaces this with a
 *   registry bounded by the range its variant is active over, and then a block from the other side of the boundary is
 *   refused by name instead of being deserialized.
 */
export const defaultLedgerParametersCodecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters> =
  Either.getOrThrow(
    LedgerParametersCodec.makeCodecs([
      {
        sinceVersion: ProtocolVersion.MinSupportedVersion,
        codec: LedgerParametersCodec.fromDeserializer((bytes: Uint8Array) => LedgerParameters.deserialize(bytes)),
      },
    ]),
  );

/**
 * Builds the block-data schema that reads a block's ledger parameters with whichever codec claims the protocol version
 * the block was reported under.
 *
 * @param codecs The ledger parameters codecs this variant is willing to read with.
 * @returns A schema decoding the indexer's block into {@link BlockData}.
 */
export const makeBlockDataSchema = (
  codecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters>,
): Schema.Schema<BlockData, Schema.Schema.Encoded<typeof WireBlockDataSchema>> =>
  Schema.asSchema(
    Schema.transformOrFail(WireBlockDataSchema, BlockDataStructSchema, {
      strict: true,
      decode: (wire, _options, ast) =>
        pipe(
          LedgerParametersCodec.decode(
            codecs,
            ProtocolVersion.ProtocolVersion(BigInt(wire.protocolVersion)),
            wire.ledgerParameters,
          ),
          Either.mapBoth({
            onLeft: (error) => new ParseResult.Type(ast, wire, error.message),
            onRight: (ledgerParameters) => ({
              height: wire.height,
              hash: wire.hash,
              protocolVersion: wire.protocolVersion,
              ledgerParameters,
              timestamp: new Date(wire.timestamp),
              zswapEndIndex: wire.zswapEndIndex,
              dustCommitmentEndIndex: wire.dustCommitmentEndIndex,
              dustGenerationEndIndex: wire.dustGenerationEndIndex,
              // '' is the local encoding for "no root" — it matches the wallet-side encoding of an empty tree
              dustCommitmentMerkleTreeRoot: wire.dustCommitmentMerkleTreeRoot ?? '',
              dustGenerationMerkleTreeRoot: wire.dustGenerationMerkleTreeRoot ?? '',
            }),
          }),
        ),
      encode: (domain, _options, ast) =>
        Effect.try({
          try: () => ({
            height: domain.height,
            hash: domain.hash,
            protocolVersion: domain.protocolVersion,
            ledgerParameters: Buffer.from(domain.ledgerParameters.serialize()).toString('hex'),
            timestamp: domain.timestamp.getTime(),
            zswapEndIndex: domain.zswapEndIndex,
            dustCommitmentEndIndex: domain.dustCommitmentEndIndex,
            dustGenerationEndIndex: domain.dustGenerationEndIndex,
            dustCommitmentMerkleTreeRoot:
              domain.dustCommitmentMerkleTreeRoot === '' ? null : domain.dustCommitmentMerkleTreeRoot,
            dustGenerationMerkleTreeRoot:
              domain.dustGenerationMerkleTreeRoot === '' ? null : domain.dustGenerationMerkleTreeRoot,
          }),
          catch: (err) => new ParseResult.Type(ast, domain, `Could not serialize Ledger Parameters: ${String(err)}`),
        }),
    }),
  );

export const BlockDataSchema = makeBlockDataSchema(defaultLedgerParametersCodecs);

export type BlockData = Schema.Schema.Type<typeof BlockDataStructSchema>;
