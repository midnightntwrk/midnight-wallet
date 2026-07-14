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
//
// Cross-version tx-history storage compatibility. The external tx-history storage was introduced
// at the T4 train (abstractions 2.1.0) with an entry schema that had no `lifecycle` field,
// required `protocolVersion`/`status`, and allowed `identifiers` to be absent. The current schema
// requires `lifecycle` AND `identifiers`, with no migration and no version envelope — so every
// payload written by the T4/T6 era is rejected wholesale. The fixtures exercise every field shape
// the era's app-level schema (the facade's WalletEntrySchema) allowed: all three statuses,
// fees value/null/absent, absent identifiers, and all three wallet sections.
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { WalletEntrySchema } from '@midnightntwrk/wallet-sdk-facade';
import { TX_HISTORY_TRAINS, loadFixture } from './fixtures.js';

const CurrentCommonSchema = TransactionHistoryStorage.TransactionHistoryEntryCommonSchema;

describe('tx-history storage compatibility', () => {
  // Positive control: the current storage can read what the current storage writes. If this fails,
  // the cross-version failures below prove nothing.
  it('restores tx history written by the current workspace code (control)', async () => {
    const storage = new InMemoryTransactionHistoryStorage(CurrentCommonSchema);
    await storage.gotFinalized({
      hash: 'ab'.repeat(32),
      identifiers: ['identifier-1'],
      protocolVersion: 1,
      status: 'SUCCESS',
      fees: 1234n,
      finalizedBlock: { hash: 'block-hash', height: 42, timestamp: new Date('2026-03-01T12:00:00.000Z') },
    });
    const serialized = await storage.serialize();

    const restored = InMemoryTransactionHistoryStorage.restore(serialized, CurrentCommonSchema);
    const entries = await restored.getAll();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.hash).toBe('ab'.repeat(32));
  });

  // The behaviour a persistence layer must have: reading its own prior output — through both the
  // storage-level common schema and the app-level facade schema (what production apps actually
  // pass). `it.fails` documents that today the pre-`lifecycle` payloads are rejected with a
  // ParseError. Remove `.fails` when a migration lands — these become its acceptance tests.
  describe.each(TX_HISTORY_TRAINS)('%s', (train) => {
    const fixture = loadFixture(train, 'tx-history');

    it.fails(
      `restores tx history written by ${fixture.name}@${fixture.version} via the current common schema (KNOWN BREAK)`,
      async () => {
        const restored = InMemoryTransactionHistoryStorage.restore(fixture.serialized, CurrentCommonSchema);
        const entries = await restored.getAll();

        expect(entries.map((e) => e.hash)).toEqual(fixture.expected['hashes']);
      },
    );

    it.fails(
      `restores tx history written by ${fixture.name}@${fixture.version} via the current facade WalletEntrySchema (KNOWN BREAK)`,
      async () => {
        const restored = InMemoryTransactionHistoryStorage.restore(fixture.serialized, WalletEntrySchema);
        const entries = await restored.getAll();

        expect(entries.map((e) => e.hash)).toEqual(fixture.expected['hashes']);
        expect(entries.map((e) => e.status)).toEqual(fixture.expected['statuses']);
      },
    );
  });

  // Characterisation of the defect, for precise reporting: the rejection is a hard throw caused by
  // the required `lifecycle` field the old format cannot have. A second axis exists independently:
  // entry 3 of the fixture legally omitted `identifiers`, which the current schema also requires.
  // DELETE this test when the migration lands — it asserts broken behaviour on purpose so the
  // break is visible in test output.
  it('currently rejects every pre-lifecycle payload with a ParseError naming `lifecycle` (characterisation)', () => {
    const fixture = loadFixture('t4-2026-04-23', 'tx-history');

    expect(() => InMemoryTransactionHistoryStorage.restore(fixture.serialized, CurrentCommonSchema)).toThrow(
      /lifecycle/,
    );
  });

  // Scoping: an EMPTY history payload is a bare `[]` in every era (same serializer output since
  // T4), and it decodes under the current schemas too — so the lifecycle break only affects users
  // who actually have persisted history entries. Empty-history wallets upgrade cleanly.
  it('restores an empty history payload from any era (scopes the break to non-empty histories)', async () => {
    // `[]` is byte-for-byte what every era's `serialize()` returns for an empty storage — the T4
    // fixture generator's storage.serialize() with no entries produces exactly this string.
    const emptyEraPayload = '[]';

    const viaCommon = InMemoryTransactionHistoryStorage.restore(emptyEraPayload, CurrentCommonSchema);
    const viaFacade = InMemoryTransactionHistoryStorage.restore(emptyEraPayload, WalletEntrySchema);

    expect(await viaCommon.getAll()).toHaveLength(0);
    expect(await viaFacade.getAll()).toHaveLength(0);
  });

  // Scoping: the wallet-specific sections (shielded/unshielded/dust) kept the SAME shape from T4
  // through current main — verified by dist-diff and pinned here with a current-code round trip.
  // A future `lifecycle` migration therefore only needs to synthesize `lifecycle`/`identifiers`;
  // sections carry over unchanged.
  it('round-trips wallet sections with the current facade schema (control pinning section shapes)', async () => {
    const storage = new InMemoryTransactionHistoryStorage(WalletEntrySchema);
    await storage.gotFinalized({
      hash: 'ab'.repeat(32),
      identifiers: ['identifier-1'],
      protocolVersion: 1,
      status: 'SUCCESS',
      shielded: {
        receivedCoins: [{ type: '11'.repeat(32), nonce: 'ab'.repeat(32), value: 100n, mtIndex: 0n }],
        spentCoins: [],
      },
      unshielded: {
        id: 7,
        createdUtxos: [
          {
            value: 1000n,
            owner: 'owner-address',
            tokenType: '33'.repeat(32),
            intentHash: '55'.repeat(32),
            outputIndex: 0,
          },
        ],
        spentUtxos: [],
      },
      dust: {
        receivedUtxos: [{ initialValue: 0n, nonce: 42n, seq: 0, backingNight: '66'.repeat(32), mtIndex: 0n }],
        spentUtxos: [],
      },
      finalizedBlock: { hash: 'block-hash', height: 42, timestamp: new Date('2026-03-01T12:00:00.000Z') },
    });

    const restored = InMemoryTransactionHistoryStorage.restore(await storage.serialize(), WalletEntrySchema);
    const entries = await restored.getAll();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.shielded?.receivedCoins[0]?.value).toBe(100n);
    expect(entries[0]?.unshielded?.createdUtxos[0]?.value).toBe(1000n);
    expect(entries[0]?.dust?.receivedUtxos[0]?.nonce).toBe(42n);
  });
});
