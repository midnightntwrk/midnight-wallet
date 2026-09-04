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
import { Data, Effect, Either, HashMap, type Option, ParseResult, pipe, Schema } from 'effect';
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

/**
 * A collapsed Merkle tree update as the indexer served it, still encoded.
 *
 * @remarks
 *   The update travels as bytes rather than as a `DustStateMerkleTreeCollapsedUpdate`, because whether this ledger
 *   version can read it is not the subscription's question to answer — and a subscription that answered it would answer
 *   for the whole batch at once. One item this wallet was never going to apply would fail the fetch it arrived in, and
 *   the stream would retry the same fetch forever. See {@link readCollapsedUpdate}.
 */
export const CollapsedMerkleTreeSchema = Schema.Struct({
  startIndex: Schema.Number,
  endIndex: Schema.Number,
  update: Schema.String,
  protocolVersion: Schema.Number,
});

export type CollapsedMerkleTree = Schema.Schema.Type<typeof CollapsedMerkleTreeSchema>;

/**
 * Reads a collapsed Merkle tree update this wallet is about to apply.
 *
 * @param tree The update as the indexer served it.
 * @returns The decoded update.
 * @throws ParseError if the bytes are not an update this ledger version can deserialize.
 */
export const readCollapsedUpdate = (tree: CollapsedMerkleTree): DustStateMerkleTreeCollapsedUpdate =>
  Schema.decodeSync(HexedDustStateMerkleTreeCollapsedUpdate)(tree.update);

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
  /** The insertion path as the indexer served it, read by {@link readGenerationTreeInsertionPath} when applied. */
  treeInsertionPath: string;
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

/**
 * Reads a generation-tree insertion path this wallet is about to apply.
 *
 * @param treeInsertionPath The path as the indexer served it.
 * @returns The decoded path.
 * @throws ParseError if the bytes are not a path this ledger version can deserialize.
 */
export const readGenerationTreeInsertionPath = (treeInsertionPath: string): DustGenerationTreeInsertionPath =>
  Schema.decodeSync(HexedDustGenerationTreeInsertionPath)(treeInsertionPath);

/**
 * A dtime update as the indexer served it, its insertion path still encoded.
 *
 * @remarks
 *   Structural only, for the same reason as {@link CollapsedMerkleTreeSchema}: a subscription that deserialized on arrival
 *   would decide for the whole batch whether this ledger version can read an item, and fail all of it on the first one
 *   it cannot.
 */
