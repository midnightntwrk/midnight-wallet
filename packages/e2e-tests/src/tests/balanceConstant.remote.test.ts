// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { exit } from 'node:process';
import * as allure from 'allure-js-commons';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { inspect } from 'node:util';

/**
 * Tests checking balance is constant
 *
 * @group devnet
 * @group testnet
 */

describe('Balance constant', () => {
  if (process.env['SEED_STABLE'] === undefined) {
    logger.info('SEED_STABLE not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
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
  const filename = `stable-${seed.substring(seed.length - 7)}-${TestContainersFixture.network}.state`;
  const syncTimeout = TestContainersFixture.network === 'testnet' ? 3_000_000 : 1_800_000;
  const shieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seed));

  let walletFacade: WalletFacade;

  beforeEach(async () => {
    const fixture = getFixture();

    walletFacade = utils.buildWalletFacade(seed, fixture);
    await walletFacade.start(shieldedSecretKey, dustSecretKey);
  }, syncTimeout);

  afterEach(async () => {
    await utils.saveState(walletFacade, filename);
    await utils.closeWallet(walletFacade);
  });

  test(
    'Balance is constant when syncing from 0 @healthcheck',
    async () => {
      allure.tag('healthcheck');
      allure.tms('PM-13614', 'PM-13614');
      allure.epic('Headless wallet');
      allure.feature('Balance');
      allure.story('Balance constant when syncing from 0');

      const syncedState = await utils.waitForSyncFacade(walletFacade);
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
      allure.tag('healthcheck');
      allure.tms('PM-13615', 'PM-13615');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Balance constant');

      const syncedState = await utils.waitForSyncFacade(walletFacade);
      expect(syncedState.shielded.balances[shieldedTokenRaw]).toBe(expectedDustBalance);
      expect(syncedState.shielded.balances[nativeTokenHash]).toBe(expectedTokenOneBalance);
      expect(syncedState.shielded.balances[nativeTokenHash2]).toBe(expectedTokenTwoBalance);
      expect(syncedState.unshielded.balances[unshieldedTokenRaw]).toBe(expectedUnshieldedBalance);
      expect(syncedState.shielded.availableCoins.length).toBeGreaterThanOrEqual(3);
      expect(syncedState.shielded.pendingCoins.length).toBe(0);
      expect(syncedState.shielded.totalCoins.length).toBeGreaterThanOrEqual(3);
    },
    syncTimeout,
  );
});
