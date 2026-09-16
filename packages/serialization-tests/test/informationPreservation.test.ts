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
import { describe, expect, it } from 'vitest';
import { SURFACES, declaredVersionOf, fixturesFor, type Fixture } from './fixtures.js';
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
describe('reading a stored payload and writing it back keeps everything it carried', () => {
  const cases = SURFACES.flatMap((surface) => fixturesFor(surface).map((fixture) => ({ surface, fixture })));

  it('should have fixtures to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map(({ surface, fixture }) => ({ surface, fixture, id: fixture.id })))(
    '$id',
    async ({ surface, fixture }: { surface: (typeof SURFACES)[number]; fixture: Fixture }) => {
      const rewritten = await rewriteWithCurrentCode(surface, fixture.serialized);

      const before = uniqueSorted(keyPaths(contentOf(JSON.parse(fixture.serialized))));
      const after = uniqueSorted(keyPaths(contentOf(JSON.parse(rewritten))));

      const lost = before.filter((path) => !after.includes(path));

      expect({ id: fixture.id, lost }).toEqual({ id: fixture.id, lost: [] });
    },
  );

  // A payload that arrives at one version and leaves at another has been upgraded, which is the intended behaviour —
  // but it must be the version this build declares, not some third thing.
  it.each(cases.map(({ surface, fixture }) => ({ surface, fixture, id: fixture.id })))(
    '$id is rewritten at a known version',
    async ({ surface, fixture }: { surface: (typeof SURFACES)[number]; fixture: Fixture }) => {
      const rewritten = await rewriteWithCurrentCode(surface, fixture.serialized);

      expect(declaredVersionOf(rewritten)).toMatch(/^v\d+$/);
    },
  );
});
