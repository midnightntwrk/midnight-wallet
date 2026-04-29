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
import { useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { inspect } from 'util';

/** Tests using a funded wallet */

describe('Funded wallet', () => {
  const getFixture = useTestContainersFixture();
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const rawNativeTokenType = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 120_000;

  let funded: utils.WalletInit;

  beforeEach(async () => {
    const fixture = getFixture();
    funded = await utils.initWalletWithSeed(seedFunded, fixture);
  });

  afterEach(async () => {
    await funded.wallet.stop();
  });

  test(
    'Wallet balance for native token is 25B tDUST and there are two other token types',
    async () => {
      logger.info('Waiting for sync...');
      const state = await funded.wallet.waitForSyncedState();
      logger.info(`Wallet synced. Shielded balance: ${inspect(state.shielded.balances)}`);
      expect(state.shielded.totalCoins).toHaveLength(7);
      expect(state.shielded.balances[rawNativeTokenType]).toBe(250_000_000_000_000n);
      expect(state.shielded.balances['0000000000000000000000000000000000000000000000000000000000000001']).toBe(
        50000000000000n,
      );
      expect(state?.shielded.balances['0000000000000000000000000000000000000000000000000000000000000002']).toBe(
        50000000000000n,
      );
      expect(state.unshielded.totalCoins).toHaveLength(5);
      expect(state.unshielded.balances[unshieldedTokenRaw]).toBe(250_000_000_000_000n);
      expect(
        state.unshielded.balances['0000000000000000000000000000000000000000000000000000000000000002'],
      ).toBeUndefined();
      expect(state.dust.totalCoins).toHaveLength(5);
      expect(state.dust.balance(new Date())).toBe(1250000000000000000000000n);
    },
    timeout,
  );

  test(
    'funded wallet facade returns total coins',
    async () => {
      const state = await funded.wallet.waitForSyncedState();
      const shieldedCoins = state.shielded.totalCoins;
      expect(shieldedCoins).toHaveLength(7);
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.coin.nonce))).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.coin.type === 'string')).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.coin.value === 'bigint')).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.commitment === 'string')).toBeTruthy();
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.commitment))).toBeTruthy();
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.nullifier))).toBeTruthy();
      shieldedCoins
        .filter((c) => (c.coin.type = '02000000000000000000000000000000000000000000000000000000000000000000'))
        .forEach((coin) => {
          expect(coin.coin.nonce).toBeDefined();
          expect(coin.coin.type).toHaveLength(68);
          expect(coin.coin.value).toBe(50000000000000n);
        });

      const unshieldedCoins = state.unshielded.totalCoins;
      expect(unshieldedCoins).toHaveLength(5);
      expect(utils.isArrayUnique(unshieldedCoins.map((c) => c.utxo.intentHash))).toBeTruthy();
      unshieldedCoins.forEach((c) => {
        expect(c.utxo.value).toBe(50000000000000n);
        expect(c.utxo.outputNo).toBe(0);
        expect(typeof c.utxo.owner).toBe('string');
        expect(typeof c.utxo.type).toBe('string');
        expect(c.meta.registeredForDustGeneration).toBe(true);
      });

      const dustCoins = state.dust.totalCoins;
      expect(dustCoins).toHaveLength(5);
      expect(utils.isArrayUnique(dustCoins.map((c) => c.token.nonce))).toBeTruthy();
      expect(utils.isArrayUnique(dustCoins.map((c) => c.token.backingNight))).toBeTruthy();
      dustCoins.forEach((c) => {
        expect(c.token.initialValue).toBe(0n);
        expect(c.token.seq).toBe(0);
        expect(typeof c.token.owner).toBe('bigint');
        expect(typeof c.token.nonce).toBe('bigint');
        expect(typeof c.token.ctime).toBe('object');
      });
    },
    timeout,
  );
  test(
    'funded wallet facade eturns available coins',
    async () => {
      const state = await funded.wallet.waitForSyncedState();
      const shieldedCoins = state.shielded.availableCoins;
      expect(shieldedCoins).toHaveLength(7);
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.coin.nonce))).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.coin.type === 'string')).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.coin.value === 'bigint')).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.commitment === 'string')).toBeTruthy();
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.commitment))).toBeTruthy();
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.nullifier))).toBeTruthy();
      shieldedCoins
        .filter((c) => (c.coin.type = '02000000000000000000000000000000000000000000000000000000000000000000'))
        .forEach((coin) => {
          expect(coin.coin.nonce).toBeDefined();
          expect(coin.coin.type).toHaveLength(68);
          expect(coin.coin.value).toBe(50000000000000n);
        });

      const unshieldedCoins = state.unshielded.availableCoins;
      expect(unshieldedCoins).toHaveLength(5);
      expect(utils.isArrayUnique(unshieldedCoins.map((c) => c.utxo.intentHash))).toBeTruthy();
      unshieldedCoins.forEach((c) => {
        expect(c.utxo.value).toBe(50000000000000n);
        expect(c.utxo.outputNo).toBe(0);
        expect(typeof c.utxo.owner).toBe('string');
        expect(typeof c.utxo.type).toBe('string');
        expect(c.meta.registeredForDustGeneration).toBe(true);
      });

      const dustCoins = state.dust.availableCoins;
      expect(dustCoins).toHaveLength(5);
      expect(utils.isArrayUnique(dustCoins.map((c) => c.token.nonce))).toBeTruthy();
      expect(utils.isArrayUnique(dustCoins.map((c) => c.token.backingNight))).toBeTruthy();
      dustCoins.forEach((c) => {
        expect(c.token.initialValue).toBe(0n);
        expect(c.token.seq).toBe(0);
        expect(typeof c.token.owner).toBe('bigint');
        expect(typeof c.token.nonce).toBe('bigint');
        expect(typeof c.token.ctime).toBe('object');
      });
    },
    timeout,
  );

  test(
    'Wallet has no pending coins',
    async () => {
      const state = await funded.wallet.waitForSyncedState();
      expect(state.shielded.pendingCoins).toHaveLength(0);
      expect(state.unshielded.pendingCoins).toHaveLength(0);
      expect(state.dust.pendingCoins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Unshielded transaction history entries contain createdUtxos and spentUtxos',
    async () => {
      await funded.wallet.waitForSyncedState();
      const txHistory = await funded.wallet.getAllFromTxHistory();
      const unshieldedEntries = txHistory.filter((e) => e.unshielded !== undefined);
      expect(unshieldedEntries.length).toBeGreaterThan(0);
      unshieldedEntries.forEach((entry) => utils.expectValidUnshieldedTxHistoryEntry(entry));
      // At least one entry should have createdUtxos (from genesis funding)
      const entryWithCreated = unshieldedEntries.find((e) => e.unshielded!.createdUtxos.length > 0);
      expect(entryWithCreated).toBeDefined();
    },
    timeout,
  );

  test(
    'Shielded transaction history entries contain receivedCoins and spentCoins',
    async () => {
      await funded.wallet.waitForSyncedState();
      const txHistory = await funded.wallet.getAllFromTxHistory();
      const shieldedEntries = txHistory.filter((e) => e.shielded !== undefined);
      expect(shieldedEntries.length).toBeGreaterThan(0);
      shieldedEntries.forEach((entry) => utils.expectValidShieldedTxHistoryEntry(entry));
      // At least one entry should have receivedCoins (from genesis funding)
      const entryWithReceived = shieldedEntries.find((e) => e.shielded!.receivedCoins.length > 0);
      expect(entryWithReceived).toBeDefined();
    },
    timeout,
  );
});
