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
import { SURFACES, WRITERS, fixturesFor, type Fixture, type Surface, type Writer } from './fixtures.js';
import { rewriteWithCurrentCode } from './rewrite.js';

/**
 * Does reading a stored payload and writing it back keep everything it contained **unchanged**?
 *
 * `informationPreservation.test.ts` asks the same question of key _paths_, and says so deliberately: values, it
 * reasons, legitimately change when a payload is re-encoded. That reasoning leaves a gap, and the gap is reachable. A
 * field whose value is quietly rewritten — a boolean that decodes to a default, a number that loses precision, an
 * identifier that is re-derived rather than read — keeps its path, so the path check stays green. The drift baseline
 * does notice, but drift's own documented remedy is to re-record it, and re-recording makes the loss permanent and
 * green. Nothing downstream of that ever asks again.
 *
 * So this asks about values, against the frozen fixture, which re-recording cannot touch and CI will not let anyone
 * edit.
 *
 * The premise is not an assumption. Across every frozen fixture and both writers, every leaf value survives a read and
 * write byte-identically, with exactly one exception — so there is no allowlist of fields that "may drift", and
 * anything that starts drifting is a finding rather than noise. The one exception is declared below and is itself
 * asserted, rather than merely skipped.
 */

/**
 * Every leaf of a payload as a path and its value, with array positions collapsed.
 *
 * Collapsed because a re-encode may legitimately reorder an array: the values under a path are compared as a sorted
 * bag, so a reordering passes while a changed, lost or invented value does not.
 */
const leavesOf = (value: unknown, prefix = ''): readonly (readonly [string, string])[] => {
  if (Array.isArray(value)) return value.flatMap((item) => leavesOf(item, `${prefix}[]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => leavesOf(child, prefix === '' ? key : `${prefix}.${key}`));
  }
  return [[prefix, JSON.stringify(value)]];
};

/** The leaf values of a payload, keyed by path, each path's values sorted so array order does not matter. */
const valuesByPath = (payload: unknown): Record<string, readonly string[]> =>
  Object.fromEntries(
    [...new Set(leavesOf(payload).map(([path]) => path))].sort().map((path) => [
      path,
      leavesOf(payload)
        .filter(([candidate]) => candidate === path)
        .map(([, value]) => value)
        .sort(),
    ]),
  );

/**
 * The content of a payload with any version envelope peeled off.
 *
 * Adding an envelope re-roots every path beneath it, which is the upgrade doing its job rather than data moving.
 * `informationPreservation.test.ts` has the same notion for its own check; it is repeated rather than shared so that
 * neither file has to change when the other's question does.
 */
const contentOf = (payload: unknown): unknown => {
  if (Array.isArray(payload) || typeof payload !== 'object' || payload === null) return payload;
  const entries = Object.entries(payload as Record<string, unknown>);
  const rest = entries.filter(([key]) => key !== 'version');
  const hadVersion = entries.length - rest.length === 1;
  return hadVersion && rest.length === 1 && Array.isArray(rest[0]?.[1]) ? rest[0]?.[1] : Object.fromEntries(rest);
};

/**
 * The one value a writer is allowed to change, because changing it is the format upgrade.
 *
 * The V2 unshielded writer retypes the verifying key from the bare string the V1 writer stored to `{ tag, value }`.
 * That is `v1 → v2`, and it is the only value difference anywhere in the corpus. It is exempted from the comparison
 * below only so that the dedicated case beneath it can make the stronger claim: the value inside the tag is the very
 * string that was stored, not something re-derived.
 */
const isTheUnshieldedKeyUpgrade = (writer: Writer, surface: Surface, path: string): boolean =>
  writer === 'v2' && surface === 'unshielded' && path === 'publicKey.publicKey';

/** Paths whose values differ between a stored payload and what this build writes back for it. */
const changedPaths = (stored: unknown, written: unknown): readonly string[] => {
  const before = valuesByPath(contentOf(stored));
  const after = valuesByPath(contentOf(written));
  return Object.keys(before).filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]));
};

const cases = WRITERS.flatMap((writer) =>
  SURFACES.flatMap((surface) =>
    fixturesFor(surface).map((fixture) => ({ writer, surface, fixture, id: `${writer} ← ${fixture.id}` })),
  ),
);

describe('reading a stored payload and writing it back changes none of its values', () => {
  it('should have fixtures to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    '$id',
    async ({ writer, surface, fixture }: { writer: Writer; surface: Surface; fixture: Fixture; id: string }) => {
      const rewritten = await rewriteWithCurrentCode(writer, surface, fixture.serialized);

      const changed = changedPaths(JSON.parse(fixture.serialized), JSON.parse(rewritten)).filter(
        (path) => !isTheUnshieldedKeyUpgrade(writer, surface, path),
      );

      expect({ id: fixture.id, changed }).toEqual({ id: fixture.id, changed: [] });
    },
  );
});

/**
 * The exempted value, asserted rather than skipped.
 *
 * An upgrade that tagged the key with anything other than the stored string — a default, a value re-derived from the
 * state, the address — would satisfy both the path check and the exemption above, and would have changed the wallet's
 * identity while every gate stayed green.
 */
describe('the one value a writer may change carries the value it replaced', () => {
  const unshieldedFixtures = fixturesFor('unshielded');

  it('should have unshielded fixtures to check', () => {
    expect(unshieldedFixtures.length).toBeGreaterThan(0);
  });

  it.each(unshieldedFixtures)('v2 ← $id', async (fixture: Fixture) => {
    const rewritten = await rewriteWithCurrentCode('v2', 'unshielded', fixture.serialized);

    const stored = (JSON.parse(fixture.serialized) as { publicKey: { publicKey: unknown } }).publicKey.publicKey;
    const written = (JSON.parse(rewritten) as { publicKey: { publicKey: unknown } }).publicKey.publicKey;

    expect(typeof stored).toBe('string');
    expect(written).toEqual({ tag: 'schnorr', value: stored });
  });
});
