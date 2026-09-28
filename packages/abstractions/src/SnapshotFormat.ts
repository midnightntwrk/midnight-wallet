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

const article = (noun: string): string => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

/**
 * The `version` field of a wallet snapshot, for the one format version a reader accepts.
 *
 * A reader never downgrades: meeting a version it does not know, it refuses the payload and names both the surface it
 * was reading and the version it found, so the failure is actionable without the reader having to parse a schema tree.
 * A payload with no `version` at all predates the field and reads as the version given, because every surface's first
 * labelled shape is the shape it always had.
 *
 * Every snapshot surface declares its field through this one function, so the refusal reads the same on all of them and
 * the rule lives in one place.
 *
 * @example
 *   ```ts
 *   const SnapshotSchema = Schema.Struct({
 *     version: SnapshotFormat.versionField('shielded', SNAPSHOT_FORMAT_VERSION),
 *     // ...
 *   });
 *   ```;
 *
 * @param surface - The snapshot surface, as a noun for the refusal message: `shielded`, `unshielded` or `dust`.
 * @param version - The one format version this reader accepts, and writes when the field is absent.
 * @returns An optional property signature that defaults to `version` and refuses any other value by name.
 */
export const versionField = <const V extends string>(
  surface: string,
  version: V,
): Schema.optionalWith<Schema.Literal<[V]>, { readonly default: () => V }> =>
  Schema.optionalWith(
    Schema.Literal(version).annotations({
      message: (issue) =>
        `Refusing ${article(surface)} ${surface} snapshot written in format version ${JSON.stringify(issue.actual)}: this build reads ${version} and does not downgrade.`,
    }),
    { default: () => version },
  );

/**
 * The variants that write wallet snapshots, by the ordinal each carries in its name: the V1 variant on ledger-v8 and
 * the V2 variant on ledger-v9.
 */
export const SNAPSHOT_WRITERS = ['v1', 'v2'] as const;

/** Which variant wrote a snapshot. */
export type SnapshotWriter = (typeof SNAPSHOT_WRITERS)[number];

/** The V1 variant, as it names itself in a snapshot it writes. */
export const V1_SNAPSHOT_WRITER: SnapshotWriter = 'v1';

/** The V2 variant, as it names itself in a snapshot it writes. */
export const V2_SNAPSHOT_WRITER: SnapshotWriter = 'v2';

/**
 * The `writtenBy` field of a wallet snapshot: which variant wrote it.
 *
 * A format version names a snapshot's shape, and the `protocolVersion` inside it names the chain's version when it was
 * written. Neither says who wrote it, and the wallet layer needs that to route a snapshot home: a V1 wallet that has
 * seen the chain reach `forks.v9` annotates that version before the runtime hands it over, so a snapshot it writes in
 * that window carries a version the V2 variant owns. Read as a V2 snapshot it would skip the cross-ledger migration;
 * routed to the variant that wrote it, it crosses like any other.
 *
 * Optional, because every snapshot written before the field existed lacks it, and those keep routing by version.
 *
 * @returns An optional property signature over the known writers.
 */
export const writtenByField = (): Schema.optional<Schema.Literal<['v1', 'v2']>> =>
  Schema.optional(Schema.Literal(...SNAPSHOT_WRITERS));
