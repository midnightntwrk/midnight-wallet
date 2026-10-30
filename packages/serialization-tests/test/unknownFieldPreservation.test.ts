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
import { WRITERS, fixturesFor, isHandedTo, type Fixture, type Surface, type Writer } from './fixtures.js';
import { rewriteWithCurrentCode } from './rewrite.js';

/**
 * Does a reader keep a field it does not know, and write it back unchanged?
 *
 * Adding an optional field is not a format-version bump, so a payload written by a later release carries a version this
 * build accepts. If this build then reads it and writes it back without the field — after a rollback, or with two
 * builds sharing one storage — the later release finds its field gone, and nothing ever refused anything. So every
 * reader carries what it cannot interpret, and every writer writes it back.
 *
 * Each case starts from a frozen fixture, so the input is a payload a published SDK really wrote, plus one field no
 * build of this SDK has ever declared. Its value is nested so that a reader keeping only the key, or flattening the
 * value, fails as surely as one dropping it.
 */
const UNKNOWN_KEY = 'fieldFromALaterRelease';
const UNKNOWN_VALUE = { kept: ['exactly', 'as', 'written'], count: 3, nested: { flag: true, nothing: null } };

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withUnknownField = (value: JsonObject): JsonObject => ({ ...value, [UNKNOWN_KEY]: UNKNOWN_VALUE });

const parseObject = (serialized: string): JsonObject => {
  const parsed: unknown = JSON.parse(serialized);
  if (!isJsonObject(parsed)) throw new Error(`expected a JSON object, found ${serialized.slice(0, 80)}`);
  return parsed;
};

/** The entries of a transaction history, from either the bare array of `v1` or the envelope of `v2`. */
const entriesOf = (payload: unknown): readonly JsonObject[] => {
  const entries = Array.isArray(payload) ? payload : isJsonObject(payload) ? payload['entries'] : undefined;
  if (!Array.isArray(entries)) throw new Error('expected a transaction history with entries');
  return entries.filter(isJsonObject);
};

const SINGLE_OBJECT_SURFACES = [
  'shielded',
  'unshielded',
  'dust',
  'pending-transactions',
] as const satisfies readonly Surface[];

describe('a reader keeps a top-level field it does not know, and writes it back unchanged', () => {
  const cases = WRITERS.flatMap((writer) =>
    SINGLE_OBJECT_SURFACES.flatMap((surface) =>
      fixturesFor(surface)
        .filter((fixture) => isHandedTo(writer, surface, fixture.serialized))
        .map((fixture) => ({ writer, surface, fixture, id: `${writer} ← ${fixture.id}` })),
    ),
  );

  it('should have a fixture for every snapshot surface under both writers, and for pending transactions', () => {
    const covered = new Set(cases.map(({ writer, surface }) => `${writer}/${surface}`));
    expect([...covered].sort()).toEqual(
      WRITERS.flatMap((writer) => SINGLE_OBJECT_SURFACES.map((surface) => `${writer}/${surface}`)).sort(),
    );
  });

  it.each(cases)(
    '$id should carry the unknown field through, so a later release reading the payload back still finds it',
    async ({ writer, surface, fixture }: { writer: Writer; surface: Surface; fixture: Fixture }) => {
      const input = JSON.stringify(withUnknownField(parseObject(fixture.serialized)));

      const written = parseObject(await rewriteWithCurrentCode(writer, surface, input));

      expect(written[UNKNOWN_KEY]).toEqual(UNKNOWN_VALUE);
    },
  );
});

describe('the transaction history keeps a field it does not know, on the envelope and on every entry', () => {
  const cases = WRITERS.flatMap((writer) =>
    fixturesFor('tx-history').map((fixture) => ({ writer, fixture, id: `${writer} ← ${fixture.id}` })),
  );

  it('should have transaction-history fixtures with entries to check', () => {
    expect(cases.length).toBeGreaterThan(0);
    cases.forEach(({ fixture }) => expect(entriesOf(JSON.parse(fixture.serialized)).length).toBeGreaterThan(0));
  });

  it.each(cases)(
    '$id should carry an unknown field on each entry through the format upgrade, so no entry loses what it carried',
    async ({ writer, fixture }: { writer: Writer; fixture: Fixture }) => {
      const stored: unknown = JSON.parse(fixture.serialized);
      const input = Array.isArray(stored)
        ? JSON.stringify(entriesOf(stored).map(withUnknownField))
        : JSON.stringify({ ...parseObject(fixture.serialized), entries: entriesOf(stored).map(withUnknownField) });

      const written: unknown = JSON.parse(await rewriteWithCurrentCode(writer, 'tx-history', input));

      expect(entriesOf(written).map((entry) => [entry['hash'], entry[UNKNOWN_KEY]])).toEqual(
        entriesOf(stored).map((entry) => [entry['hash'], UNKNOWN_VALUE]),
      );
    },
  );

  // No frozen fixture is in the current envelope format yet, so the envelope is the one this build writes for a frozen
  // payload: still real stored data, read and written once by the current code, before the unknown fields are added.
  it.each(cases)(
    '$id should carry an unknown field on the envelope and on each entry, so a later release reading the history back still finds both',
    async ({ writer, fixture }: { writer: Writer; fixture: Fixture }) => {
      const current = parseObject(await rewriteWithCurrentCode(writer, 'tx-history', fixture.serialized));
      const input = JSON.stringify(withUnknownField({ ...current, entries: entriesOf(current).map(withUnknownField) }));

      const written = parseObject(await rewriteWithCurrentCode(writer, 'tx-history', input));

      expect(written[UNKNOWN_KEY]).toEqual(UNKNOWN_VALUE);
      expect(entriesOf(written).map((entry) => [entry['hash'], entry[UNKNOWN_KEY]])).toEqual(
        entriesOf(current).map((entry) => [entry['hash'], UNKNOWN_VALUE]),
      );
    },
  );
});
