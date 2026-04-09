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
import { Effect, Schema } from 'effect';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { type TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  makeDefaultTransactionHistoryService,
  makeSimulatorTransactionHistoryService,
  upsertShieldedEntry,
  ShieldedSectionSchema,
  type TransactionDetails,
} from '../TransactionHistory.js';

const isShieldedSection = Schema.is(ShieldedSectionSchema);

const txHash = 'abc123';

const makeCoin = (value: bigint, mtIndex: bigint): ledger.QualifiedShieldedCoinInfo => ({
  type: `token-${value}`,
  nonce: `nonce-${value}`,
  value,
  mt_index: mtIndex,
});

const makeChanges = (
  receivedCoins: ledger.QualifiedShieldedCoinInfo[],
  source: string = txHash,
): ledger.ZswapStateChanges =>
  ({
    source,
    receivedCoins,
    spentCoins: [],
  }) as unknown as ledger.ZswapStateChanges;

const makeMetadata = (hash: string = txHash, timestamp: number = Date.now()): TransactionDetails => ({
  hash,
  timestamp,
  status: 'SUCCESS',
});

const makeEntry = (coins: ledger.QualifiedShieldedCoinInfo[], hash: string = txHash) => ({
  hash,
  protocolVersion: 1,
  status: 'SUCCESS' as const,
  timestamp: new Date(),
  shielded: {
    receivedCoins: coins.map(({ mt_index, ...rest }) => ({ ...rest, mtIndex: mt_index })),
    spentCoins: [],
  },
});

type EntryWithHash = TransactionHistoryStorage.TransactionHistoryEntryWithHash;

type Latch = { wait: () => Promise<void> };

/**
 * A countdown latch that blocks N callers until all N have arrived, then releases them simultaneously.
 * This guarantees that all reads see the same storage snapshot before any write can proceed.
 *
 * This allows us to test the race condition where a read sees the same storage snapshot before a write.
 */
const makeLatch = (count: number): Latch => {
  const waiters: Array<() => void> = [];
  return {
    wait: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
        if (waiters.length === count) {
          waiters.forEach((r) => r());
        }
      }),
  };
};

/**
 * Creates in-memory storage, optionally with a latch on `get`.
 * When a latch is provided, all concurrent reads must arrive before any returns —
 * this deterministically reproduces the read-before-write interleaving that causes the race.
 */
const makeStorage = (
  latch?: Latch,
): {
  storage: TransactionHistoryStorage.TransactionHistoryStorage<EntryWithHash>;
  entries: Map<string, EntryWithHash>;
} => {
  const entries = new Map<string, EntryWithHash>();

  return {
    entries,
    storage: {
      get: async (hash) => {
        const snapshot = entries.get(hash);
        if (latch) {
          await latch.wait();
        }
        return snapshot;
      },
      upsert: (entry) => {
        const existing = entries.get(entry.hash);
        entries.set(entry.hash, existing ? { ...existing, ...entry } : entry);
        return Promise.resolve();
      },
      getAll: async function* () {
        for (const entry of entries.values()) {
          yield await Promise.resolve(entry);
        }
      },
      serialize: () => Promise.resolve(JSON.stringify([...entries.values()])),
    },
  };
};

const getShielded = (entries: Map<string, EntryWithHash>, hash: string = txHash) => {
  const section = entries.get(hash)?.['shielded'];
  return isShieldedSection(section) ? section : undefined;
};

