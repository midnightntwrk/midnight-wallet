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
import { Serialization as ShieldedV1Serialization } from '@midnightntwrk/wallet-sdk-shielded/v1';
import { Serialization as ShieldedV2Serialization } from '@midnightntwrk/wallet-sdk-shielded/v2';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { fixturesFor } from './fixtures.js';

/**
 * When two twins share one format version, neither's reader may silently drop what the other's writer puts in.
 *
 * Shielded and dust are both on `v1` from both variants, which is the right call while the shapes agree — but the V2
 * shielded writer emits one field the V1 schema has never heard of, `coinHashesPending`, and Effect Schema ignores keys
 * it does not know. So the V1 reader accepts a V2-written snapshot, discards that field, and writes it back without it.
 * That is precisely the mechanism that lost the embedded transaction history: restore succeeds, nothing fails, and the
 * data is gone on the next save.
 *
 * The wallet layer does not reach this: `Restore.ts` routes a snapshot to the variant that owns its `protocolVersion`,
 * and a snapshot carrying `coinHashesPending` was written by a V2 wallet past `forks.v9`, so V1 never sees it. The
 * unshielded surface is protected twice over, because its V2 writer declares `v2` and the V1 schema refuses that
 * literal outright.
 *
 * What does reach it is this package. `informationPreservation` and `valuePreservation` pair every writer with every
 * fixture, and their stated reason is one-directional — "a build that registers only the V2 variant still has to open
 * what a V1 wallet stored". The implementation runs the other direction too. It is harmless today only because every
 * frozen fixture was written by a V1-era release; the first ledger-v9 release whose fixtures are captured, which ADR
 * 0008 and the fixture generator's README both plan for, puts a V2-written shielded payload in front of the V1 reader
 * and turns this into a red gate that looks like data loss but is the harness asking a question routing says never
 * arises.
 */

const shieldedV1 = ShieldedV1Serialization.makeDefaultV1SerializationCapability();
const shieldedV2 = ShieldedV2Serialization.makeDefaultV2SerializationCapability();

/** Every key path in a payload, with array positions collapsed — the same notion the preservation gates use. */
const keyPaths = (value: unknown, prefix = ''): readonly string[] => {
  if (Array.isArray(value)) return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      return [path, ...keyPaths(child, path)];
    });
  }
  return [];
};

/**
 * A snapshot as the V2 shielded writer actually writes it when a crossing has left the coin hashes pending.
 *
 * Produced by the V2 writer rather than hand-assembled: a frozen payload is read by the V2 reader, marked the way
 * `fromPreviousVersion` marks a wallet mid-crossing, and written back out. What comes back is that writer's own output,
 * so the case cannot be accused of inventing a shape no release would produce.
 */
const v2WrittenWithPendingCoinHashes = (serialized: string): string => {
  const restored = shieldedV2.deserialize(null, serialized);
  if (Either.isLeft(restored)) throw new Error(`the V2 reader would not open the fixture: ${String(restored.left)}`);
  return shieldedV2.serialize({ ...restored.right, coinHashesPending: true });
};

describe('a V2-written shielded snapshot, read by the V1 twin', () => {
  const fixtures = fixturesFor('shielded');

  it('should have fixtures to work from', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it('is written by the V2 writer carrying the field only it knows', () => {
    const first = fixtures[0];
    if (first === undefined) throw new Error('no shielded fixture to write from');

    const written = v2WrittenWithPendingCoinHashes(first.serialized);

    expect(JSON.parse(written)).toMatchObject({ coinHashesPending: true });
  });

  // The claim. A reader that cannot represent a field must not accept the payload and drop it: it either refuses,
  // which is what the format promise says a reader does when it meets something it cannot read, or it carries the
  // field through untouched. Silently discarding it is the one outcome the persisted-format rules forbid outright.
  it.each(fixtures)('neither accepts nor discards what it cannot represent: $id', (fixture) => {
    const written = v2WrittenWithPendingCoinHashes(fixture.serialized);

    const read = shieldedV1.deserialize(null, written);

    if (Either.isLeft(read)) return; // Refusing is a correct answer.

    const before = keyPaths(JSON.parse(written));
    const after = keyPaths(JSON.parse(shieldedV1.serialize(read.right)));
    expect({ id: fixture.id, lost: before.filter((path) => !after.includes(path)) }).toEqual({
      id: fixture.id,
      lost: [],
    });
  });
});
