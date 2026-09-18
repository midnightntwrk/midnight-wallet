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

/**
 * Every format version an unshielded snapshot has been written in, oldest first.
 *
 * The format version names the encoded shape of the snapshot and is not `protocolVersion`, which is the chain's
 * hard-fork number and lives inside it. Declared here, with no ledger import, so that both variants share one source of
 * truth and neither pulls the other's ledger into its module graph to read it.
 */
export const SNAPSHOT_FORMAT_VERSIONS = ['v1', 'v2'] as const;

/**
 * The format version the V1 variant writes: the verifying key is a bare string, implicitly a schnorr key, because
 * ledger-v8 knows no other scheme. Snapshots written before the field existed have this shape, so a missing `version`
 * reads as this one.
 */
export const V1_SNAPSHOT_FORMAT_VERSION = 'v1';

/**
 * The format version the V2 variant writes, and the current version of the surface: the verifying key carries the
 * signature scheme it is for, as `{ tag, value }`, because ledger-v9 signs with more than one. A retyped field is a new
 * format version; {@link upgradeSnapshotV1ToV2} is the one step between the two.
 */
export const SNAPSHOT_FORMAT_VERSION = 'v2';

/** What the upgrade step looks for: a snapshot object whose key is still the bare string `v1` wrote. */
const V1KeyedSnapshot = Schema.Struct({
  version: Schema.optional(Schema.Literal(V1_SNAPSHOT_FORMAT_VERSION)),
  publicKey: Schema.Struct({ publicKey: Schema.String }),
});

const isV1Keyed = Schema.is(V1KeyedSnapshot);
const isRecord = Schema.is(Schema.Record({ key: Schema.String, value: Schema.Unknown }));

/**
 * Upgrades a decoded unshielded snapshot from format version `v1` to `v2`.
 *
 * @remarks
 *   A pure function on the decoded JSON, run before any schema, so the schema only ever has to describe one shape. It
 *   fills in what is missing and never overwrites what is there: a bare-string key becomes a schnorr-tagged one, the
 *   version becomes `v2`, and everything else — known fields and unknown alike — passes through untouched. A key that
 *   already carries its tag is left alone whatever the label says, which is what lets a payload written before the
 *   label existed read as `v2`. Anything that is not a `v1` snapshot object is handed back as it came, for the schema
 *   after it to refuse with a precise reason; and applying the step twice is applying it once.
 * @param json The snapshot as decoded from its JSON string.
 * @returns The same snapshot in the current format, or the input unchanged when the step does not apply.
 */
export const upgradeSnapshotV1ToV2 = (json: unknown): unknown => {
  if (!isRecord(json)) return json;
  if (isV1Keyed(json)) {
    const { publicKey, ...rest } = json;
    return {
      ...rest,
      version: SNAPSHOT_FORMAT_VERSION,
      publicKey: { ...publicKey, publicKey: { tag: 'schnorr', value: publicKey.publicKey } },
    };
  }
  // A tagged key under no label at all is the pre-release shape; under `v1` it is a mislabel. Either way the key is
  // already what `v2` says, so only the label moves. A label this step does not own is left for the schema.
  const version = json['version'];
  return version === undefined || version === V1_SNAPSHOT_FORMAT_VERSION
    ? { ...json, version: SNAPSHOT_FORMAT_VERSION }
    : json;
};
