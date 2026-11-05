/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Either, type ParseResult, Schema } from 'effect';

/**
 * Every format version the transaction lifecycle store has been written in, oldest first.
 *
 * Declared here, with no ledger import, so the reader and the upgrade step share one source of truth.
 */
export const SNAPSHOT_FORMAT_VERSIONS = ['v1', 'v2'] as const;

/** The format version of a store holding pending items and reservations side by side. */
export const V1_SNAPSHOT_FORMAT_VERSION = 'v1';

/**
 * The format version of a store holding one lifecycle record per transaction. {@link upgradeSnapshotV1ToV2} is the one
 * step into it, and this is the version it stamps. Frozen: a later bump adds a version and a step of its own and leaves
 * this one as it is.
 */
export const V2_SNAPSHOT_FORMAT_VERSION = 'v2';

/**
 * The current format version of the store. This is the constant a bump moves; the upgrade steps never read it, because
 * each stamps the version it upgrades to.
 */
export const SNAPSHOT_FORMAT_VERSION = V2_SNAPSHOT_FORMAT_VERSION;

const V1PendingItem = Schema.Struct({
  tx: Schema.String,
  creationTime: Schema.String,
  protocolVersion: Schema.optional(Schema.String),
});

const V1Reservation = Schema.Struct({
  identifiers: Schema.Array(Schema.String),
  intentHashes: Schema.Array(Schema.String),
  inputs: Schema.Struct({
    unshielded: Schema.Array(Schema.String),
    shielded: Schema.optional(Schema.Array(Schema.String)),
  }),
  ttl: Schema.String,
  createdAt: Schema.String,
  expired: Schema.Boolean,
});

/** What the step looks for: a `v1` store, whose reservations arrived after it was in the field and may be absent. */
const V1Store = Schema.Struct({
  version: Schema.Literal(V1_SNAPSHOT_FORMAT_VERSION),
  transactions: Schema.Array(V1PendingItem),
  reservations: Schema.optional(Schema.Array(V1Reservation)),
});

const isV1Store: (json: unknown) => json is typeof V1Store.Type = Schema.is(V1Store);

const isStampedV1 = (json: unknown): boolean =>
  typeof json === 'object' && json !== null && 'version' in json && json.version === V1_SNAPSHOT_FORMAT_VERSION;

/**
 * Refuses a store stamped `v1` that does not have the `v1` shape, with the reason it does not.
 *
 * @remarks
 *   Run before {@link upgradeSnapshotV1ToV2}, which hands back anything that is not a `v1` store unchanged. Without this
 *   check a damaged `v1` store would reach the `v2` reader and be refused for its version, which this build does read,
 *   rather than for what is actually wrong in it. Anything not stamped `v1` passes through for the reader after it to
 *   judge.
 * @example
 *   const checked = checkV1Store(JSON.parse(stored));
 *
 * @param json The store as decoded from its JSON string.
 * @returns The input unchanged, or why a store stamped `v1` is not one.
 */
export const checkV1Store = (json: unknown): Either.Either<unknown, ParseResult.ParseError> =>
  isStampedV1(json) ? Either.map(Schema.decodeUnknownEither(V1Store)(json), () => json) : Either.right(json);

/**
 * A pending item was finalized at least, and `v1` showed it as submitted. When it was submitted was never kept: its
 * creation time is when it was finalized. Its identifiers, intent hashes, inputs and TTL live in the transaction, for
 * the reader to take from it.
 */
const fromPendingItem = (item: typeof V1PendingItem.Type): Record<string, unknown> => ({
  tx: item.tx,
  createdAt: item.creationTime,
  ...(item.protocolVersion === undefined ? {} : { protocolVersion: item.protocolVersion }),
  state: { _tag: 'Submitted' },
});

/** A reservation never held its transaction or the version it was built for, so its record holds neither. */
const fromReservation = (reservation: typeof V1Reservation.Type): Record<string, unknown> => ({
  identifiers: reservation.identifiers,
  intentHashes: reservation.intentHashes,
  inputs:
    reservation.inputs.shielded === undefined
      ? { unshielded: reservation.inputs.unshielded }
      : { unshielded: reservation.inputs.unshielded, shielded: reservation.inputs.shielded },
  ttl: reservation.ttl,
  createdAt: reservation.createdAt,
  state: { _tag: reservation.expired ? 'Expired' : 'Balanced' },
});

/**
 * Upgrades a decoded transaction lifecycle store from format version `v1` to `v2`.
 *
 * @remarks
 *   A pure function on the decoded JSON, run before any schema, so the schema only ever has to describe one shape. Each
 *   pending item and each reservation becomes one lifecycle record, pending items first; every other top-level member,
 *   known or not, passes through untouched. It fills in only what `v1` recorded and leaves out what it never did, so
 *   the reader derives that from the transaction or goes without. Anything that is not a `v1` store is handed back as
 *   it came, for the schema after it to refuse with a precise reason; and applying the step twice is applying it once.
 * @example
 *   const current = upgradeSnapshotV1ToV2(JSON.parse(stored));
 *
 * @param json The store as decoded from its JSON string.
 * @returns The same store in format `v2`, or the input unchanged when the step does not apply.
 */
export const upgradeSnapshotV1ToV2 = (json: unknown): unknown => {
  if (!isV1Store(json)) return json;
  const { transactions, reservations = [], ...rest } = json;
  return {
    ...rest,
    version: V2_SNAPSHOT_FORMAT_VERSION,
    records: [...transactions.map(fromPendingItem), ...reservations.map(fromReservation)],
  };
};
