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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { WalletEntrySchema, mergeWalletEntries } from '../src/index.js';

/**
 * A bare JSON array — no `version` envelope — whose entries carry no `lifecycle` field. The absence of `version` is
 * what marks a payload as the first format; there has never been a payload labelled `v1`.
 *
 * Captured from `@midnightntwrk/wallet-sdk-abstractions` 2.1.0, which is npm `latest` and shipped in facade 4.0.0,
 * 4.0.1 and 4.1.0, so this is the shape sitting in production storage today. Frozen: never edit the fixture.
 *
 * Every entry was written from the sync path, after the indexer returned the transaction inside a block; there was no
 * pending-entry writer at the time. So each one upgrades to the `finalized` lifecycle whatever its `status` — `status`
 * records what happened when the transaction ran, `lifecycle` records whether it reached a block.
 */
const noEnvelopeLifecycleMissing = readFileSync(
  fileURLToPath(new URL('./fixtures/abstractions-2.1.0-tx-history.json', import.meta.url)),
  'utf8',
);

const restoreLifecycleMissing = () =>
  EitherOps.getOrThrowLeft(
    InMemoryTransactionHistoryStorage.restore(noEnvelopeLifecycleMissing, WalletEntrySchema, mergeWalletEntries),
  );

describe('restoring a history with no version envelope, whose entries have no lifecycle', () => {
  it('should restore every entry, in the order it was written', async () => {
    const entries = await restoreLifecycleMissing().getAll();

    expect(entries.map((entry) => entry.hash)).toEqual([
      'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0',
      'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1',
      'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2',
    ]);
  });

  it('should give every entry a finalized lifecycle with no block, whatever its status', async () => {
    const entries = await restoreLifecycleMissing().getAll();

    expect(entries.map((entry) => entry.lifecycle)).toEqual([
      { status: 'finalized' },
      { status: 'finalized' },
      { status: 'finalized' },
    ]);
  });

  it('should preserve the on-chain status of every entry, including FAILURE', async () => {
    const entries = await restoreLifecycleMissing().getAll();

    expect(entries.map((entry) => entry.status)).toEqual(['SUCCESS', 'FAILURE', 'PARTIAL_SUCCESS']);
  });

  it('should default missing identifiers to the empty list and keep the ones that were written', async () => {
    const entries = await restoreLifecycleMissing().getAll();

    expect(entries.map((entry) => entry.identifiers)).toEqual([['identifier-1', 'identifier-2'], ['identifier-3'], []]);
  });

  it('should preserve the common scalar fields of every entry', async () => {
    const entries = await restoreLifecycleMissing().getAll();

    expect(entries.map((entry) => entry.protocolVersion)).toEqual([1, 1, 1]);
    expect(entries.map((entry) => entry.fees)).toEqual([1234n, null, undefined]);
    expect(entries.map((entry) => entry.timestamp)).toEqual([
      new Date('2026-03-01T12:00:00.000Z'),
      new Date('2026-03-01T12:00:00.000Z'),
      undefined,
    ]);
  });

  it('should preserve the shielded section of the first entry', async () => {
    const entry = await restoreLifecycleMissing().get(
      'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0',
    );

    expect(entry?.shielded).toEqual({
      receivedCoins: [
        {
          type: '1111111111111111111111111111111111111111111111111111111111111111',
          nonce: 'abababababababababababababababababababababababababababababababab',
          value: 100n,
          mtIndex: 0n,
        },
      ],
      spentCoins: [
        {
          type: '1111111111111111111111111111111111111111111111111111111111111111',
          nonce: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
          value: 250n,
          mtIndex: 1n,
        },
      ],
    });
    expect(entry?.unshielded).toBeUndefined();
    expect(entry?.dust).toBeUndefined();
  });

  it('should preserve the unshielded section of the second entry', async () => {
    const entry = await restoreLifecycleMissing().get(
      'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1',
    );

    expect(entry?.unshielded).toEqual({
      id: 7,
      createdUtxos: [
        {
          value: 1000n,
          owner: 'owner-address',
          tokenType: '3333333333333333333333333333333333333333333333333333333333333333',
          intentHash: '5555555555555555555555555555555555555555555555555555555555555555',
          outputIndex: 0,
        },
      ],
      spentUtxos: [],
    });
    expect(entry?.shielded).toBeUndefined();
    expect(entry?.dust).toBeUndefined();
  });

  it('should preserve the dust section of the third entry', async () => {
    const entry = await restoreLifecycleMissing().get(
      'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2',
    );

    expect(entry?.dust).toEqual({
      receivedUtxos: [
        {
          initialValue: 0n,
          nonce: 42n,
          seq: 0,
          backingNight: '6666666666666666666666666666666666666666666666666666666666666666',
          mtIndex: 0n,
        },
      ],
      spentUtxos: [],
    });
    expect(entry?.shielded).toBeUndefined();
    expect(entry?.unshielded).toBeUndefined();
  });
});

