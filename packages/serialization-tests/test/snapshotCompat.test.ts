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
import { Serialization as DustV1Serialization } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { Serialization as DustV2Serialization } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import { Serialization as ShieldedV1Serialization } from '@midnightntwrk/wallet-sdk-shielded/v1';
import { Serialization as ShieldedV2Serialization } from '@midnightntwrk/wallet-sdk-shielded/v2';
import { Serialization as UnshieldedV1Serialization } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { Serialization as UnshieldedV2Serialization } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { fixturesFor, isHandedTo, type Fixture, type Writer } from './fixtures.js';

/** Restore a snapshot with the current code, reporting why it would not restore rather than a bare `undefined`. */
const restore = <T>(fixture: Fixture, deserialize: (serialized: string) => Either.Either<T, unknown>): T => {
  const result = deserialize(fixture.serialized);
  if (Either.isLeft(result)) {
    throw new Error(`${fixture.id} did not restore: ${String(result.left)}`);
  }
  return result.right;
};

/**
 * One variant's reader and writer for a surface, closed over its own wallet type.
 *
 * Both variants read every frozen snapshot. The wallet layer routes a snapshot to the variant that owns its
 * `protocolVersion`, so in a build that registers both, these all land on V1 — but a build that registers only the V2
 * variant has only V2 to open them with. Each reader is therefore held to the same content assertions, and the helper
 * exists so that the two, whose wallet types differ, can sit in one list.
 */
const readerOf = <TWallet>(
  reader: string,
  writer: Writer,
  deserialize: (serialized: string) => Either.Either<TWallet, unknown>,
  serialize: (wallet: TWallet) => string,
) => ({
  reader,
  writer,
  restore: (fixture: Fixture): TWallet => restore(fixture, deserialize),
  /** The snapshot as this writer writes it back, and as it writes it a second time after reading its own output. */
  roundTrip: (fixture: Fixture): { readonly rewritten: string; readonly reread: string } => {
    const rewritten = serialize(restore(fixture, deserialize));
    const reread = serialize(restore({ ...fixture, serialized: rewritten }, deserialize));
    return { rewritten, reread };
  },
});

/**
 * Assert a value against the fixture's own record of what it should be, when the fixture records it.
 *
 * Fixture kinds describe different things — a deep shielded snapshot records a coin count, a receiver snapshot records
 * a balance — so a key absent from one is not a gap in that fixture, it is a key that kind does not carry. A key that
 * _is_ present is always asserted; this never quietly skips one that exists.
 */
const expectRecorded = (fixture: Fixture, key: string, actual: () => unknown): void => {
  if (!(key in fixture.expected)) return;
  expect({ [key]: actual() }).toEqual({ [key]: fixture.expected[key] });
};

const shieldedV1 = ShieldedV1Serialization.makeDefaultV1SerializationCapability();
const shieldedV2 = ShieldedV2Serialization.makeDefaultV2SerializationCapability();
const shieldedReaders = [
  readerOf(
    'V1',
    'v1',
    (s) => shieldedV1.deserialize(null, s),
    (w) => shieldedV1.serialize(w),
  ),
  readerOf(
    'V2',
    'v2',
    (s) => shieldedV2.deserialize(null, s),
    (w) => shieldedV2.serialize(w),
  ),
];

describe.each(shieldedReaders)('shielded snapshots written by published releases, read by $reader', (reader) => {
  // Only the payloads routing would hand this reader: see `isHandedTo`. Today that is all of them, because
  // every frozen payload was written below the fork.
  const fixtures = fixturesFor('shielded').filter((fixture) =>
    isHandedTo(reader.writer, 'shielded', fixture.serialized),
  );

  it('should have fixtures to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should restore onto the network it was written for', () => {
      expectRecorded(fixture, 'networkId', () => reader.restore(fixture).networkId);
    });

    // 1.0.0 embedded the transaction history inside the snapshot. The field was later dropped from the schema, and
    // because Effect Schema ignores keys it does not know, those snapshots restored without complaint and lost the
    // history on the next write. It is carried through untouched now, and never invented for a snapshot without one.
    it('should carry through exactly the embedded transaction history it was written with', () => {
      expectRecorded(fixture, 'embeddedTxHistoryCount', () => (reader.restore(fixture).legacyTxHistory ?? []).length);
    });

    it('should survive a round trip through the current writer', () => {
      const { rewritten, reread } = reader.roundTrip(fixture);

      expect(reread).toEqual(rewritten);
    });
  });
});

const unshieldedV1 = UnshieldedV1Serialization.makeDefaultV1SerializationCapability();
const unshieldedV2 = UnshieldedV2Serialization.makeDefaultV2SerializationCapability();
const unshieldedReaders = [
  readerOf(
    'V1',
    'v1',
    (s) => unshieldedV1.deserialize(s),
    (w) => unshieldedV1.serialize(w),
  ),
  readerOf(
    'V2',
    'v2',
    (s) => unshieldedV2.deserialize(s),
    (w) => unshieldedV2.serialize(w),
  ),
];

describe.each(unshieldedReaders)('unshielded snapshots written by published releases, read by $reader', (reader) => {
  // Only the payloads routing would hand this reader: see `isHandedTo`. Today that is all of them, because
  // every frozen payload was written below the fork.
  const fixtures = fixturesFor('unshielded').filter((fixture) =>
    isHandedTo(reader.writer, 'unshielded', fixture.serialized),
  );

  it('should have fixtures to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should restore onto the network it was written for', () => {
      expectRecorded(fixture, 'networkId', () => reader.restore(fixture).networkId);
    });

    it('should restore the address and sync point it was written with', () => {
      expectRecorded(fixture, 'address', () => reader.restore(fixture).publicKey.address);
      expectRecorded(fixture, 'appliedId', () => String(reader.restore(fixture).progress.appliedId));
    });

    it('should survive a round trip through the current writer', () => {
      const { rewritten, reread } = reader.roundTrip(fixture);

      expect(reread).toEqual(rewritten);
    });
  });
});

const dustV1 = DustV1Serialization.makeDefaultV1SerializationCapability();
const dustV2 = DustV2Serialization.makeDefaultV2SerializationCapability();
const dustReaders = [
  readerOf(
    'V1',
    'v1',
    (s) => dustV1.deserialize(null, s),
    (w) => dustV1.serialize(w),
  ),
  readerOf(
    'V2',
    'v2',
    (s) => dustV2.deserialize(null, s),
    (w) => dustV2.serialize(w),
  ),
];

describe.each(dustReaders)('dust snapshots written by published releases, read by $reader', (reader) => {
  // Only the payloads routing would hand this reader: see `isHandedTo`. Today that is all of them, because
  // every frozen payload was written below the fork.
  const fixtures = fixturesFor('dust').filter((fixture) => isHandedTo(reader.writer, 'dust', fixture.serialized));

  it('should have fixtures to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should restore onto the network and public key it was written with', () => {
      expectRecorded(fixture, 'networkId', () => reader.restore(fixture).networkId);
      expectRecorded(fixture, 'publicKey', () => String(reader.restore(fixture).publicKey.publicKey));
    });

    it('should survive a round trip through the current writer', () => {
      const { rewritten, reread } = reader.roundTrip(fixture);

      expect(reread).toEqual(rewritten);
    });
  });
});
