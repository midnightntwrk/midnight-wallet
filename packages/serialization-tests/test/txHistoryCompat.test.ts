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
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import { describe, expect, it } from 'vitest';
import { fixturesFor } from './fixtures.js';

const fixtures = fixturesFor('tx-history');

describe('transaction histories written by published releases', () => {
  it('should have a fixture to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    const restore = () =>
      InMemoryTransactionHistoryStorage.restore(fixture.serialized, WalletEntrySchema, mergeWalletEntries);

    it('should restore every entry it was written with, in order', async () => {
      const entries = await restore().getAll();

      expect(entries).toHaveLength(fixture.expected['entryCount'] as number);
      expect(entries.map((entry) => entry.hash)).toEqual(fixture.expected['hashes']);
    });

    it('should preserve the on-chain status of every entry', async () => {
      const entries = await restore().getAll();

      expect(entries.map((entry) => entry.status)).toEqual(fixture.expected['statuses']);
    });

    it('should preserve the fees of every entry', async () => {
      const entries = await restore().getAll();

      const asWritten = (fixture.expected['fees'] as readonly (string | null)[]).map((fee) =>
        fee === null ? null : BigInt(fee),
      );
      expect(entries.map((entry) => entry.fees ?? null)).toEqual(asWritten);
    });

    it('should keep the identifiers it has and default the ones it never had to empty', async () => {
      const entries = await restore().getAll();

      expect(entries.map((entry) => entry.identifiers.length > 0)).toEqual(fixture.expected['identifiersPresent']);
    });

    // Every entry in these payloads was written from the sync path, after the indexer returned the transaction inside
    // a block. `finalized` is therefore the only honest lifecycle, whatever the entry's `status` — a FAILURE reached a
    // block too, it just failed once it ran.
    it('should give every entry a finalized lifecycle, whatever its status', async () => {
      const entries = await restore().getAll();

      expect(entries.map((entry) => entry.lifecycle.status)).toEqual(entries.map(() => 'finalized'));
    });
  });
});
