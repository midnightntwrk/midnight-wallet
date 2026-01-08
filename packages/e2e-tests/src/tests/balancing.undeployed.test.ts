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
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { randomBytes } from 'node:crypto';
import * as allure from 'allure-js-commons';
import { CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';
import { inspect } from 'node:util';

/**
 * Tests checking transaction balancing
 *
 * @group undeployed
 */

describe('Transaction balancing examples', () => {
  const getFixture = useTestContainersFixture();
  const senderSeed = randomBytes(32).toString('hex');
  const receiver1Seed = randomBytes(32).toString('hex');
  const fundedSeed = '0000000000000000000000000000000000000000000000000000000000000001';
  const timeout = 600_000;

  let funded: utils.WalletInit;
  let sender: utils.WalletInit;
  let receiver1: utils.WalletInit;
  let receiver2: utils.WalletInit;
  let receiver3: utils.WalletInit;
  let fixture: TestContainersFixture;
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;

  const output100 = 100_000_000n;
  const output50 = 50_000_000n;
  const output30 = 30_000_000n;
  const ttl = new Date(Date.now() + 30 * 60 * 1000);

  const unshieldedAmount = utils.tNightAmount(10000n);

  beforeAll(async () => {
    await allure.step('Distribute coins to sender', async function () {
      fixture = getFixture();
      funded = await utils.initWalletWithSeed(fundedSeed, fixture);

      const initialState = await utils.waitForSyncFacade(funded.wallet);
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialDustBalance = initialState.dust.walletBalance(new Date());
      logger.info(`Funded Wallet: ${initialDustBalance} tDUST`);
      logger.info(`Funded Wallet: ${initialShieldedBalance} shielded tokens`);
      logger.info(`Funded Wallet available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info('Available shielded coins:');
      logger.info(inspect(initialState.shielded.availableCoins, { depth: null }));

      sender = await utils.initWalletWithSeed(senderSeed, fixture);
      const senderInitialstate = await utils.waitForSyncFacade(sender.wallet);
      const shieldedWalletAddress = utils.getShieldedAddress(
        NetworkId.NetworkId.Undeployed,
        senderInitialstate.shielded.address,
      );
      const unshieldedWalletAddress = utils.getUnshieldedAddress(
        NetworkId.NetworkId.Undeployed,
        senderInitialstate.unshielded.address,
      );
      const senderInitialAvailableUnshieldedCoins = senderInitialstate.unshielded.availableCoins.length;

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: output100,
              receiverAddress: shieldedWalletAddress,
            },
            {
              type: shieldedTokenRaw,
              amount: output50,
              receiverAddress: shieldedWalletAddress,
            },
            {
              type: shieldedTokenRaw,
              amount: output30,
              receiverAddress: shieldedWalletAddress,
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              amount: unshieldedAmount,
              receiverAddress: unshieldedWalletAddress,
              type: unshieldedTokenRaw,
            },
          ],
        },
      ];

      const txToProve = await funded.wallet.transferTransaction(
        funded.shieldedSecretKeys,
        funded.dustSecretKey,
        outputsToCreate,
        ttl,
      );
      const signedTx = await funded.wallet.signTransaction(txToProve.transaction, (payload) =>
        funded.unshieldedKeystore.signData(payload),
      );
      const provenTx = await funded.wallet.finalizeTransaction({ ...txToProve, transaction: signedTx });
      const id = await funded.wallet.submitTransaction(provenTx);
      logger.info('Transaction id: ' + id);
      await utils.waitForFacadePendingClear(funded.wallet);
      const finalState = await utils.waitForSyncFacade(funded.wallet);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(
        initialShieldedBalance - output100 - output50 - output30,
      );
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      const state = await utils.waitForUnshieldedCoinUpdate(sender.wallet, senderInitialAvailableUnshieldedCoins);

      const nightUtxos = state.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === false,
      );
      logger.info(`utxo length: ${nightUtxos.length}`);
      logger.info(nightUtxos);
      const dustRegistrationRecipe = await sender.wallet.registerNightUtxosForDustGeneration(
        nightUtxos,
        sender.unshieldedKeystore.getPublicKey(),
        (payload) => sender.unshieldedKeystore.signData(payload),
      );
      logger.info('Dust registration recipe:');
      logger.info(dustRegistrationRecipe.transaction.toString());
      const finalizedDustTx = await sender.wallet.finalizeTransaction(dustRegistrationRecipe);
      logger.info(finalizedDustTx.toString());
      logger.info('Submitting dust registration transaction');
      const dustRegistrationTxid = await sender.wallet.submitTransaction(finalizedDustTx);
      logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);

      await utils.waitForStateAfterDustRegistration(sender.wallet, finalizedDustTx);
    });
  }, timeout);

  afterAll(async () => {
    await funded.wallet.stop();
    await sender.wallet.stop();
  }, timeout);

  test(
    'shielded transfer uses lowest coin first',
    async () => {
      allure.tms('PM-13746', 'PM-13746');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('tDUST transfer which uses the second lowest coin');

      const output35 = 35_000_000n;
      const receiver1Seed = randomBytes(32).toString('hex');

      receiver1 = await utils.initWalletWithSeed(receiver1Seed, fixture);

      const initialState = await utils.waitForSyncFacade(sender.wallet);
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialDustBalance = initialState.dust.walletBalance(new Date(Date.now() + 60 * 60 * 1000));
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(initialState.shielded.availableCoins);

      const initialState2 = await utils.waitForSyncFacade(receiver1.wallet);
      const initialDustBalance2 = initialState2.dust.walletBalance(new Date());
      logger.info(`Wallet 2: ${initialDustBalance2} tDUST`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: output35,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await sender.wallet.transferTransaction(
        sender.shieldedSecretKeys,
        sender.dustSecretKey,
        outputsToCreate,
        ttl,
      );
      const provenTx = await sender.wallet.finalizeTransaction(txToProve);
      const txId = await sender.wallet.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(sender.wallet);
      logger.info(`Wallet 1 available coins: ${pendingState.shielded.availableCoins.length}`);
      expect(pendingState.shielded.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.shielded.pendingCoins.length).toBeLessThanOrEqual(2);

      await utils.waitForFacadePendingClear(sender.wallet);
      const finalState = await utils.waitForSyncFacade(sender.wallet);
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(finalState.shielded.availableCoins);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialShieldedBalance - output35);
      expect(finalState.shielded.availableCoins.length).toBe(2); // Lowest available coin used up in transfer
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.availableCoins.length).toBe(2); // Second lowest coin (20M) is now lowest
      expect(finalState.shielded.totalCoins.length).toBe(2);
      // Top coin is untouched
      expect(finalState.shielded.availableCoins.filter((c) => c.coin.value === 45000000n).length).toBe(1);

      const finalState2 = await utils.waitForSyncFacade(receiver1.wallet);
      logger.info(`Wallet 2 available coins: ${finalState2.shielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(finalState2.shielded.availableCoins);
      expect(finalState2.shielded.balances[shieldedTokenRaw]).toBe(output35);

      await receiver1.wallet.stop();
    },
    timeout,
  );

  test(
    'shielded token transfer with lowest native coin',
    async () => {
      allure.tms('PM-13747', 'PM-13747');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('Native token transfer which uses the lowest coin');

      const output = 1n;

      receiver1 = await utils.initWalletWithSeed(receiver1Seed, fixture);

      const initialState = await utils.waitForSyncFacade(sender.wallet);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw];
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(initialState.shielded.availableCoins);

      const initialState2 = await utils.waitForSyncFacade(receiver1.wallet);
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw];
      logger.info(`Wallet 2: ${initialBalance2} shielded tokens`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: output,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await sender.wallet.transferTransaction(
        sender.shieldedSecretKeys,
        sender.dustSecretKey,
        outputsToCreate,
        ttl,
      );
      const provenTx = await sender.wallet.finalizeTransaction(txToProve);
      const txId = await sender.wallet.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(sender.wallet);
      // logger.info(utils.walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.shielded.availableCoins.length}`);
      expect(pendingState.shielded.balances[shieldedTokenRaw]).toBeLessThan(initialBalance);
      expect(pendingState.shielded.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.shielded.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);

      await utils.waitForFacadePendingClear(sender.wallet);
      const finalState = await utils.waitForSyncFacade(sender.wallet);
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1 shielded tokens: ${finalState.shielded.balances[shieldedTokenRaw]}`);
      logger.info(finalState.shielded.availableCoins);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialBalance - output);
      expect(finalState.shielded.availableCoins.length).toBe(initialState.shielded.availableCoins.length);
      expect(finalState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);
      // Top coin is untouched
      expect(finalState.shielded.availableCoins.filter((c) => c.coin.value === 100_000_000n).length).toBe(1);

      const finalState2 = await utils.waitForSyncFacade(receiver1.wallet);
      logger.info(`Wallet 2: ${finalState2.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      expect(finalState2.shielded.balances[shieldedTokenRaw]).toBe(output);
      await receiver1.wallet.stop();
    },
    timeout,
  );

  test(
    'Token transfer involving multiple token types and recipients in one transaction',
    async () => {
      allure.tms('PM-13748', 'PM-13748');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('Multiple token types and recipients in one tx');

      const nativeTokenOutput = 1n;

      const receiver1Seed = randomBytes(32).toString('hex');
      const receiver2Seed = randomBytes(32).toString('hex');
      const receiver3Seed = randomBytes(32).toString('hex');

      receiver1 = await utils.initWalletWithSeed(receiver1Seed, fixture);
      receiver2 = await utils.initWalletWithSeed(receiver2Seed, fixture);
      receiver3 = await utils.initWalletWithSeed(receiver3Seed, fixture);

      const initialState = await utils.waitForSyncFacade(sender.wallet);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw];
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(initialState.shielded.availableCoins);

      const initialState2 = await utils.waitForSyncFacade(receiver1.wallet);
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw];
      logger.info(`Wallet 2: ${initialBalance2} shielded tokens`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

      const initialState3 = await utils.waitForSyncFacade(receiver2.wallet);
      const initialBalance3 = initialState3.shielded.balances[shieldedTokenRaw];
      logger.info(`Wallet 3: ${initialBalance3} shielded tokens`);
      logger.info(`Wallet 3 available coins: ${initialState3.shielded.availableCoins.length}`);

      const initialState4 = await utils.waitForSyncFacade(receiver3.wallet);
      const initialBalance4 = initialState4.shielded.balances[shieldedTokenRaw];
      logger.info(`Wallet 4: ${initialBalance4} shielded tokens`);
      logger.info(`Wallet 4 available coins: ${initialState4.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: nativeTokenOutput,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
            {
              type: shieldedTokenRaw,
              amount: nativeTokenOutput,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState3.shielded.address),
            },
            {
              type: shieldedTokenRaw,
              amount: nativeTokenOutput,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState4.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await sender.wallet.transferTransaction(
        sender.shieldedSecretKeys,
        sender.dustSecretKey,
        outputsToCreate,
        ttl,
      );
      const provenTx = await sender.wallet.finalizeTransaction(txToProve);
      const txId = await sender.wallet.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(sender.wallet);
      logger.info(`Wallet 1 available coins: ${pendingState.shielded.availableCoins.length}`);
      expect(pendingState.shielded.balances[shieldedTokenRaw]).toBeLessThan(initialBalance);
      expect(pendingState.shielded.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.shielded.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);

      await utils.waitForFacadePendingClear(sender.wallet);
      const finalState = await utils.waitForSyncFacade(sender.wallet);
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(finalState.shielded.availableCoins);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialBalance - nativeTokenOutput * 3n);
      expect(finalState.shielded.availableCoins.length).toBe(initialState.shielded.availableCoins.length);
      expect(finalState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);
      // Top coin is untouched
      expect(finalState.shielded.availableCoins.filter((c) => c.coin.value === 100_000_000n).length).toBe(1);

      const finalState2 = await utils.waitForSyncFacade(receiver1.wallet);
      logger.info(`Wallet 2 available coins: ${finalState2.shielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(finalState2.shielded.availableCoins);
      expect(finalState2.shielded.balances[shieldedTokenRaw]).toBe(nativeTokenOutput);

      const finalState3 = await utils.waitForSyncFacade(receiver2.wallet);
      logger.info(`Wallet 3 available coins: ${finalState3.shielded.availableCoins.length}`);
      logger.info(`Wallet 3: ${finalState3.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(finalState3.shielded.availableCoins);
      expect(finalState3.shielded.balances[shieldedTokenRaw]).toBe(nativeTokenOutput);
      const finalState4 = await utils.waitForSyncFacade(receiver3.wallet);

      logger.info(`Wallet 4 available coins: ${finalState4.shielded.availableCoins.length}`);
      logger.info(`Wallet 4: ${finalState4.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(finalState4.shielded.availableCoins);
      expect(finalState4.shielded.balances[shieldedTokenRaw]).toBe(nativeTokenOutput);

      await receiver1.wallet.stop();
      await receiver2.wallet.stop();
      await receiver3.wallet.stop();
    },
    timeout,
  );

  test(
    'Should error when trying to make transaction with wallet containing no Dust',
    async () => {
      // allure.tms('PM-13746', 'PM-13746');
      // allure.epic('Headless wallet');
      // allure.feature('Transaction balancing');
      // allure.story('tDUST transfer which uses the second lowest coin');

      const output10 = 10_000_000n;
      receiver1 = await utils.initWalletWithSeed(receiver1Seed, fixture);
      const initialState = await utils.waitForSyncFacade(receiver1.wallet);
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet receiver1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(`Wallet receiver1 dust coins: ${initialState.dust.walletBalance(new Date())}`);
      logger.info(`Wallet receiver1 available shielded tokens: ${initialState.shielded.balances[shieldedTokenRaw]}`);
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: output10,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState.shielded.address),
            },
          ],
        },
      ];
      await expect(
        receiver1.wallet.transferTransaction(sender.shieldedSecretKeys, sender.dustSecretKey, outputsToCreate, ttl),
      ).rejects.toThrow('Insufficient funds');
      await receiver1.wallet.stop();
    },
    timeout,
  );
});
