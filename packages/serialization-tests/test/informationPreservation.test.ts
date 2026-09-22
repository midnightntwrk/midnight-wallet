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
import { describe, expect, it } from 'vitest';
import {
  SURFACES,
  WRITERS,
  isHandedTo,
  currentVersionOf,
  declaredVersionOf,
  fixturesFor,
  type Fixture,
  type Surface,
  type Writer,
} from './fixtures.js';
import { rewriteWithCurrentCode } from './rewrite.js';

/**
 * Every key path in a payload, as dotted strings, with array elements collapsed to one path per position-independent
 * shape. Comparing paths rather than values is deliberate: values legitimately change when a payload is re-encoded (a
 * sync offset is re-derived, an optional is re-ordered), but a key that was there and is now gone is data loss.
 */
const keyPaths = (value: unknown, prefix = ''): readonly string[] => {
  if (Array.isArray(value)) {
    // One entry's shape stands for the array's: an empty array carries no shape to lose, and a ragged array would
    // otherwise report a path as missing merely because a later element never had it.
    return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      return [path, ...keyPaths(child, path)];
    });
  }
  return [];
};

const uniqueSorted = (paths: readonly string[]): readonly string[] => [...new Set(paths)].sort();

/**
 * The content of a payload, with any version envelope peeled off.
 *
 * Adding an envelope re-roots every key beneath it — `hash` becomes `entries[].hash` — which is the upgrade doing its
 * job, not a field going missing. Comparing content to content keeps this check about data, and leaves the envelope
 * itself to the drift and coverage tests.
 *
 * An envelope is recognised structurally rather than by name: a `version` alongside exactly one other key whose value
 * is an array. Anything else is content already, minus its `version` if it has one.
 */
const contentOf = (payload: unknown): unknown => {
  if (Array.isArray(payload) || typeof payload !== 'object' || payload === null) return payload;
  const entries = Object.entries(payload as Record<string, unknown>);
  const [versioned, rest] = [
    entries.filter(([key]) => key === 'version'),
    entries.filter(([key]) => key !== 'version'),
  ];
  if (versioned.length === 1 && rest.length === 1 && Array.isArray(rest[0]?.[1])) return rest[0]?.[1];
  return Object.fromEntries(rest);
};

/**
 * Does reading a stored payload and writing it back out keep everything it contained?
 *
 * This is the check the other three cannot make. The compatibility tests prove a payload still **decodes**, and a
 * payload decodes perfectly well while a field is being thrown away — Effect Schema ignores keys it does not know, so
 * removing a field from a schema makes old data restore without complaint and lose that field on the next write. The
 * drift test does notice, but its remedy is to re-record the baseline, which makes the loss permanent and green.
 *
 * That is not hypothetical. It is exactly how the shielded snapshot lost the transaction history it used to embed:
 * restore succeeded, nothing failed, and the data was gone on the next save.
 *
 * So this compares against the **frozen fixture**, which cannot be re-recorded. Within one format version, a key that a
 * published payload carried must still be there after this build reads it and writes it back. Removing a field is still
 * allowed — it is a breaking change, which means a new format version, and the new version's fixtures anchor this check
 * afresh.
 */
/** A snapshot's fields as read off the JSON, for the content checks that key paths alone cannot make. */
const SnapshotFields = Schema.Struct({
  publicKey: Schema.optional(Schema.Struct({ publicKey: Schema.Unknown, address: Schema.optional(Schema.String) })),
  txHistory: Schema.optional(Schema.Array(Schema.String)),
});
const fieldsOf = Schema.decodeUnknownSync(SnapshotFields, { onExcessProperty: 'ignore' });

describe('reading a stored payload and writing it back keeps everything it carried', () => {
  const cases = WRITERS.flatMap((writer) =>
    SURFACES.flatMap((surface) =>
      fixturesFor(surface)
        .filter((fixture) => isHandedTo(writer, surface, fixture.serialized))
        .map((fixture) => ({ writer, surface, fixture, id: `${writer} ← ${fixture.id}` })),
    ),
  );

  it('should have fixtures to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  // One rewrite per writer and fixture, checked several times over: rewriting is the expensive part, and every question
  // is about the same written-back payload. The V2 reader takes every frozen fixture, because a build that registers
  // only the V2 variant still has to open what a V1 wallet stored; the V1 reader takes the ones routing would hand it,
  // which `isHandedTo` decides. Running the V1 reader over a payload written past the fork would hold it to a shape it
  // is never given — see that function for why the distinction only starts to matter once a v9 fixture is captured.
  it.each(cases)(
    '$id',
    async ({ writer, surface, fixture }: { writer: Writer; surface: Surface; fixture: Fixture }) => {
      const rewritten = await rewriteWithCurrentCode(writer, surface, fixture.serialized);
      const stored: unknown = JSON.parse(fixture.serialized);
      const written: unknown = JSON.parse(rewritten);

      const before = uniqueSorted(keyPaths(contentOf(stored)));
      const after = uniqueSorted(keyPaths(contentOf(written)));

      const lost = before.filter((path) => !after.includes(path));

      expect({ id: fixture.id, lost }).toEqual({ id: fixture.id, lost: [] });

      // A payload that arrives at one version and leaves at another has been upgraded, which is the intended
      // behaviour — but it must leave at exactly the version this writer's code declares it writes. Matching the
      // shape `/^v\d+$/` would not hold this: `declaredVersionOf` reports `v1` for a payload carrying no envelope at
      // all, so a writer that stopped emitting one would still have satisfied it.
      expect(declaredVersionOf(rewritten)).toBe(currentVersionOf[writer][surface]);

      // Key paths say a field is still there; these say it still holds what it held. The embedded shielded history is
      // the field that was once lost this way, so its presence is checked in both directions — carried when the fixture
      // had one, and not invented when it did not. An unshielded key that was a bare string must come back as the same
      // string inside its tag, at the same address: an upgrade step that re-derived or defaulted either would pass the
      // path check and still have lost the identity.
      if (surface === 'shielded') {
        expect(fieldsOf(written).txHistory).toEqual(fieldsOf(stored).txHistory);
      }
      if (surface === 'unshielded') {
        // The V1 writer keeps the bare string and the V2 writer tags it; read both through the tag so one assertion holds.
        const tagged = (key: unknown): unknown => (typeof key === 'string' ? { tag: 'schnorr', value: key } : key);
        expect(tagged(fieldsOf(written).publicKey?.publicKey)).toEqual(tagged(fieldsOf(stored).publicKey?.publicKey));
        expect(fieldsOf(written).publicKey?.address).toEqual(fieldsOf(stored).publicKey?.address);
      }
    },
  );
});
