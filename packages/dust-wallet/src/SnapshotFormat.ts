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
import { ProtocolVersion, SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { Schema } from 'effect';

/**
 * Every format version a dust snapshot has been written in, oldest first.
 *
 * The format version names the encoded shape of the snapshot and is not `protocolVersion`, which is the chain's
 * hard-fork number and lives inside it. Declared here, with no ledger import, so that both variants share one source of
 * truth and neither pulls the other's ledger into its module graph to read it.
 */
export const SNAPSHOT_FORMAT_VERSIONS = ['v1', 'v2'] as const;

/**
 * The first format version: the ledger's local state and the wallet's identity, with no record of the Dust that pending
 * transactions have spent. Snapshots written before the `version` field existed have this shape, so a missing `version`
 * reads as this one.
 */
export const V1_SNAPSHOT_FORMAT_VERSION = 'v1';

/**
 * The format version that records `pendingDust`: the Dust coins, nullifiers included, that pending transactions have
 * spent and no sync has yet settled, so a wallet restored from its snapshot can still release them if those
 * transactions fail.
 *
 * @remarks
 *   A required field, and so a new version rather than an optional field on `v1`. Pending Dust is derived from state an
 *   older build keeps changing: a `v1` reader would carry the field through unread while spending and settling coins of
 *   its own, and write it back stale. {@link upgradeSnapshotV1ToV2} is the one step between the two, and this is the
 *   version it stamps. Frozen: a later bump adds a version and a step of its own and leaves this one as it is.
 */
export const V2_SNAPSHOT_FORMAT_VERSION = 'v2';

/**
 * The current format version of the surface, the one both variants write today. This is the constant a bump moves; the
 * upgrade steps never read it, because each stamps the version it upgrades to.
 */
export const SNAPSHOT_FORMAT_VERSION = V2_SNAPSHOT_FORMAT_VERSION;

/**
 * The largest element of the proof system's scalar field, the same in ledger-v8 and ledger-v9 (their `maxField()`).
 * Held as a literal so that this module loads no ledger.
 */
const MAX_FIELD = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000000n;

/**
 * A field element: what the ledger takes for nullifiers, nonces and Dust public keys, and throws on anything outside
 * `0..MAX_FIELD`.
 */
export const FieldElementSchema = Schema.BigInt.pipe(Schema.betweenBigInt(0n, MAX_FIELD));

/** An unsigned 64-bit integer, the ledger's width for Merkle tree indices. */
const U64Schema = Schema.BigInt.pipe(Schema.betweenBigInt(0n, 2n ** 64n - 1n));

/**
 * A snapshot's `offset`: the position sync resumes from, which it hands the indexer as a GraphQL `Int` (the dust event
 * id, or the dtime cutoff height). A GraphQL `Int` is a signed 32-bit integer, so a larger offset could never be
 * resumed from.
 */
export const OffsetSchema = Schema.BigInt.pipe(Schema.betweenBigInt(0n, 2n ** 31n - 1n));

/** An unsigned 128-bit integer, as the ledger reads Dust values. */
const U128Schema = Schema.BigInt.pipe(Schema.betweenBigInt(0n, 2n ** 128n - 1n));

/** An unsigned 32-bit integer, as the ledger reads a Dust coin's `seq`. */
const U32Schema = Schema.Number.pipe(Schema.int(), Schema.between(0, 2 ** 32 - 1));

/** A Dust coin's backing Night nonce: 32 bytes in hex, the only length the ledger deserializes. */
const BackingNightSchema = Schema.String.pipe(Schema.pattern(/^[0-9a-fA-F]{64}$/));

/**
 * One booking of a Dust coin by a pending transaction, as both variants encode it in `pendingDust`: the coin, its
 * nullifier, and the time the spending transaction declared. Every field is a primitive, so one schema here serves both
 * ledgers; a date as an ISO string keeps its milliseconds.
 *
 * @remarks
 *   Each field is held to the bounds the ledger accepts, because an entry outside them would restore and then throw on
 *   every sync that tries to settle it, and nothing else would ever remove it.
 */
export const PendingDustSchema = Schema.Struct({
  coin: Schema.Struct({
    initialValue: U128Schema,
    owner: FieldElementSchema,
    nonce: FieldElementSchema,
    seq: U32Schema,
    ctime: Schema.Date,
    backingNight: BackingNightSchema,
    mtIndex: U64Schema,
  }),
  nullifier: FieldElementSchema,
  declaredTime: Schema.Date,
});

/**
 * A snapshot's `protocolVersion`: from `MinSupportedVersion` up to, but not including, `MaxSupportedVersion`, which is
 * the exclusive end of every variant's range, so a wallet restored at it would have no variant to run it.
 */
export const ProtocolVersionFieldSchema = Schema.BigInt.pipe(
  Schema.greaterThanOrEqualToBigInt(ProtocolVersion.MinSupportedVersion),
  Schema.lessThanBigInt(ProtocolVersion.MaxSupportedVersion),
);

/**
 * Which synchronization moved a wallet's position, and so what a snapshot's `offset` holds.
 *
 * - `events`: the id of the last dust ledger event applied (`progress.appliedIndex`), which event replay resumes its
 *   subscription from. A wallet nothing has been synchronized into is here too: its offset is `0`, which event replay
 *   reads as "nothing applied yet", and which no other synchronization reads at all.
 * - `projections`: the height of the block its last pass synced to (`progress.highestIndex`), which the next pass asks
 *   the indexer for dtime updates after; `0` until a pass has finished, which asks for all of them. Not an event id,
 *   and never to be resumed from as one. A projections wallet's `appliedIndex` is a count of the work a pass has done,
 *   which the next pass works out again from the ledger state, so it is not saved.
 */
export type SyncKind = 'events' | 'projections';

/**
 * How a snapshot records {@link SyncKind}: a required field of format `v2`.
 *
 * @remarks
 *   Required rather than optional because its value is derived from state an older build keeps changing: an older reader
 *   would carry the field through unread while synchronizing some other way, and write back a claim about a position it
 *   had since replaced.
 */
export const SyncKindSchema = Schema.Literal('events', 'projections');

/**
 * Upgrades a decoded dust snapshot from format version `v1` to `v2`.
 *
 * @remarks
 *   A pure function on the decoded JSON, run before any schema, so the schema only ever has to describe one shape. It
 *   fills in what is missing and never overwrites what is there: a `v1` snapshot recorded no pending Dust, so it gains
 *   an empty `pendingDust`; it gains a `syncKind` of `events`, because every stable release that wrote `v1` synced by
 *   event replay only, and projections were reachable on no release by default; and the version becomes `v2`.
 *   Everything else — known fields and unknown alike — passes through untouched. Anything that is not a `v1` (or
 *   unlabelled) snapshot object is handed back as it came, for the schema after it to refuse with a precise reason; and
 *   applying the step twice is applying it once.
 * @param json The snapshot as decoded from its JSON string.
 * @returns The same snapshot in format `v2`, or the input unchanged when the step does not apply.
 */
export const upgradeSnapshotV1ToV2 = (json: unknown): unknown => {
  if (!SnapshotFormat.isJsonObject(json)) return json;
  const version = json['version'];
  return version === undefined || version === V1_SNAPSHOT_FORMAT_VERSION
    ? { pendingDust: [], syncKind: 'events', ...json, version: V2_SNAPSHOT_FORMAT_VERSION }
    : json;
};
