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
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import {
  InMemoryTransactionHistoryStorage as PublishedStorage,
  TransactionHistoryStorage as PublishedTransactionHistoryStorage,
} from 'wallet-sdk-abstractions-2.1.0';
import { describe, expect, it } from 'vitest';
import { fixturesFor } from './fixtures.js';

/**
 * The compatibility promise runs one way, and this is the direction it does not run.
 *
 * Every format version shipped in a stable release loads in every later stable release — that is what the rest of this
 * package checks. The reverse is not promised and cannot be: the transaction history moved to `v2`, a shape whose
 * envelope the only stable release to have written this surface does not know, and no amount of care in this build can
 * teach a release that already shipped to read it.
 *
 * It matters because an application may downgrade. Once it has saved a history with a build that writes `v2`, going
 * back to `@midnightntwrk/wallet-sdk-abstractions` 2.1.0 — which is still npm `latest` — cannot open it. That is a
 * one-way door, and the useful thing to do with a one-way door is to know exactly where it is rather than discover it
 * in an incident.
 *
 * So the published release does the reading here, installed under an alias beside the workspace copy, rather than a
 * reconstruction of what it used to do. A reconstruction could only ever assert what this repo believes 2.1.0 did.
 */

/** The shape 2.1.0 defined for an entry — the schema that release would have been handed. */
const publishedSchema = PublishedTransactionHistoryStorage.TransactionHistoryCommonSchema;

/** A history written by this build, in the format it writes today. */
const writtenByThisBuild = async (): Promise<string> => {
  const storage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
  await storage.gotFinalized({
    hash: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    identifiers: ['identifier-1'],
    finalizedBlock: { hash: 'block-hash', height: 12, timestamp: new Date('2026-04-01T00:00:00.000Z') },
  });
  return storage.serialize();
};

describe('a transaction history written by this build, handed back to the release before it', () => {
  it('is written in the envelope that release never knew', async () => {
    expect(JSON.parse(await writtenByThisBuild())).toMatchObject({ version: 'v2' });
  });

  // Loud, not quiet. 2.1.0 read a bare array and would decode an object as zero entries if the shapes happened to
  // overlap; they do not, so it throws rather than opening an empty history. An application that downgrades finds
  // out immediately instead of believing its history was empty all along.
  it('cannot be read by 2.1.0, and fails rather than reading as an empty history', async () => {
    const written = await writtenByThisBuild();

    expect(() => PublishedStorage.restore(written, publishedSchema)).toThrow();
  });

  // The envelope is not the only thing in the way, which is worth knowing before anyone proposes unwrapping a `v2`
  // payload to hand it back to an older build. 2.1.0 required `protocolVersion` and `status` on every entry; both are
  // optional now, so an entry written today may simply not carry them. Stripping the envelope is therefore not a
  // downgrade path — the entries do not decode either.
  it('cannot be read by 2.1.0 even with the envelope stripped off', async () => {
    const { entries } = JSON.parse(await writtenByThisBuild()) as { entries: readonly Record<string, unknown>[] };

    expect(entries[0]).not.toHaveProperty('protocolVersion');
    expect(entries[0]).not.toHaveProperty('status');
    expect(() => PublishedStorage.restore(JSON.stringify(entries), publishedSchema)).toThrow();
  });
});

/**
 * The direction that is promised, stated beside the one that is not, so the asymmetry is legible in one place rather
 * than inferred from the absence of a test.
 */
describe('a transaction history written by 2.1.0, handed to this build', () => {
  const fixtures = fixturesFor('tx-history');

  it('should have a fixture written by that release', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.map((fixture) => fixture.writtenBy.version)).toContain('2.1.0');
  });

  it('opens, with every entry it was written with', async () => {
    const fixture = fixtures[0];
    if (fixture === undefined) throw new Error('no transaction-history fixture');

    const restored = EitherOps.getOrThrowLeft(
      InMemoryTransactionHistoryStorage.restore(fixture.serialized, WalletEntrySchema, mergeWalletEntries),
    );

    expect(await restored.getAll()).toHaveLength(fixture.expected['entryCount'] as number);
  });
});
