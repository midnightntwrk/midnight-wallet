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
import { filter, firstValueFrom, tap } from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import * as allure from 'allure-js-commons';
import { CombinedTokenTransfer, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { randomBytes } from 'node:crypto';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 * Tests performing a token transfer
 *
 * @group undeployed
 */

describe('Token transfer', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const fundedSeed = '0000000000000000000000000000000000000000000000000000000000000001';
  const seedShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
  const fundedShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(fundedSeed));
  const seedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seed));
  const fundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(fundedSeed));
  const unshieldedFundedKeyStore = createKeystore(utils.getUnshieldedSeed(fundedSeed), NetworkId.NetworkId.Undeployed);
  const dustTokenHash = (ledger.nativeToken() as { tag: string; raw: string }).raw;
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 800_000;
  const outputValue = utils.tNightAmount(10n);

  let fixture: TestContainersFixture;
  let fundedFacade: WalletFacade;
  let walletFacade: WalletFacade;
  const outputValueNativeToken = 100n;
  let tokenTypeHash: string | undefined;

  beforeEach(async () => {
    fixture = getFixture();

    fundedFacade = utils.buildWalletFacade(fundedSeed, fixture);
    walletFacade = utils.buildWalletFacade(seed, fixture);

    await fundedFacade.start(fundedShieldedSecretKey, fundedDustSecretKey);
    await walletFacade.start(seedShieldedSecretKey, seedDustSecretKey);
  });

  afterEach(async () => {
    await utils.closeWallet(fundedFacade);
    await utils.closeWallet(walletFacade);
  });

  test(
    'Is working for shielded token transfer @smoke @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-8933', 'PM-8933');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid native token transfer transaction');

      logger.info('Funding wallet 1 with native tokens...');
      await Promise.all([utils.waitForSyncFacade(fundedFacade), utils.waitForSyncFacade(walletFacade)]);
      const initialState = await firstValueFrom(fundedFacade.state());
      const initialDustBalance = initialState.dust.walletBalance(new Date()) ?? 0n;
      const initialShieldedTokenBalance = initialState.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(initialState.shielded.balances);
      logger.info(`Wallet 1: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1: ${initialShieldedTokenBalance} shielded token`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);

      const initialState2 = await firstValueFrom(walletFacade.state());
      const initialWallet2ShieldedTokenBalance = initialState2.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 2: ${initialWallet2ShieldedTokenBalance} shielded token`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);
      logger.info(
        `wallet 2 address: ${utils.getUnshieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.unshielded.address)}`,
      );

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                await walletFacade.shielded.getAddress(),
              ),
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
      logger.info('Sending transaction...');
      const provenTx = await fundedFacade.finalizeTransaction(txToProve);
      const txId = await fundedFacade.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(fundedFacade);
      logger.info(`Wallet 1 available coins: ${pendingState.shielded.availableCoins.length}`);
      logger.info(pendingState);
      logger.info(pendingState.shielded.balances);
      logger.info(`Wallet 1: ${pendingState.dust.walletBalance(new Date())} tDUST`);
      logger.info(`Wallet 1: ${pendingState.shielded.balances[shieldedTokenRaw]} shielded token`);
      expect(pendingState.dust.walletBalance(new Date())).toBeLessThan(initialDustBalance);
      expect(pendingState.shielded.balances[shieldedTokenRaw]).toBeLessThanOrEqual(
        initialShieldedTokenBalance - outputValueNativeToken,
      );
      expect(pendingState.shielded.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.shielded.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);

      await utils.waitForFacadePendingClear(fundedFacade);
      const finalState = await utils.waitForSyncFacade(fundedFacade);
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialShieldedTokenBalance - outputValueNativeToken);
      expect(finalState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(finalState.shielded.totalCoins.length).toBeLessThanOrEqual(initialState.shielded.totalCoins.length);
      logger.info(`Wallet 1: ${finalState.dust.walletBalance(new Date(3 * 1000))} tDUST`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]} ${shieldedTokenRaw}`);
      logger.info(`Dust fees paid: ${initialDustBalance - finalState.dust.walletBalance(new Date(3 * 1000))}`);

      await utils.waitForFacadePendingClear(walletFacade);
      // // await waitForTxInHistory(String(txId), walletFacade.shielded);
      logger.info('pending wallet 2 cleared');
      const finalState2 = await utils.waitForSyncFacade(walletFacade);
      logger.info(finalState2.shielded.balances);
      logger.info('wallet 2 waiting for funds...');
      logger.info(`Wallet 2 available coins: ${finalState2.shielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.dust.walletBalance(new Date())} tDUST`);
      logger.info(`Wallet 2: ${finalState2.shielded.balances[shieldedTokenRaw]} ${shieldedTokenRaw}`);
      logger.info(finalState2.shielded.balances);
      expect(finalState2.shielded.balances[shieldedTokenRaw]).toBe(
        initialWallet2ShieldedTokenBalance + outputValueNativeToken,
      );
      expect(finalState2.shielded.availableCoins.length).toBe(initialState2.shielded.availableCoins.length + 1);
      expect(finalState2.shielded.pendingCoins.length).toBe(0);
      expect(finalState2.shielded.totalCoins.length).toBeGreaterThanOrEqual(
        initialState2.shielded.totalCoins.length + 1,
      );
    },
    timeout,
  );
  test(
    'Is working for unshielded token transfer @smoke @healthcheck',
    async () => {
      logger.info('Funding wallet 1 with native tokens...');
      await Promise.all([utils.waitForSyncFacade(fundedFacade), utils.waitForSyncFacade(walletFacade)]);
      const initialState = await firstValueFrom(fundedFacade.state());
      const initialDustBalance = initialState.dust.walletBalance(new Date()) ?? 0n;
      const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
      logger.info(initialState.unshielded.balances);
      logger.info(`Wallet 1: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded token`);
      logger.info(`Wallet 1 available coins: ${initialState.unshielded.availableCoins.length}`);
      logger.info(initialState.unshielded.availableCoins);

      const initialState2 = await firstValueFrom(walletFacade.state());
      const initialBalance2 = initialState2.unshielded.balances[unshieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1: ${initialBalance2} unshielded token`);
      logger.info(`Wallet 2 available coins: ${initialState2.unshielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getUnshieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialState2.unshielded.address,
              ),
            },
          ],
        },
      ];
      const txToProve = await fundedFacade.transferTransaction(
        fundedShieldedSecretKey,
        fundedDustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      const signedTx = await fundedFacade.signTransaction(txToProve.transaction, (payload) =>
        unshieldedFundedKeyStore.signData(payload),
      );
      const finalizedTx = await fundedFacade.finalizeTransaction({ ...txToProve, transaction: signedTx });
      const txId = await fundedFacade.submitTransaction(finalizedTx);
      logger.info('Transaction id: ' + txId);

      // const pendingState = await utils.waitForFacadePending(fundedFacade);
      // logger.info(`Wallet 1 available coins: ${pendingState.unshielded.availableCoins.length}`);
      // expect(pendingState.dust.walletBalance(new Date()) ?? 0n).toBeLessThan(initialDustBalance);
      // expect(pendingState.unshielded.balances[unshieldedTokenRaw] ?? 0n).toBeLessThanOrEqual(
      //   initialBalance - outputValue,
      // );
      // expect(pendingState.unshielded.availableCoins.length).toBeLessThan(initialState.unshielded.availableCoins.length);
      // expect(pendingState.unshielded.pendingCoins.length).toBeLessThanOrEqual(2);
      // expect(pendingState.unshielded.totalCoins.length).toBe(initialState.unshielded.totalCoins.length);

      // await utils.waitForFacadePendingClear(fundedFacade);
      // const finalState = await utils.waitForSyncFacade(fundedFacade);
      const finalState = await firstValueFrom(
        fundedFacade.state().pipe(
          tap((state) => {
            const walletBalance = state.unshielded.balances[unshieldedTokenRaw];
            logger.info(`Wallet 1 unshielded token balance: ${walletBalance}, waiting for finalized balance...`);
          }),
          filter((state) => state.unshielded.balances[unshieldedTokenRaw] < initialUnshieldedBalance),
        ),
      );
      logger.info(`Wallet 1 available coins: ${finalState.unshielded.availableCoins.length}`);
      expect(finalState.dust.walletBalance(new Date())).toBeLessThan(initialDustBalance);
      expect(finalState.unshielded.balances[unshieldedTokenRaw]).toBe(initialUnshieldedBalance - outputValue);
      expect(finalState.unshielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.unshielded.availableCoins.length,
      );
      expect(finalState.unshielded.pendingCoins.length).toBe(0);
      expect(finalState.unshielded.totalCoins.length).toBeLessThanOrEqual(initialState.unshielded.totalCoins.length);
      logger.info(`Wallet 1: ${finalState.dust.walletBalance(new Date(3 * 1000))} tDUST`);
      logger.info(`Wallet 1: ${finalState.unshielded.balances[unshieldedTokenRaw]} unshielded tokens`);
      logger.info(`Dust fees paid: ${initialDustBalance - finalState.dust.walletBalance(new Date(3 * 1000))}`);

      const finalState2 = await utils.waitForUnshieldedCoinUpdate(walletFacade, 0);
      logger.info(`Wallet 2 available coins: ${finalState2.unshielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.unshielded.balances[unshieldedTokenRaw]} unshielded tokens`);
      expect(finalState2.unshielded.balances[unshieldedTokenRaw]).toBe(initialBalance2 + outputValue);
      expect(finalState2.unshielded.availableCoins.length).toBe(initialState2.unshielded.availableCoins.length + 1);
      expect(finalState2.unshielded.pendingCoins.length).toBe(0);
      expect(finalState2.unshielded.totalCoins.length).toBeGreaterThanOrEqual(
        initialState2.unshielded.totalCoins.length + 1,
      );
    },
    timeout,
  );

  test(
    'Is working for native token transfer @smoke @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-8933', 'PM-8933');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid native token transfer transaction');

      const nativeToken1Raw = '0000000000000000000000000000000000000000000000000000000000000001';
      const nativeToken2Raw = '0000000000000000000000000000000000000000000000000000000000000002';

      logger.info('Funding wallet 1 with native tokens...');
      await Promise.all([utils.waitForSyncFacade(fundedFacade), utils.waitForSyncFacade(walletFacade)]);
      const initialState = await firstValueFrom(fundedFacade.state());
      const initialDustBalance = initialState.dust.walletBalance(new Date()) ?? 0n;
      const initialShieldedToken1Balance = initialState.shielded.balances[nativeToken1Raw] ?? 0n;
      const initialShieldedToken2Balance = initialState.shielded.balances[nativeToken2Raw] ?? 0n;

      logger.info(`Wallet 1: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1: ${initialShieldedToken1Balance} shielded token 1`);
      logger.info(`Wallet 1: ${initialShieldedToken2Balance} shielded token 2`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);

      const initialState2 = await firstValueFrom(walletFacade.state());
      const initialWallet2ShieldedToken1Balance = initialState2.shielded.balances[nativeToken1Raw] ?? 0n;
      const initialWallet2ShieldedToken2Balance = initialState2.shielded.balances[nativeToken2Raw] ?? 0n;
      logger.info(`Wallet 2 shielded token 1 initial balance: ${initialWallet2ShieldedToken1Balance}`);
      logger.info(`Wallet 2 shielded token 2 initial balance: ${initialWallet2ShieldedToken2Balance}`);
      logger.info(`Wallet 2 available shielded coins: ${initialState2.shielded.availableCoins.length}`);
      logger.info(`Wallet 2 available shielded coins: ${initialState2.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeToken1Raw,
              amount: outputValueNativeToken,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                await walletFacade.shielded.getAddress(),
              ),
            },
            {
              type: nativeToken2Raw,
              amount: outputValueNativeToken,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                await walletFacade.shielded.getAddress(),
              ),
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
      logger.info('Sending transaction...');
      const provenTx = await fundedFacade.finalizeTransaction(txToProve);
      const txId = await fundedFacade.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(fundedFacade);
      logger.info(`Wallet 1 available coins: ${pendingState.shielded.availableCoins.length}`);
      logger.info(pendingState);
      logger.info(pendingState.shielded.balances);
      logger.info(`Wallet 1: ${pendingState.dust.walletBalance(new Date())} tDUST`);

      await utils.waitForFacadePendingClear(fundedFacade);
      const finalState = await utils.waitForSyncFacade(fundedFacade);
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      expect(finalState.shielded.balances[nativeToken1Raw]).toBe(initialShieldedToken1Balance - outputValueNativeToken);
      expect(finalState.shielded.balances[nativeToken2Raw]).toBe(initialShieldedToken1Balance - outputValueNativeToken);
      expect(finalState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(finalState.shielded.totalCoins.length).toBeLessThanOrEqual(initialState.shielded.totalCoins.length);

      logger.info(`Wallet 1: ${finalState.dust.walletBalance(new Date(3 * 1000))} tDUST`);
      logger.info(`Wallet 1 shielded token 1: ${finalState.shielded.balances[nativeToken1Raw]}`);
      logger.info(`Wallet 1 shielded token 2: ${finalState.shielded.balances[nativeToken2Raw]}`);
      logger.info(`Dust fees paid: ${initialDustBalance - finalState.dust.walletBalance(new Date(3 * 1000))}`);

      const finalState2 = await utils.waitForSyncFacade(walletFacade);
      logger.info(`Wallet 2 available coins: ${finalState2.shielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.dust.walletBalance(new Date())} tDUST`);
      logger.info(`Wallet 2 shielded token 1: ${finalState2.shielded.balances[nativeToken1Raw]}`);
      logger.info(`Wallet 2 shielded token 2: ${finalState2.shielded.balances[nativeToken2Raw]}`);
      logger.info(finalState2.shielded.balances);
      expect(finalState2.shielded.balances[nativeToken1Raw]).toBe(
        initialWallet2ShieldedToken1Balance + outputValueNativeToken,
      );
      expect(finalState2.shielded.balances[nativeToken2Raw]).toBe(
        initialWallet2ShieldedToken2Balance + outputValueNativeToken,
      );
      expect(finalState2.shielded.availableCoins.length).toBe(initialState2.shielded.availableCoins.length + 2);
      expect(finalState2.shielded.pendingCoins.length).toBe(0);
      expect(finalState2.shielded.totalCoins.length).toBeGreaterThanOrEqual(
        initialState2.shielded.totalCoins.length + 2,
      );
    },
    timeout,
  );

  test(
    'can perform a self-transaction',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-9680', 'PM-9680');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer self-transaction');

      const initialState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialDustBalance = initialState.dust.walletBalance(new Date());
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState.shielded.address),
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
      logger.info('Sending transaction...');
      const provenTx = await fundedFacade.finalizeTransaction(txToProve);
      const txId = await fundedFacade.submitTransaction(provenTx);
      const txFees = await fundedFacade.calculateTransactionFee(provenTx);
      logger.info('Transaction id: ' + txId);

      await utils.waitForFacadePendingClear(fundedFacade);
      const finalState = await utils.waitForSyncFacade(fundedFacade);
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      // actually deducted fees are greater - PM-7721
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialBalance);
      expect(finalState.shielded.availableCoins.length).toBe(8);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBe(8);
      // Transaction fees are calculated by adding fee payment with margin plus total fee charge so
      // total fees deducted should be higher than estimated fees
      expect(finalState.dust.walletBalance(new Date(3 * 1000))).toBeLessThan(initialDustBalance - txFees);
    },
    timeout,
  );

  test(
    'can perform a transaction to two different wallet addresses',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-9680', 'PM-9680');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer self-transaction');

      const receiverSeed1 = randomBytes(32).toString('hex');
      const receiverSeed2 = randomBytes(32).toString('hex');
      const receiverShieldedSecretKey1 = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(receiverSeed1));
      const receiverShieldedSecretKey2 = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(receiverSeed2));
      const receiverDustSecretKey1 = ledger.DustSecretKey.fromSeed(utils.getDustSeed(receiverSeed1));
      const receiverDustSecretKey2 = ledger.DustSecretKey.fromSeed(utils.getDustSeed(receiverSeed2));

      const initialState = await utils.waitForSyncFacade(fundedFacade);
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
      const initialDustBalance = initialState.dust.walletBalance(new Date());
      logger.info(`Wallet 1 shielded balance: ${initialShieldedBalance}`);
      logger.info(`Wallet 1 unshielded balance: ${initialUnshieldedBalance}`);
      logger.info(`Wallet 1: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);

      const receiver1 = utils.buildWalletFacade(receiverSeed1, fixture);
      const receiver2 = utils.buildWalletFacade(receiverSeed2, fixture);
      await receiver1.start(receiverShieldedSecretKey1, receiverDustSecretKey1);
      await receiver2.start(receiverShieldedSecretKey2, receiverDustSecretKey2);
      const initialReceiver1State = await utils.waitForSyncFacade(receiver1);
      const initialReceiver2State = await utils.waitForSyncFacade(receiver2);
      logger.info('Receiver wallets');

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialReceiver1State.shielded.address,
              ),
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: outputValue,
              receiverAddress: UnshieldedAddress.codec
                .encode(fixture.getNetworkId(), initialReceiver1State.unshielded.address)
                .asString(),
            },
          ],
        },
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialReceiver2State.shielded.address,
              ),
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: outputValue,
              receiverAddress: UnshieldedAddress.codec
                .encode(fixture.getNetworkId(), initialReceiver2State.unshielded.address)
                .asString(),
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
      logger.info('Sending transaction...');
      const signedTx = await fundedFacade.signTransaction(txToProve.transaction, (payload) =>
        unshieldedFundedKeyStore.signData(payload),
      );
      const finalizedTx = await fundedFacade.finalizeTransaction({ ...txToProve, transaction: signedTx });
      const txId = await fundedFacade.submitTransaction(finalizedTx);
      const txFees = await fundedFacade.calculateTransactionFee(finalizedTx);
      logger.info('Transaction id: ' + txId);
      logger.info('Wait for pending...');
      await utils.waitForFacadePending(fundedFacade);
      // logger.info(`Wallet 1 available coins: ${pendingState.shielded.availableCoins.length}`);
      // expect(pendingState.shielded.balances[shieldedTokenRaw]).toBeLessThan(initialBalance);
      // expect(pendingState.shielded.availableCoins.length).toBe(7); // Test intemittently failing for different available coins
      // // expect(pendingState.shielded.pendingCoins.length).toBe(2);
      // expect(pendingState.shielded.totalCoins.length).toBeLessThanOrEqual(8);
      // expect(pendingState.unshielded.availableCoins.length).toBe(4);
      // expect(pendingState.unshielded.pendingCoins.length).toBe(1);
      // expect(pendingState.unshielded.totalCoins.length).toBeLessThanOrEqual(8);

      await utils.waitForFacadePendingClear(fundedFacade);
      const finalState = await utils.waitForSyncFacade(fundedFacade);
      const finalReceiver1State = await utils.waitForSyncFacade(receiver1);
      const finalReceiver2State = await utils.waitForSyncFacade(receiver2);
      // logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Dust fees paid: ${initialDustBalance - finalState.dust.walletBalance(new Date(3 * 1000))}`);
      // actually deducted fees are greater - PM-7721
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialShieldedBalance - outputValue * 2n);
      expect(finalState.unshielded.balances[unshieldedTokenRaw]).toBe(initialUnshieldedBalance - outputValue * 2n);
      expect(finalState.shielded.availableCoins.length).toBe(7);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBe(7);
      expect(finalState.dust.walletBalance(new Date(3 * 1000))).toBeLessThan(initialDustBalance - txFees);
      expect(finalReceiver1State.shielded.balances[shieldedTokenRaw]).toBe(outputValue);
      expect(finalReceiver1State.unshielded.balances[shieldedTokenRaw]).toBe(outputValue);
      expect(finalReceiver2State.shielded.balances[shieldedTokenRaw]).toBe(outputValue);
      expect(finalReceiver2State.unshielded.balances[shieldedTokenRaw]).toBe(outputValue);
      await receiver1.stop();
      await receiver2.stop();
    },
    timeout,
  );

  test(
    'coin becomes available when tx fails on node',
    async () => {
      allure.tms('PM-8919', 'PM-8919');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid transaction');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      const initialAvailableCoins = syncedState?.shielded.availableCoins.length ?? 0;
      const initialTotalCoins = syncedState?.shielded.totalCoins.length ?? 0;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(walletFacade.state());
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw];
      if (initialBalance2 === undefined || initialBalance2 === 0n) {
        logger.info(`Waiting to receive tokens...`);
      }

      const coin = ledger.createShieldedCoinInfo(shieldedTokenRaw, outputValue);
      const output = ledger.ZswapOutput.new(
        coin,
        0,
        syncedState.shielded.coinPublicKey.toHexString(),
        syncedState.shielded.encryptionPublicKey.toHexString(),
      );
      const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenRaw, outputValue);
      const unprovenTx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer);
      const provenTx = await fundedFacade.finalizeTransaction({
        type: 'TransactionToProve',
        transaction: unprovenTx,
      });
      await expect(
        Promise.all([fundedFacade.submitTransaction(provenTx), fundedFacade.submitTransaction(provenTx)]),
      ).rejects.toThrow();

      const finalState = await utils.waitForFinalizedBalance(fundedFacade.shielded);
      expect(finalState.balances[shieldedTokenRaw]).toBe(initialBalance);
      expect(finalState.availableCoins.length).toBe(initialAvailableCoins);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.totalCoins.length).toBe(initialTotalCoins);
    },
    timeout,
  );

  // TO-DO: Dust stays pending and only returns after some time. Wait for ledger to implement api to return back pending.
  test.skip(
    'coin becomes available when tx does not get proved',
    async () => {
      allure.tms('PM-8917', 'PM-8917');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Transaction not proved');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 2500000000000000n;

      logger.info('Stopping proof server container..');
      await fixture.getProofServerContainer().stop({ timeout: 10_000 });

      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: dustTokenHash,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
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
      await expect(fundedFacade.finalizeTransaction(txToProve)).rejects.toThrow();

      // const pendingState = await waitForPending(fundedFacade);
      // logger.info(pendingState);
      // expect(pendingState.balances[dustTokenHash]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(1);

      const finalState = await utils.waitForFacadePendingClear(fundedFacade);
      expect(finalState.shielded.balances[dustTokenHash]).toBe(balance);
      expect(finalState.shielded.availableCoins.length).toBe(7);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBe(7);
      // expect(finalState.transactionHistory.length).toBe(1);
    },
    timeout,
  );

  // TO-DO: Same as above
  test.skip(
    'coin becomes available when tx does not get submitted',
    async () => {
      allure.tms('PM-8918', 'PM-8918');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Transaction not submitted');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 2500000000000000n;

      logger.info('Stopping node container..');
      await fixture.getNodeContainer().stop({ removeVolumes: false });

      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
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
      await expect(fundedFacade.submitTransaction(provenTx)).rejects.toThrow();

      const finalState = await utils.waitForFinalizedBalance(fundedFacade.shielded);
      expect(finalState.balances[dustTokenHash]).toBe(balance);
      expect(finalState.availableCoins.length).toBe(5);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.totalCoins.length).toBe(5);
    },
    timeout,
  );

  test(
    'error message when attempting to send to an invalid address',
    async () => {
      allure.tms('PM-9678', 'PM-9678');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid address error message');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const invalidAddress = 'invalidAddress';

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: invalidAddress,
            },
          ],
        },
      ];
      await expect(
        fundedFacade.transferTransaction(fundedShieldedSecretKey, fundedDustSecretKey, outputsToCreate, new Date()),
      ).rejects.toThrow(`Address parsing error: invalidAddress`);
    },
    timeout,
  );

  test(
    'error message when attempting to send an amount greater than available balance',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const aboveBalanceAmount = initialBalance + 1n;
      logger.info(`Attempting to send amount: ${aboveBalanceAmount}`);
      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: aboveBalanceAmount,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      await expect(
        fundedFacade.transferTransaction(
          fundedShieldedSecretKey,
          fundedDustSecretKey,
          outputsToCreate,
          new Date(Date.now() + 60 * 60 * 1000),
        ),
      ).rejects.toThrow(`Insufficient funds`);
    },
    timeout,
  );

  // Bug logged: PM20174
  test.skip(
    'error message when attempting to send an amount at max available network supply',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      // the max amount that we support: Rust u128 max.
      const maxAmount = 340_282_366_920_938_463_463_374_607_431_768_211_455n;
      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: maxAmount,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
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
      await expect(fundedFacade.submitTransaction(provenTx)).rejects.toThrow(
        `Insufficient Funds: could not balance 02000000000000000000000000000000000000000000000000000000000000000000`,
      );
    },
    timeout,
  );

  test(
    'error message when attempting to send an invalid amount',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      // the max amount that we support: Rust u128 max. The entire Midnight supply
      // is 24 billion tDUST, 1 tDUST = 10^6 specks, which is lesser
      const invalidAmount = 340_282_366_920_938_463_463_374_607_431_768_211_456n;
      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: dustTokenHash,
              amount: invalidAmount,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      await expect(
        fundedFacade.transferTransaction(
          fundedShieldedSecretKey,
          fundedDustSecretKey,
          outputsToCreate,
          new Date(Date.now() + 60 * 60 * 1000),
        ),
      ).rejects.toThrow(`Error: Couldn't deserialize u128 from a BigInt outside u128::MIN..u128::MAX bounds`);
    },
    timeout,
  );

  test(
    'error message when attempting to send a negative amount',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: dustTokenHash,
              amount: -5n,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      await expect(
        fundedFacade.transferTransaction(
          fundedShieldedSecretKey,
          fundedDustSecretKey,
          outputsToCreate,
          new Date(Date.now() + 60 * 60 * 1000),
        ),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting shielded transfer to send a zero amount',
    async () => {
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: 0n,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                await walletFacade.shielded.getAddress(),
              ),
            },
          ],
        },
      ];

      await expect(
        fundedFacade.transferTransaction(
          fundedShieldedSecretKey,
          fundedDustSecretKey,
          outputsToCreate,
          new Date(Date.now() + 60 * 60 * 1000),
        ),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting shielded initSwap with non-positive outputs',
    async () => {
      const initialState2 = await firstValueFrom(walletFacade.state());

      const desiredInputs = {
        shielded: {},
      };

      const desiredOutputs = [
        {
          type: 'shielded' as const,
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: 0n,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];

      await expect(
        fundedFacade.initSwap(
          fundedShieldedSecretKey,
          desiredInputs,
          desiredOutputs,
          new Date(Date.now() + 60 * 60 * 1000),
        ),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting shielded initSwap with non-positive inputs',
    async () => {
      const initialState2 = await firstValueFrom(walletFacade.state());

      const desiredInputs = {
        shielded: {
          [shieldedTokenRaw]: 0n,
        },
      };

      const desiredOutputs = [
        {
          type: 'shielded' as const,
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];

      await expect(
        fundedFacade.initSwap(
          fundedShieldedSecretKey,
          desiredInputs,
          desiredOutputs,
          new Date(Date.now() + 60 * 60 * 1000),
        ),
      ).rejects.toThrow('The input amounts need to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting to send an empty array of outputs',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      await expect(
        fundedFacade.transferTransaction(fundedShieldedSecretKey, fundedDustSecretKey, [], new Date()),
      ).rejects.toThrow('At least one shielded or unshielded output is required.');
    },
    timeout,
  );

  // TODO: fix test
  test.skip(
    'coins become available when native token tx fails on node',
    async () => {
      allure.tms('PM-8936', 'PM-8936');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid native token transaction');
      const initialState = await firstValueFrom(fundedFacade.state());
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialDustBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      Object.entries(initialState.shielded.balances).forEach(([key, _]) => {
        if (key !== dustTokenHash) tokenTypeHash = key;
      });
      if (tokenTypeHash === undefined) {
        throw new Error('No native tokens found');
      }
      const initialBalance = syncedState?.shielded.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

      const syncedState2 = await utils.waitForSyncFacade(walletFacade);
      const initialDustBalance2 = syncedState2?.shielded.balances[dustTokenHash] ?? 0n;
      const initialBalance2 = syncedState2?.shielded.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance2} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance2} ${tokenTypeHash}`);

      const coin = ledger.createShieldedCoinInfo(tokenTypeHash, outputValueNativeToken);
      const output = ledger.ZswapOutput.new(
        coin,
        0,
        initialState.shielded.coinPublicKey.toHexString(),
        initialState.shielded.encryptionPublicKey.toHexString(),
      );
      const offer = ledger.ZswapOffer.fromOutput(output, tokenTypeHash, outputValueNativeToken);
      const unprovenTx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer);
      const provenTx = await fundedFacade.finalizeTransaction({
        type: 'TransactionToProve',
        transaction: unprovenTx,
      });

      await expect(
        Promise.all([fundedFacade.submitTransaction(provenTx), fundedFacade.submitTransaction(provenTx)]),
      ).rejects.toThrow();

      const finalState = await utils.waitForFinalizedBalance(fundedFacade.shielded);
      expect(finalState).toMatchObject(syncedState);
      expect(finalState.balances[dustTokenHash]).toBe(initialDustBalance);
      expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
      expect(finalState.availableCoins.length).toBe(syncedState.shielded.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.totalCoins.length).toBe(syncedState.shielded.totalCoins.length);
    },
    timeout,
  );
  // TODO: fix test
  test.skip(
    'coins become available when native token tx does not get proved',
    async () => {
      allure.tms('PM-8934', 'PM-8934');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Transaction not proved');
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialDustBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      Object.entries(syncedState.shielded.balances).forEach(([key, _]) => {
        if (key !== dustTokenHash) tokenTypeHash = key;
      });
      if (tokenTypeHash === undefined) {
        throw new Error('No native tokens found');
      }
      const initialBalance = syncedState?.shielded.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

      logger.info('Stopping proof server container..');
      await fixture.getProofServerContainer().stop({ timeout: 10_000 });

      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: tokenTypeHash,
              amount: outputValueNativeToken,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await fundedFacade.transferTransaction(
        fundedShieldedSecretKey,
        fundedDustSecretKey,
        outputsToCreate,
        new Date(),
      );
      await expect(fundedFacade.finalizeTransaction(txToProve)).rejects.toThrow();

      const finalState = await utils.waitForFinalizedBalance(fundedFacade.shielded);
      expect(finalState).toMatchObject(syncedState);
      expect(finalState.balances[dustTokenHash]).toBe(initialDustBalance);
      expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
      expect(finalState.availableCoins.length).toBe(syncedState.shielded.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.totalCoins.length).toBe(syncedState.shielded.totalCoins.length);
    },
    timeout,
  );

  test(
    'error message when attempting to make transfer using incorrect shielded secret key',
    async () => {
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const incorrectSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: dustTokenHash,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await fundedFacade.transferTransaction(
        incorrectSecretKey,
        fundedDustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 60 * 60 * 1000),
      );
      await expect(fundedFacade.finalizeTransaction(txToProve)).rejects.toThrow('Failed to prove transaction');
    },
    timeout,
  );

  test(
    'error message when attempting to make transfer using incorrect dust secret key',
    async () => {
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const incorrectDustKey = seedDustSecretKey;
      const syncedState = await utils.waitForSyncFacade(fundedFacade);
      const initialBalance = syncedState?.shielded.balances[dustTokenHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(walletFacade.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
            },
          ],
        },
      ];
      await expect(
        fundedFacade.transferTransaction(
          fundedShieldedSecretKey,
          incorrectDustKey,
          outputsToCreate,
          new Date(Date.now() + 60 * 60 * 1000),
        ),
      ).rejects.toThrow("Error from ledger: attempted to spend Dust UTXO that's not in the wallet state:");
    },
    timeout,
  );
});
