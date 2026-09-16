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
import { Serialization as DustSerialization } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { Serialization as ShieldedSerialization } from '@midnightntwrk/wallet-sdk-shielded/v1';
import { Serialization as UnshieldedSerialization } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { fixturesFor, type Fixture } from './fixtures.js';

/** Restore a snapshot with the current code, reporting why it would not restore rather than a bare `undefined`. */
const restore = <T>(fixture: Fixture, deserialize: (serialized: string) => Either.Either<T, unknown>): T => {
  const result = deserialize(fixture.serialized);
  if (Either.isLeft(result)) {
    throw new Error(`${fixture.id} did not restore: ${String(result.left)}`);
  }
  return result.right;
};

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

describe('shielded snapshots written by published releases', () => {
  const fixtures = fixturesFor('shielded');
  const capability = ShieldedSerialization.makeDefaultV1SerializationCapability();
  const restoreOne = (fixture: Fixture) => restore(fixture, (s) => capability.deserialize(null, s));

  it('should have fixtures to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should restore onto the network it was written for', () => {
      expectRecorded(fixture, 'networkId', () => restoreOne(fixture).networkId);
    });

    // 1.0.0 embedded the transaction history inside the snapshot. The field was later dropped from the schema, and
    // because Effect Schema ignores keys it does not know, those snapshots restored without complaint and lost the
    // history on the next write. It is carried through untouched now, and never invented for a snapshot without one.
    it('should carry through exactly the embedded transaction history it was written with', () => {
      expectRecorded(fixture, 'embeddedTxHistoryCount', () => (restoreOne(fixture).legacyTxHistory ?? []).length);
    });

    it('should survive a round trip through the current writer', () => {
      const rewritten = capability.serialize(restoreOne(fixture));

      const reread = capability.serialize(
        restore({ ...fixture, serialized: rewritten }, (s) => capability.deserialize(null, s)),
      );

      expect(reread).toEqual(rewritten);
    });
  });
});

describe('unshielded snapshots written by published releases', () => {
  const fixtures = fixturesFor('unshielded');
  const capability = UnshieldedSerialization.makeDefaultV1SerializationCapability();
  const restoreOne = (fixture: Fixture) => restore(fixture, (s) => capability.deserialize(s));

  it('should have fixtures to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should restore onto the network it was written for', () => {
      expectRecorded(fixture, 'networkId', () => restoreOne(fixture).networkId);
    });

    it('should restore the address and sync point it was written with', () => {
      expectRecorded(fixture, 'address', () => restoreOne(fixture).publicKey.address);
      expectRecorded(fixture, 'appliedId', () => String(restoreOne(fixture).progress.appliedId));
    });

    it('should survive a round trip through the current writer', () => {
      const rewritten = capability.serialize(restoreOne(fixture));

      const reread = capability.serialize(
        restore({ ...fixture, serialized: rewritten }, (s) => capability.deserialize(s)),
      );

      expect(reread).toEqual(rewritten);
    });
  });
});

describe('dust snapshots written by published releases', () => {
  const fixtures = fixturesFor('dust');
  const capability = DustSerialization.makeDefaultV1SerializationCapability();
  const restoreOne = (fixture: Fixture) => restore(fixture, (s) => capability.deserialize(null, s));

  it('should have fixtures to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    it('should restore onto the network and public key it was written with', () => {
      expectRecorded(fixture, 'networkId', () => restoreOne(fixture).networkId);
      expectRecorded(fixture, 'publicKey', () => String(restoreOne(fixture).publicKey.publicKey));
    });

    it('should survive a round trip through the current writer', () => {
      const rewritten = capability.serialize(restoreOne(fixture));

      const reread = capability.serialize(
        restore({ ...fixture, serialized: rewritten }, (s) => capability.deserialize(null, s)),
      );

      expect(reread).toEqual(rewritten);
    });
  });
});