export const DustGenerationDtimeUpdateItemSchema = Schema.transform(
  Schema.Struct({
    __typename: Schema.Literal('DustGenerationDtimeUpdateItem'),
    generationMtIndex: Schema.Number,
    nightUtxoHash: Schema.String,
    newDtime: Schema.Number,
    treeInsertionPath: Schema.String,
  }),
  Schema.typeSchema(
    Schema.Struct({
      __typename: Schema.Literal('DustGenerationDtimeUpdateItem'),
      generationMtIndex: Schema.Number,
      nightUtxoHash: Schema.String,
      newDtime: Schema.DateFromSelf,
      treeInsertionPath: Schema.String,
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

/**
 * One event of a matched transaction, still encoded.
 *
 * @remarks
 *   The nullifier lookup this arrives through searches from block zero and matches on a nullifier _prefix_ — deliberately
 *   over-fetching, for anonymity — so most of what it returns belongs to other parties, and on a chain that has forked
 *   some of it belongs to the previous ledger version. Deserializing on arrival would let either of those fail the
 *   whole lookup, and with it every dust spend this wallet ever made. See {@link readEvent}.
 */
export const TransactionEvent = Schema.Struct({
  id: Schema.Number,
  raw: Schema.String,
  maxId: Schema.Number,
  protocolVersion: Schema.Number,
});

export type TransactionEvent = Schema.Schema.Type<typeof TransactionEvent>;

export type DustSpendProcessedEvent = {
  tag: 'dustSpendProcessed';
  commitment: DustCommitment;
  commitmentIndex: bigint;
  nullifier: DustNullifier;
  vFee: bigint;
  declaredTime: Date;
  blockTime: Date;
};

/**
 * The block a matched transaction sits in, its ledger parameters still encoded.
 *
 * @remarks
 *   `protocolVersion` says which ledger version wrote those parameters, and is therefore what chooses the codec that
 *   reads them — see {@link readNullifierBlockParameters}. Reading them on arrival would mean picking a ledger version
 *   before consulting the one field that says which to pick, which is how a pre-fork block takes down the whole
 *   lookup.
 */
const NullifierBlockInfoSchema = Schema.Struct({
  protocolVersion: Schema.Number,
  ledgerParameters: Schema.String,
});

export type NullifierBlockInfo = Schema.Schema.Type<typeof NullifierBlockInfoSchema>;

/**
 * Reads the ledger parameters of a block holding a spend this wallet owns.
 *
 * @param block The block as the indexer served it.
 * @param codecs The ledger parameters codecs this variant is willing to read with.
 * @returns The decoded parameters, or the codec registry's refusal when no codec claims the block's version.
 */
export const readNullifierBlockParameters = (
  block: NullifierBlockInfo,
  codecs: LedgerParametersCodec.LedgerParametersCodecs<LedgerParameters>,
): Either.Either<LedgerParameters, LedgerParametersCodec.LedgerParametersCodecError> =>
  LedgerParametersCodec.decode(
    codecs,
    ProtocolVersion.ProtocolVersion(BigInt(block.protocolVersion)),
    block.ledgerParameters,
  );

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
  /**
   * The event as the indexer served it, still encoded.
   *
   * @remarks
   *   Whether this ledger version may read the event at all is not the subscription's question to answer. A batch
   *   spanning a protocol boundary carries events of the version that follows this one, which this ledger version
   *   cannot deserialize — the serialization header names a different version — and after a hand-over the inclusive
   *   cursor re-delivers an event of the version that preceded it, which it equally cannot. Both are ordinary, and
   *   neither is an error: they belong to the variant either side.
   *
   *   So the bytes travel undecoded and only the capability, which knows its own activation range, reads the ones it is
   *   about to apply — see {@link readEvent}. Decoding here would fail the whole batch on an event nobody intended to
   *   apply, and the stream would retry that same batch forever.
   */
  raw: Schema.String,
  maxId: Schema.Number,
  /**
   * The protocol version the indexer reported this event under, when it reports one at all.
   *
   * @remarks
   *   Optional rather than required, because an absent value has to keep meaning "the indexer did not say" — which is
   *   treated as in-range: the event applies normally and the wallet's recorded version is left alone. Reading it as
   *   zero instead would drag the recorded version down and, on a wallet already past the boundary, look like a
   *   migration backwards. The subscription itself does select the field.
   */
  protocolVersion: Schema.optional(Schema.Number),
});

export type WalletSyncSubscription = Schema.Schema.Type<typeof SyncEventsUpdateSchema>;

/**
 * Reads an event this variant is going to apply.
 *
 * @remarks
 *   The counterpart of the sync schemas carrying their events encoded: a capability calls this on the batch prefix it
 *   owns, and never on what it defers. Failure here is a genuine one — an event this variant claimed and cannot read —
 *   and is raised rather than returned, because `SyncCapability.applyUpdate` is total in its own domain and the variant
 *   already turns a throw from it into a typed synchronization error.
 * @param event The event-carrying item to read.
 * @returns The event it carries.
 * @throws ParseError if the bytes are not an event this ledger version can deserialize.
 */
export const readEvent = (event: { readonly raw: string }): LedgerEvent => Schema.decodeSync(HexedEvent)(event.raw);

/**
 * Reads an event this variant only might be interested in.
 *
 * @remarks
 *   For sources that over-deliver by design rather than by accident — the nullifier lookup matches on a nullifier
 *   _prefix_ and searches from block zero, so it returns other parties' transactions and, on a chain that has forked,
 *   the previous ledger version's. An event this version cannot read is by construction not one of this wallet's own
 *   spends, so it is skipped rather than raised. Use {@link readEvent} wherever the variant has already claimed the
 *   event.
 * @param event The event-carrying item to read.
 * @returns The event, or `Option.none()` when these bytes are not an event this ledger version reads.
 */
export const tryReadEvent = (event: { readonly raw: string }): Option.Option<LedgerEvent> =>
  Schema.decodeOption(HexedEvent)(event.raw);

/** The ordinary arm of {@link WalletSyncUpdate}: a batch of the indexer's dust event timeline, still encoded. */
export type EventsWalletSyncUpdate = {
  _tag: 'Events';
  updates: WalletSyncSubscription[];
  secretKey: DustSecretKey;
  timestamp: Date;
};

/**
 * What the chain says about itself when its dust timeline says nothing.
 *
 * @remarks
 *   An observation, not a piece of the chain: it moves no cursor, inserts nothing and produces no changes. All it can do
 *   is record a protocol version, which is enough, because recording one outside the running variant's activation range
 *   is exactly what makes the runtime hand over.
 *
 *   `highestEventId` is what makes the record safe to make. Handing over parks the sync cursor where it stands, and the
 *   variant that takes over re-fetches from there — so an event still unread below the source's tip would reach it as
 *   bytes of the version that preceded it, which its ledger cannot deserialize. The signal therefore travels with the
 *   far end of the source's dust event timeline, so the capability can refuse it while anything remains unread.
 *
 *   There is deliberately no "the source provably holds no dust event" arm, which is where this departs from its shielded
 *   twin. Shielded can settle that from the tip alone: a commitment tree that has never grown cannot have had a
 *   nullifier spent against it either, so `zswapEndIndex === 0` proves the timeline is empty. Dust has no such witness
 *   — a `ParamChange` is a dust ledger event and moves neither the commitment tree nor the generation tree, so both end
 *   indices at zero prove nothing. A chain holding literally no dust event therefore never produces a signal; it
 *   crosses on its first dust event instead. That is a liveness cost on a chain nobody has used, not a correctness one,
 *   and it is preferred to a shortcut that cannot be justified.
 */
export type VersionSignalSyncUpdate = Readonly<{
  _tag: 'VersionSignal';
  /** The protocol version the source's tip was reported under. */
  version: number;
  /** The highest dust event id the source holds. */
  highestEventId: number;
}>;
export const VersionSignalSyncUpdate = {
  create: (version: number, highestEventId: number): VersionSignalSyncUpdate => {
    return {
      _tag: 'VersionSignal',
      version,
      highestEventId,
    };
  },
};

/**
 * What the indexer-backed sync source emits.
 *
 * @remarks
 *   Ordinarily a batch of dust events; and, on a timer, what the chain says about its own version when its timeline says
 *   nothing.
 */
export type WalletSyncUpdate = EventsWalletSyncUpdate | VersionSignalSyncUpdate;
export const WalletSyncUpdate = {
  create: (updates: WalletSyncSubscription[], secretKey: DustSecretKey, timestamp: Date): EventsWalletSyncUpdate => {
    return {
      _tag: 'Events',
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
