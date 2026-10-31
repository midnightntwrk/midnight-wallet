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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fsAsync from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as rx from 'rxjs';
import type { WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import type { DustSnapshotModel } from '../dust-sync.js';
import { readSnapshot, saveState, type SnapshotSource, startRestoredFacade } from '../snapshot.js';

/**
 * Simulates a process killed while a snapshot file is being written: the file is left holding the first half of what
 * was meant to go into it, and the write never completes.
 */
const fault = vi.hoisted(() => ({ killMidWrite: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      const [file, data, options] = args;
      if (fault.killMidWrite && typeof data === 'string') {
        await actual.writeFile(file, data.slice(0, Math.floor(data.length / 2)), options);
        throw new Error('killed mid-write');
      }
      return actual.writeFile(...args);
    },
  };
});

const filename = 'abc1234-undeployed.state';

/** A wallet whose sub-wallets serialize to `${label}-shielded` and `${label}-dust`, unless overridden. */
const walletSerializingTo = (
  label: string,
  overrides: Partial<Record<'shielded' | 'dust', () => Promise<string>>> = {},
  dustSyncModel: DustSnapshotModel = 'events',
): SnapshotSource => ({
  wallet: {
    shielded: { serializeState: overrides.shielded ?? (() => Promise.resolve(`${label}-shielded`)) },
    dust: { serializeState: overrides.dust ?? (() => Promise.resolve(`${label}-dust`)) },
  },
  dustSyncModel,
});

const snapshotOf = (label: string) => ({
  shielded: `${label}-shielded`,
  dust: `${label}-dust`,
});

describe('saveState', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'testkit-snapshot-'));
  });

  afterEach(async () => {
    fault.killMidWrite = false;
    await fsAsync.rm(directory, { recursive: true, force: true });
  });

  it('should read back exactly what it saved', async () => {
    await saveState(walletSerializingTo('first'), directory, filename);

    await expect(readSnapshot(directory, filename, 'events')).resolves.toEqual(snapshotOf('first'));
  });

  it('should not save the unshielded wallet, which a restore rebuilds from its public key rather than reading', async () => {
    const unshieldedSerialized = vi.fn(() => Promise.reject(new Error('unshielded state is not part of a snapshot')));
    const wallet = walletSerializingTo('first');
    const withUnshielded = {
      ...wallet,
      wallet: { ...wallet.wallet, unshielded: { serializeState: unshieldedSerialized } },
    };

    await saveState(withUnshielded, directory, filename);

    expect(unshieldedSerialized).not.toHaveBeenCalled();
    await expect(readSnapshot(directory, filename, 'events')).resolves.toEqual(snapshotOf('first'));
  });

  it('should keep each dust sync model’s snapshot apart, so a model switch builds from scratch', async () => {
    await saveState(walletSerializingTo('first', {}, 'events'), directory, filename);

    await expect(readSnapshot(directory, filename, 'projections')).resolves.toBeUndefined();
  });

  it('should reject when the snapshot cannot be written, so a test does not pass on a cache it never saved', async () => {
    const notADirectory = path.join(directory, 'a-file');
    await fsAsync.writeFile(notADirectory, '', 'utf-8');

    await expect(saveState(walletSerializingTo('first'), notADirectory, filename)).rejects.toThrow();
  });

  it('should reject when a wallet cannot be serialized, leaving the previous snapshot as it was', async () => {
    await saveState(walletSerializingTo('first'), directory, filename);

    const failingDust = walletSerializingTo('second', { dust: () => Promise.reject(new Error('dust unavailable')) });
    await expect(saveState(failingDust, directory, filename)).rejects.toThrow('dust unavailable');

    await expect(readSnapshot(directory, filename, 'events')).resolves.toEqual(snapshotOf('first'));
  });

  it('should leave the previous snapshot whole when a save dies part-way through writing, because the next run restores it as one wallet', async () => {
    await saveState(walletSerializingTo('first'), directory, filename);

    fault.killMidWrite = true;
    await saveState(walletSerializingTo('second'), directory, filename).catch(() => undefined);
    fault.killMidWrite = false;

    await expect(readSnapshot(directory, filename, 'events')).resolves.toEqual(snapshotOf('first'));
  });
});

describe('startRestoredFacade', () => {
  const seeds: WalletSeeds = {
    shielded: new Uint8Array(32),
    unshielded: new Uint8Array(32),
    dust: new Uint8Array(32),
  };

  it('should stop the facade it started when the restored wallet’s progress cannot be read, so it does not keep syncing after the test', async () => {
    const stop = vi.fn(() => Promise.resolve());
    const facade = {
      start: () => Promise.resolve(),
      stop,
      state: () => rx.throwError(() => new Error('indexer unreachable')),
    };

    await expect(startRestoredFacade(facade, seeds, false)).rejects.toThrow('indexer unreachable');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('should stop the facade and fall back when the restored wallet never catches up, so a wedged restore cannot hold its test past teardown', async () => {
    const stop = vi.fn(() => Promise.resolve());
    const facade = {
      start: () => Promise.resolve(),
      stop,
      state: () => rx.NEVER,
    };

    await expect(startRestoredFacade(facade, seeds, false, { timeoutMs: 50 })).resolves.toBe(false);
    expect(stop).toHaveBeenCalledOnce();
  }, 5_000);
});
