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
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  createWalletLifecycle,
  initWalletWithSeed,
  parseMidnightNetwork,
  provideWallet,
  saveState,
  useWalletTestEnvironment,
  type WalletInit,
  type WalletLifecycle,
  type WalletTestEnvironment,
} from '@midnightntwrk/wallet-sdk-testkit';
import { createTestContainersEnvironment } from '@midnightntwrk/wallet-sdk-testkit/testcontainers';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { exit } from 'node:process';
import { inspect } from 'node:util';
import * as fsAsync from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Tests checking balance is constant */

describe('Balance constant', () => {
  if (process.env['SEED_STABLE'] === undefined) {
    logger.info('SEED_STABLE not set');
    exit(1);
  }
  const getEnv = useWalletTestEnvironment(() =>
    createTestContainersEnvironment({ network: parseMidnightNetwork(process.env['NETWORK']) }),
  );
  const seed = process.env['SEED_STABLE'];
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const nativeTokenHash = '0000000000000000000000000000000000000000000000000000000000000001';
  const nativeTokenHash2 = '0000000000000000000000000000000000000000000000000000000000000002';
  const expectedShieldedBalance = utils.tNightAmount(10n);
  const expectedTokenOneBalance = utils.tNightAmount(25n);
  const expectedTokenTwoBalance = utils.tNightAmount(50n);
  const expectedUnshieldedBalance = utils.tNightAmount(10n);
  const expectedDustBalance = expectedShieldedBalance;
  const syncTimeout = 15 * 60 * 1000; // 15 minutes; a longer bound only converts a wedge into lane time

  let wallet: WalletInit;
  let env: WalletTestEnvironment;
  let lifecycle: WalletLifecycle;

  beforeEach(async () => {
    // This hook's own lifecycle, so a wallet that finishes starting after `afterEach` has run is stopped by it.
    const own = createWalletLifecycle();
    lifecycle = own;
    env = getEnv();

    wallet = await own.adopt(initWalletWithSeed(env, seed));
  }, syncTimeout);

  afterEach(async () => {
    // Nothing is carried between runs from here: the restore test saves to a directory of its own.
    await lifecycle.release({ persist: false });
  }, syncTimeout);

  test(
    'Balance is constant when syncing from 0 @healthcheck',
    async () => {
      const syncedState = await wallet.wallet.waitForSyncedState();
      logger.info(inspect(syncedState.shielded.availableCoins, { depth: null }));
      logger.info(inspect(syncedState.unshielded.availableCoins, { depth: null }));
      expect(syncedState.shielded.balances[shieldedTokenRaw]).toBe(expectedShieldedBalance);
      expect(syncedState.shielded.balances[nativeTokenHash]).toBe(expectedTokenOneBalance);
      expect(syncedState.shielded.balances[nativeTokenHash2]).toBe(expectedTokenTwoBalance);
      expect(syncedState.unshielded.balances[unshieldedTokenRaw]).toBe(expectedUnshieldedBalance);
      expect(syncedState.shielded.availableCoins.length).toBeGreaterThanOrEqual(3);
      expect(syncedState.shielded.pendingCoins.length).toBe(0);
      expect(syncedState.shielded.totalCoins.length).toBeGreaterThanOrEqual(3);
    },
    syncTimeout,
  );

  test(
    'Balance is constant when syncing from a restored state @healthcheck',
    async () => {
      // Deliberate save inside the test body: this test's subject is save-then-restore, and it only reaches this line
      // on the passing path. It is not the `afterEach` persistence that the poisoning guard exists for.
      //
      // The snapshot goes to a directory of this test's own rather than `SYNC_CACHE`: it is written and read within
      // the test, so it has no business in the cache carried between runs, and nothing it leaves there can be restored
      // by a later run in its place.
      const filename = `stable-${seed.substring(seed.length - 7)}-${env.network}.state`;
      const directoryPath = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'balance-constant-restore-'));
      try {
        // Synced first, so the snapshot holds the balances under test rather than a wallet that has seen nothing; a
        // restore of that would just be a sync from genesis, which the test above already covers.
        await wallet.wallet.waitForSyncedState();
        await saveState(wallet, directoryPath, filename);
        const restoredWallet = await provideWallet(env, { seed, syncCacheDir: directoryPath, filename });
        try {
          // `provideWallet` falls back to building from scratch when a restore fails, and a wallet built from scratch
          // reaches the same balances, so they alone cannot tell the two apart.
          expect(restoredWallet.restored).toBe(true);
          const syncedState = await restoredWallet.wallet.waitForSyncedState();

          expect(syncedState.shielded.balances[shieldedTokenRaw]).toBe(expectedDustBalance);
          expect(syncedState.shielded.balances[nativeTokenHash]).toBe(expectedTokenOneBalance);
          expect(syncedState.shielded.balances[nativeTokenHash2]).toBe(expectedTokenTwoBalance);
          expect(syncedState.unshielded.balances[unshieldedTokenRaw]).toBe(expectedUnshieldedBalance);
          expect(syncedState.shielded.availableCoins.length).toBeGreaterThanOrEqual(3);
          expect(syncedState.shielded.pendingCoins.length).toBe(0);
          expect(syncedState.shielded.totalCoins.length).toBeGreaterThanOrEqual(3);
        } finally {
          await restoredWallet.wallet.stop();
        }
      } finally {
        await fsAsync.rm(directoryPath, { recursive: true, force: true });
      }
    },
    syncTimeout,
  );
});