describe('TransactionHistory race condition', () => {
  // Calls upsertShieldedEntry directly (bypassing service.put) to avoid the PartitionedSemaphore
  // that forces one write per hash. Combined with the latch-based storage, this deterministically
  // reproduces the read-before-write race to prove the data-loss scenario is real.
  // The service-level tests below then verify that the semaphore in put() prevents it.
  describe('upsertShieldedEntry (without semaphore)', () => {
    it('loses coins when concurrent puts race on the same hash', async () => {
      // The latch ensures both reads complete (seeing undefined) before either write starts.
      // This deterministically reproduces the interleaving that causes data loss.
      const { storage, entries } = makeStorage(makeLatch(2));

      const putA = upsertShieldedEntry(storage, makeEntry([makeCoin(100n, 1n)]));
      const putB = upsertShieldedEntry(storage, makeEntry([makeCoin(200n, 2n)]));

      await Effect.runPromise(Effect.all([putA, putB], { concurrency: 'unbounded' }));

      // Without sempaphore, the second write overwrites the first — one coin is lost
      expect(getShielded(entries)?.receivedCoins).toHaveLength(1);
    });
  });

  describe('makeDefaultTransactionHistoryService', () => {
    it('preserves all coins when concurrent puts target the same hash', async () => {
      const { storage, entries } = makeStorage();

      const service = makeDefaultTransactionHistoryService(
        {
          txHistoryStorage: storage,
          indexerClientConnection: { indexerHttpUrl: 'http://localhost' },
        },
        () => undefined,
      );

      const putA = service.put(makeChanges([makeCoin(100n, 1n)]), makeMetadata(), 1);
      const putB = service.put(makeChanges([makeCoin(200n, 2n)]), makeMetadata(), 1);

      await Effect.runPromise(Effect.all([putA, putB], { concurrency: 'unbounded' }));

      const shielded = getShielded(entries);
      expect(shielded?.receivedCoins).toHaveLength(2);
      expect(shielded?.receivedCoins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 100n, mtIndex: 1n }),
          expect.objectContaining({ value: 200n, mtIndex: 2n }),
        ]),
      );
    });

    it('allows concurrent puts for different hashes without blocking', async () => {
      const { storage, entries } = makeStorage();

      const service = makeDefaultTransactionHistoryService(
        {
          txHistoryStorage: storage,
          indexerClientConnection: { indexerHttpUrl: 'http://localhost' },
        },
        () => undefined,
      );

      const putA = service.put(makeChanges([makeCoin(100n, 1n)], 'hash-A'), makeMetadata('hash-A'), 1);
      const putB = service.put(makeChanges([makeCoin(200n, 2n)], 'hash-B'), makeMetadata('hash-B'), 1);

      await Effect.runPromise(Effect.all([putA, putB], { concurrency: 'unbounded' }));

      expect(getShielded(entries, 'hash-A')).toEqual(
        expect.objectContaining({
          receivedCoins: [expect.objectContaining({ value: 100n, mtIndex: 1n })],
        }),
      );
      expect(getShielded(entries, 'hash-B')).toEqual(
        expect.objectContaining({
          receivedCoins: [expect.objectContaining({ value: 200n, mtIndex: 2n })],
        }),
      );
    });
  });

  describe('makeSimulatorTransactionHistoryService', () => {
    it('preserves all coins when concurrent puts target the same hash', async () => {
      const { storage, entries } = makeStorage();

      const service = makeSimulatorTransactionHistoryService(
        {
          txHistoryStorage: storage,
          indexerClientConnection: { indexerHttpUrl: 'http://localhost' },
        },
        () => undefined,
      );

      const putA = service.put(makeChanges([makeCoin(100n, 1n)]), makeMetadata(), 1);
      const putB = service.put(makeChanges([makeCoin(200n, 2n)]), makeMetadata(), 1);

      await Effect.runPromise(Effect.all([putA, putB], { concurrency: 'unbounded' }));

      const shielded = getShielded(entries);
      expect(shielded?.receivedCoins).toHaveLength(2);
      expect(shielded?.receivedCoins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 100n, mtIndex: 1n }),
          expect.objectContaining({ value: 200n, mtIndex: 2n }),
        ]),
      );
    });

    it('allows concurrent puts for different hashes without blocking', async () => {
      const { storage, entries } = makeStorage();

      const service = makeSimulatorTransactionHistoryService(
        {
          txHistoryStorage: storage,
          indexerClientConnection: { indexerHttpUrl: 'http://localhost' },
        },
        () => undefined,
      );

      const putA = service.put(makeChanges([makeCoin(100n, 1n)], 'hash-A'), makeMetadata('hash-A'), 1);
      const putB = service.put(makeChanges([makeCoin(200n, 2n)], 'hash-B'), makeMetadata('hash-B'), 1);

      await Effect.runPromise(Effect.all([putA, putB], { concurrency: 'unbounded' }));

      expect(getShielded(entries, 'hash-A')).toEqual(
        expect.objectContaining({
          receivedCoins: [expect.objectContaining({ value: 100n, mtIndex: 1n })],
        }),
      );
      expect(getShielded(entries, 'hash-B')).toEqual(
        expect.objectContaining({
          receivedCoins: [expect.objectContaining({ value: 200n, mtIndex: 2n })],
        }),
      );
    });
  });
});
