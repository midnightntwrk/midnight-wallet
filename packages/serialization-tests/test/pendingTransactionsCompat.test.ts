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
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { DefaultForkSchedule, finalizedTransactionTraits } from '@midnightntwrk/wallet-sdk-facade';
import { fixturesFor } from './fixtures.js';

/**
 * The registry the wallet itself reads pending transactions with, built from the fork schedule the facade presets.
 * Every fixture here was written before the v9 fork and carries no protocol-version stamp, so the registry's oldest
 * trait — ledger-v8's — is the one that reads it, exactly as it would for a stored payload an application hands back.
 * Building a one-epoch registry instead would route the bytes to ledger-v9, whose deserializer refuses them.
 */
const traits = finalizedTransactionTraits(DefaultForkSchedule.v9);

const fixtures = fixturesFor('pending-transactions');

/**
 * Pending transactions have carried a `{ version: 'v1', transactions }` envelope since the surface first shipped, and
 * its source is deliberately left alone. These tests freeze that: the envelope is the house pattern the other four
 * surfaces are being brought in line with, so it must not drift while they change around it.
 */
describe('pending transactions written by published releases', () => {
  it('should have a fixture to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    const restore = () => PendingTransactions.deserialize(fixture.serialized, traits);

    it('should still be stored under the v1 envelope', () => {
      const written: unknown = JSON.parse(fixture.serialized);

      expect(written).toMatchObject({ version: 'v1' });
    });

    it('should restore every transaction it was written with', () => {
      const result = restore();

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(PendingTransactions.all(result.right)).toHaveLength(fixture.expected['txCount'] as number);
      }
    });

    it('should restore transactions that still carry the identifiers they were written with', () => {
      const result = restore();

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        // Through the trait, not off the handle: a restored transaction is a version-stamped handle, and reading its
        // identifiers is exactly what the trait the payload was read with is for. The registry has one entry here, so
        // selecting the oldest supported version is the only trait there is to find.
        const trait = Option.getOrThrow(ProtocolVersion.select(traits, ProtocolVersion.MinSupportedVersion));
        const identifiers = PendingTransactions.all(result.right).map((tx) => [...trait.ids(tx)]);
        expect(identifiers).toEqual(fixture.expected['identifiers']);
      }
    });
  });
});