describe('writing the version envelope', () => {
  it('should write a v2 envelope after restoring a payload that had none', async () => {
    const serialized = await restoreLifecycleMissing().serialize();

    const written: unknown = JSON.parse(serialized);

    expect(written).toMatchObject({ version: 'v2' });
    expect((written as { entries: readonly unknown[] }).entries).toHaveLength(3);
  });

  it('should write a v2 envelope for a storage built by the writer methods', async () => {
    const storage = new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
    await storage.gotFinalized({
      hash: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
      identifiers: ['identifier-9'],
      finalizedBlock: { hash: 'block-hash', height: 12, timestamp: new Date('2026-04-01T00:00:00.000Z') },
    });

    const written: unknown = JSON.parse(await storage.serialize());

    expect(written).toMatchObject({ version: 'v2' });
    expect((written as { entries: readonly unknown[] }).entries).toHaveLength(1);
  });

  it('should read back its own v2 output with every entry unchanged', async () => {
    const before = await restoreLifecycleMissing().getAll();

    const roundTripped = await EitherOps.getOrThrowLeft(
      InMemoryTransactionHistoryStorage.restore(
        await restoreLifecycleMissing().serialize(),
        WalletEntrySchema,
        mergeWalletEntries,
      ),
    ).getAll();

    expect(roundTripped).toEqual(before);
  });
});

/**
 * The other half of the no-envelope case: a bare array whose entries **already** carry a `lifecycle`, block and all.
 *
 * A reader cannot tell this apart from the payload above — both lack `version`, so both take the same upgrade path.
 * That makes the upgrade's rule "fill in what is missing, never overwrite what is there", and this is what holds it to
 * it: an entry arriving with a real `finalizedBlock` must come back with that same block, not a synthesized lifecycle.
 * The same property is what makes the upgrade idempotent — safe to apply to a payload it has already touched, since the
 * second pass finds a lifecycle in place and leaves it there.
 */
const noEnvelopeLifecyclePresent = JSON.stringify([
  {
    hash: 'f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3',
    identifiers: ['identifier-4'],
    protocolVersion: 1,
    status: 'SUCCESS',
    lifecycle: {
      status: 'finalized',
      finalizedBlock: { hash: 'already-written-block', height: 99, timestamp: '2026-05-01T09:00:00.000Z' },
    },
  },
]);

describe('restoring a history with no version envelope, whose entries already have a lifecycle', () => {
  it('should leave that lifecycle exactly as written, block and all', async () => {
    const entries = await EitherOps.getOrThrowLeft(
      InMemoryTransactionHistoryStorage.restore(noEnvelopeLifecyclePresent, WalletEntrySchema, mergeWalletEntries),
    ).getAll();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.lifecycle).toEqual({
      status: 'finalized',
      finalizedBlock: { hash: 'already-written-block', height: 99, timestamp: new Date('2026-05-01T09:00:00.000Z') },
    });
  });
});

/**
 * A payload written by a newer SDK than this one. There is no downgrade path: a reader that does not know a version
 * cannot guess what changed in it, so the only honest answer is to refuse the payload and say which version it was.
 */
const writtenByANewerSdk = JSON.stringify({
  version: 'v3',
  entries: [{ hash: '0b0b0b0b', identifiers: [], lifecycle: { status: 'finalized' } }],
});

/** The error `restore` refused with. Fails the test if it returned a store instead of refusing the payload. */
const refusalFromRestoring = (serialized: string): unknown =>
  EitherOps.getOrThrowRight(
    InMemoryTransactionHistoryStorage.restore(serialized, WalletEntrySchema, mergeWalletEntries),
  );

describe('restoring a history whose version this build does not know', () => {
  it('should refuse the payload with a restore error naming the version it found', () => {
    expect(refusalFromRestoring(writtenByANewerSdk)).toMatchObject({
      _tag: 'TransactionHistoryRestoreError',
      detectedVersion: 'v3',
    });
  });
});
