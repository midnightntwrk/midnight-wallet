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
import { CombinedTokenTransfer, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';

/**
 * Tests checking transaction balancing
 *
 * @group undeployed
 */

describe('Transaction balancing examples', () => {
  const getFixture = useTestContainersFixture();
  const senderSeed = randomBytes(32).toString('hex');
  const fundedSeed = '0000000000000000000000000000000000000000000000000000000000000001';
  const fundedShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(fundedSeed));
  const senderShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(senderSeed));
  const fundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(fundedSeed));
  const senderDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(senderSeed));
  const timeout = 600_000;

  let fundedFacade: WalletFacade;
  let senderFacade: WalletFacade;
  let receiver1: WalletFacade;
  let receiver2: WalletFacade;
  let receiver3: WalletFacade;
  let fixture: TestContainersFixture;
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const nativeTokenRaw1 = '0000000000000000000000000000000000000000000000000000000000000001';
  const nativeTokenRaw2 = '0000000000000000000000000000000000000000000000000000000000000002';

  const output100 = 100_000_000n;
  const output50 = 50_000_000n;
  const output30 = 30_000_000n;

  beforeEach(async () => {
    await allure.step('Distribute coins to sender', async function () {
      fixture = getFixture();
      fundedFacade = utils.buildWalletFacade(fundedSeed, fixture);
      await fundedFacade.start(fundedShieldedSecretKey, fundedDustSecretKey);

      const initialState = await utils.waitForSyncFacade(fundedFacade);
      const sendTx = async (address: string): Promise<void> => {
        const initialBalance = initialState.shielded.balances[shieldedTokenRaw] ?? 0n;
        const initialBalanceNative = initialState.shielded.balances[nativeTokenRaw1] ?? 0n;
        const initialBalanceNative2 = initialState.shielded.balances[nativeTokenRaw2] ?? 0n;
        const initialDustBalance = initialState.dust.walletBalance(new Date());
        logger.info(`Funded Wallet: ${initialDustBalance} tDUST`);
        logger.info(`Funded Wallet: ${initialBalance} shielded tokens`);
        logger.info(`Funded Wallet: ${initialBalanceNative} native tokens 1`);
        logger.info(`Funded Wallet: ${initialBalanceNative2} native tokens 2`);
        logger.info(`Funded Wallet available coins: ${initialState.shielded.availableCoins.length}`);
        logger.info(
          `Sending ${output100 / 1_000_000n} shielded tokens ${shieldedTokenRaw}, ${output50 / 1_000_000n} ${nativeTokenRaw1} and ${
            output30 / 1_000_000n
          }, ${nativeTokenRaw2} to address: ${address}`,
        );

        const outputsToCreate: CombinedTokenTransfer[] = [
          {
            type: 'shielded',
            outputs: [
              {
                type: shieldedTokenRaw,
                amount: output100,
                receiverAddress: address,
              },
              {
                type: nativeTokenRaw1,
                amount: output50,
                receiverAddress: address,
              },
              {
                type: nativeTokenRaw2,
                amount: output30,
                receiverAddress: address,
              },
            ],
          },
        ];

        const txToProve = await fundedFacade.transferTransaction(
          fundedShieldedSecretKey,
          fundedDustSecretKey,
          outputsToCreate,
          new Date(Date.now() + 60 * 60 * 1000),
        );
        const provenTx = await fundedFacade.finalizeTransaction(txToProve);
        const id = await fundedFacade.submitTransaction(provenTx);
        logger.info('Transaction id: ' + id);

        await utils.waitForFacadePendingClear(fundedFacade);
        // await utils.waitForTxInHistory(String(id), fundedFacade.shielded);

        const finalState = await utils.waitForSyncFacade(fundedFacade);
        // logger.info(walletStateTrimmed(finalState));

        expect(finalState.shielded.balances[shieldedTokenRaw] ?? 0n).toBe(initialBalance - output100);
        expect(finalState.shielded.balances[nativeTokenRaw1] ?? 0n).toBe(initialBalanceNative - output50);
        expect(finalState.shielded.balances[nativeTokenRaw2] ?? 0n).toBe(initialBalanceNative2 - output30);
        expect(finalState.shielded.pendingCoins.length).toBe(0);
        // expect(finalState.shielded.transactionHistory.length).toBe(initialState.shielded.transactionHistory.length + 2);
        await utils.waitForFacadePendingClear(senderFacade);
      };
      senderFacade = utils.buildWalletFacade(senderSeed, fixture);
      await senderFacade.start(senderShieldedSecretKey, senderDustSecretKey);
      const state = await utils.waitForSyncFacade(senderFacade);
      const walletAddress = utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, state.shielded.address);
      await sendTx(walletAddress);
    });
  }, timeout);

  afterEach(async () => {
    await fundedFacade.stop();
    await senderFacade.stop();
  }, timeout);

  test(
    'tDUST transfer up to 2nd lowest native coin',
    async () => {
      allure.tms('PM-13746', 'PM-13746');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('tDUST transfer which uses the second lowest coin');

      const output35 = 35_000_000n;
      const receiver1Seed = randomBytes(32).toString('hex');
      const receiver1SecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(receiver1Seed));
      const receiver1DustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(receiver1Seed));

      receiver1 = utils.buildWalletFacade(receiver1Seed, fixture);
      await receiver1.start(receiver1SecretKey, receiver1DustSecretKey);

      const initialState = await utils.waitForSyncFacade(senderFacade);
      const initialDustBalance = initialState.dust.walletBalance(new Date(Date.now() + 60 * 60 * 1000));
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(initialState.shielded.availableCoins);

      const initialState2 = await utils.waitForSyncFacade(receiver1);
      const initialDustBalance2 = initialState2.dust.walletBalance(new Date());
      logger.info(`Wallet 2: ${initialDustBalance2} tDUST`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeTokenRaw1,
              amount: output35,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await senderFacade.transferTransaction(
        senderShieldedSecretKey,
        receiver1DustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 60 * 60 * 1000),
      );
      const provenTx = await senderFacade.finalizeTransaction(txToProve);
      const txId = await senderFacade.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForPending(senderFacade.shielded);
      // logger.info(utils.walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.totalCoins).toBe(initialState.shielded.totalCoins);
      // expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.shielded.transactionHistory.length);

      // await utils.waitForTxInHistory(String(txId), senderFacade.shielded);
      const finalState = await utils.waitForSyncFacade(senderFacade);
      // logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(finalState.shielded.availableCoins);
      expect(finalState.shielded.balances[shieldedTokenRaw] ?? 0n).toBe(144840380n);
      expect(finalState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length - 1,
      ); // Lowest available coin used up in transfer
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length - 1);
      // expect(finalState.nullifiers.length).toBe(initialState.nullifiers.length - 1);
      expect(finalState.shielded.transactionHistory.length).toBeGreaterThanOrEqual(
        initialState.shielded.transactionHistory.length + 1,
      );

      // await utils.waitForTxInHistory(String(txId), receiver1.shielded);
      const finalState2 = await utils.waitForSyncShielded(receiver1.shielded);
      // logger.info(utils.walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(finalState2.availableCoins);
      expect(finalState2.balances[shieldedTokenRaw] ?? 0n).toBe(output35);
      // validateWalletTxHistory(finalState2, initialState2);

      await utils.closeWallet(receiver1);
    },
    timeout,
  );

  test(
    'tDUST transfer with lowest native coin',
    async () => {
      allure.tms('PM-13747', 'PM-13747');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('Native token transfer which uses the lowest coin');

      const output = 1n;
      const receiver1Seed = randomBytes(32).toString('hex');
      const receiver1SecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(receiver1Seed));
      const receiver1DustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(receiver1Seed));

      receiver1 = utils.buildWalletFacade(receiver1Seed, fixture);
      await receiver1.start(receiver1SecretKey, receiver1DustSecretKey);

      const initialState = await utils.waitForSyncFacade(senderFacade);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(initialState.shielded.availableCoins);

      const initialState2 = await utils.waitForSyncFacade(receiver1);
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} shielded tokens`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeTokenRaw1,
              amount: output,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await senderFacade.transferTransaction(
        senderShieldedSecretKey,
        senderDustSecretKey,
        outputsToCreate,
        new Date(),
      );
      const provenTx = await senderFacade.finalizeTransaction(txToProve);
      const txId = await senderFacade.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForPending(senderFacade.shielded);
      // logger.info(utils.walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[shieldedTokenRaw] ?? 0n).toBeLessThan(initialBalance);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.totalCoins.length).toBe(initialState.shielded.totalCoins.length);
      // expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.shielded.transactionHistory.length);

      // await utils.waitForTxInHistory(String(txId), senderFacade.shielded);
      const finalState = await utils.waitForSyncFacade(senderFacade);
      // logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[nativeTokenRaw2]} NT2`);
      logger.info(finalState.shielded.availableCoins);
      expect(finalState.shielded.balances[shieldedTokenRaw] ?? 0n).toBeLessThan(initialBalance - output);
      expect(finalState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBeLessThanOrEqual(initialState.shielded.totalCoins.length);
      // expect(finalState.nullifiers.length).toBeLessThanOrEqual(initialState.nullifiers.length);
      expect(finalState.shielded.transactionHistory.length).toBeGreaterThanOrEqual(
        initialState.shielded.transactionHistory.length + 1,
      );

      // await utils.waitForTxInHistory(String(txId), receiver1.shielded);
      const finalState2 = await utils.waitForSyncShielded(receiver1.shielded);
      // logger.info(utils.walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(`Wallet 2: ${finalState2.balances[nativeTokenRaw2]} NT2`);
      logger.info(finalState2.availableCoins);
      expect(finalState2.balances[shieldedTokenRaw] ?? 0n).toBe(initialBalance2);
      expect(finalState2.balances[nativeTokenRaw2] ?? 0n).toBe(output);
      // validateWalletTxHistory(finalState2, initialState2);

      await utils.closeWallet(receiver1);
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

      const NativeTokenOutput = 1n;
      const output2 = 10_000_000n;
      const output3 = 3_000_000n;

      receiver1 = utils.buildWalletFacade(randomBytes(32).toString('hex'), fixture);
      receiver2 = utils.buildWalletFacade(randomBytes(32).toString('hex'), fixture);
      receiver3 = utils.buildWalletFacade(randomBytes(32).toString('hex'), fixture);

      const initialState = await utils.waitForSyncFacade(senderFacade);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(initialState.shielded.availableCoins);

      const initialState2 = await utils.waitForSyncFacade(receiver1);
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} shielded tokens`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

      const initialState3 = await utils.waitForSyncFacade(receiver2);
      const initialBalance3 = initialState3.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 3: ${initialBalance3} shielded tokens`);
      logger.info(`Wallet 3 available coins: ${initialState3.shielded.availableCoins.length}`);

      const initialState4 = await utils.waitForSyncFacade(receiver3);
      const initialBalance4 = initialState4.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 4: ${initialBalance4} shielded tokens`);
      logger.info(`Wallet 4 available coins: ${initialState4.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeTokenRaw2,
              amount: NativeTokenOutput,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
            {
              type: shieldedTokenRaw,
              amount: output2,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState3.shielded.address),
            },
            {
              type: shieldedTokenRaw,
              amount: output3,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState4.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await senderFacade.transferTransaction(
        senderShieldedSecretKey,
        senderDustSecretKey,
        outputsToCreate,
        new Date(),
      );
      const provenTx = await senderFacade.finalizeTransaction(txToProve);
      const txId = await senderFacade.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForPending(senderFacade.shielded);
      // logger.info(utils.walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[shieldedTokenRaw] ?? 0n).toBeLessThan(initialBalance);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.totalCoins.length).toBe(initialState.shielded.totalCoins.length);
      // expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.shielded.transactionHistory.length);

      // await utils.waitForTxInHistory(String(txId), senderFacade.shielded);
      const finalState = await utils.waitForSyncFacade(senderFacade);
      // logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[nativeTokenRaw2]} NT2`);
      logger.info(finalState.shielded.availableCoins);
      expect(finalState.shielded.balances[shieldedTokenRaw] ?? 0n).toBeLessThan(initialBalance - output2 - output3);
      expect(finalState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBeLessThanOrEqual(initialState.shielded.totalCoins.length);
      // expect(finalState.nullifiers.length).toBeLessThanOrEqual(initialState.nullifiers.length);
      expect(finalState.shielded.transactionHistory.length).toBeGreaterThanOrEqual(
        initialState.shielded.transactionHistory.length + 1,
      );

      // await utils.waitForTxInHistory(String(txId), receiver1.shielded);
      const finalState2 = await utils.waitForSyncFacade(receiver1);
      // logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.shielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(`Wallet 2: ${finalState2.shielded.balances[nativeTokenRaw2]} NT2`);
      logger.info(finalState2.shielded.availableCoins);
      expect(finalState2.shielded.balances[shieldedTokenRaw] ?? 0n).toBe(0n);
      expect(finalState2.shielded.balances[nativeTokenRaw2] ?? 0n).toBe(NativeTokenOutput);
      // validateWalletTxHistory(finalState2, initialState2);

      // await utils.waitForTxInHistory(String(txId), receiver2.shielded);
      const finalState3 = await utils.waitForSyncFacade(receiver2);
      // logger.info(walletStateTrimmed(finalState3));
      logger.info(`Wallet 3 available coins: ${finalState3.shielded.availableCoins.length}`);
      logger.info(`Wallet 3: ${finalState3.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(`Wallet 3: ${finalState3.shielded.balances[nativeTokenRaw2]} NT2`);
      logger.info(finalState3.shielded.availableCoins);
      expect(finalState3.shielded.balances[shieldedTokenRaw] ?? 0n).toBe(output2);
      // validateWalletTxHistory(finalState3, initialState3);

      // await utils.waitForTxInHistory(String(txId), receiver3.shielded);
      const finalState4 = await utils.waitForSyncFacade(receiver3);
      // logger.info(walletStateTrimmed(finalState4));
      logger.info(`Wallet 4 available coins: ${finalState4.shielded.availableCoins.length}`);
      logger.info(`Wallet 4: ${finalState4.shielded.balances[shieldedTokenRaw]} shielded tokens`);
      logger.info(`Wallet 4: ${finalState4.shielded.balances[nativeTokenRaw2]} NT2`);
      logger.info(finalState4.shielded.availableCoins);
      expect(finalState4.shielded.balances[shieldedTokenRaw] ?? 0n).toBe(output3);
      // validateWalletTxHistory(finalState4, initialState4);

      await utils.closeWallet(receiver1);
      await utils.closeWallet(receiver2);
      await utils.closeWallet(receiver3);
    },
    timeout,
  );

  // Refactor this test when tokenisation is added to wallet sdk
  test.skip(
    'Insufficient balance error when trying to transfer all available tdust',
    async () => {
      allure.tms('PM-15080', 'PM-15080');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('Error when trying to transfer all available tdust');

      receiver1 = utils.buildWalletFacade(randomBytes(32).toString('hex'), fixture);

      const initialState = await utils.waitForSyncFacade(senderFacade);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialBalance} shielded tokens`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(initialState.shielded.availableCoins);

      const initialState2 = await utils.waitForSyncFacade(receiver1);
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} shielded tokens`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: initialBalance,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      try {
        const txToProve = await senderFacade.transferTransaction(
          senderShieldedSecretKey,
          senderDustSecretKey,
          outputsToCreate,
          new Date(),
        );
        const provenTx = await senderFacade.finalizeTransaction(txToProve);
        await senderFacade.submitTransaction(provenTx);
      } catch (e: unknown) {
        if (e instanceof Error) {
          expect(e.message).toContain(
            'Insufficient Funds: could not balance 02000000000000000000000000000000000000000000000000000000000000000000',
          );
        } else {
          logger.info(e);
        }
      }
      await utils.closeWallet(receiver1);
    },
    timeout,
  );

  // Refactor this test when tokenisation is added to wallet sdk
  test.skip(
    'Able to transfer all available tDust incl fees',
    async () => {
      allure.tms('PM-15023', 'PM-15023');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('tDUST transfer that uses all available tokens');

      const output1 = 1_000_000n;
      const walletFees = 159620n;

      receiver1 = utils.buildWalletFacade(randomBytes(32).toString('hex'), fixture);

      const initialState = await utils.waitForSyncFacade(senderFacade);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialBalance} shielded tokens`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(initialState.shielded.availableCoins);

      const initialReceiverState = await utils.waitForSyncFacade(receiver1);
      const initialReceiverBalance = initialReceiverState.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 2: ${initialReceiverBalance} shielded tokens`);
      logger.info(`Wallet 2 available coins: ${initialReceiverState.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: output1,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialReceiverState.shielded.address,
              ),
            },
          ],
        },
      ];
      const txToProve = await senderFacade.transferTransaction(
        senderShieldedSecretKey,
        senderDustSecretKey,
        outputsToCreate,
        new Date(),
      );
      const provenTx = await senderFacade.finalizeTransaction(txToProve);
      const txId = await senderFacade.submitTransaction(provenTx);
      logger.info('sending tDUST to wallet 2');
      logger.info('Transaction id: ' + txId);

      await utils.waitForPending(senderFacade.shielded);
      // await utils.waitForTxInHistory(String(txId), senderFacade.shielded);
      const senderState = await utils.waitForSyncFacade(senderFacade);
      const newSenderWalletBalance = senderState.shielded.balances[shieldedTokenRaw] ?? 0n;
      const totalFees = initialBalance - newSenderWalletBalance - output1;
      // logger.info(walletStateTrimmed(senderState));
      logger.info(`Wallet 1: ${newSenderWalletBalance} tDUST`);
      expect(totalFees).toBeGreaterThanOrEqual(59730n);

      // await utils.waitForTxInHistory(String(txId), receiver1.shielded);
      const receiverWalletState = await utils.waitForSyncFacade(receiver1);
      // logger.info(walletStateTrimmed(receiverWalletState));
      logger.info(`Wallet 2: ${receiverWalletState.shielded.balances[shieldedTokenRaw] ?? 0n} tDUST`);

      const outputsToCreate2: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: walletFees,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialReceiverState.shielded.address,
              ),
            },
          ],
        },
      ];
      const txToProve2 = await senderFacade.transferTransaction(
        senderShieldedSecretKey,
        senderDustSecretKey,
        outputsToCreate2,
        new Date(),
      );
      const provenTx2 = await senderFacade.finalizeTransaction(txToProve2);
      const txId2 = await senderFacade.submitTransaction(provenTx2);
      logger.info('Sending transaction fee to wallet 2');
      logger.info('Transaction id: ' + txId2);

      await utils.waitForSyncFacade(senderFacade);
      // await utils.waitForTxInHistory(String(txId2), receiver1.shielded);

      const ReceiverWalletState2 = await utils.waitForSyncFacade(receiver1);
      const ReceiverWalletBalance2 = ReceiverWalletState2.shielded.balances[shieldedTokenRaw] ?? 0n;
      // logger.info(walletStateTrimmed(ReceiverWalletState2));
      logger.info(`Wallet 2 available coins: ${ReceiverWalletState2.shielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${ReceiverWalletBalance2} tDUST`);
      expect(ReceiverWalletBalance2).toBe(output1 + walletFees);

      const outputsToCreate3: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: output1,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialReceiverState.shielded.address,
              ),
            },
          ],
        },
      ];
      const txToProve3 = await receiver1.transferTransaction(
        senderShieldedSecretKey,
        senderDustSecretKey,
        outputsToCreate3,
        new Date(),
      );
      const provenTx3 = await receiver1.finalizeTransaction(txToProve3);
      const txId3 = await receiver1.submitTransaction(provenTx3);
      logger.info('Sending maximum available tDust not incl fees');
      logger.info('Transaction id: ' + txId3);

      // const pendingState = await utils.waitForSyncFacade(receiver1);
      // logger.info(walletStateTrimmed(pendingState));
      // await utils.waitForTxInHistory(String(txId3), receiver1.shielded);

      const receiverWalletState3 = await utils.waitForSyncFacade(receiver1);
      const ReceiverWalletBalance3 = receiverWalletState3.shielded.balances[shieldedTokenRaw] ?? 0n;
      // logger.info(walletStateTrimmed(receiverWalletState3));
      logger.info(`Wallet 2 available coins: ${receiverWalletState3.shielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${ReceiverWalletBalance3} tDUST`);
      expect(ReceiverWalletBalance3).toBe(0n);

      await utils.closeWallet(receiver1);

      receiver1 = utils.buildWalletFacade(randomBytes(32).toString('hex'), fixture);

      const finalReceiverWalletState = await utils.waitForSyncFacade(receiver1);
      const finalWalletBalancer = finalReceiverWalletState.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 2: ${finalWalletBalancer} tDUST`);
      logger.info(`Wallet 2 available coins: ${finalReceiverWalletState.shielded.availableCoins.length}`);
      expect(finalWalletBalancer).toBe(0n);
      await utils.closeWallet(receiver1);
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

      const output35 = 35_000_000n;
      const receiver1Seed = randomBytes(32).toString('hex');
      const receiver1SecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(receiver1Seed));
      const receiver1DustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(receiver1Seed));

      receiver1 = utils.buildWalletFacade(receiver1Seed, fixture);
      await receiver1.start(receiver1SecretKey, receiver1DustSecretKey);
      const initialState = await utils.waitForSyncFacade(senderFacade);
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);

      const initialState2 = await utils.waitForSyncFacade(receiver1);
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeTokenRaw1,
              amount: output35,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      await expect(
        senderFacade.transferTransaction(
          senderShieldedSecretKey,
          senderDustSecretKey,
          outputsToCreate,
          new Date(Date.now() + 60 * 60 * 1000),
        ),
      ).rejects.toThrow('No dust tokens found in the wallet state');
      await receiver1.stop();
    },
    timeout,
  );
});
