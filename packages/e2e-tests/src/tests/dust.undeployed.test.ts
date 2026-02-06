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
import { describe, test, expect } from 'vitest';
import * as rx from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import * as utils from './utils.js';
import { logger } from './logger.js';
import * as allure from 'allure-js-commons';
import { CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';
import { ArrayOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { inspect } from 'node:util';

/**
 *
 * @group undeployed
 */

describe('Dust tests', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 300_000;
  const outputValue = utils.tNightAmount(1000n);

  let fixture: TestContainersFixture;
  let funded: utils.WalletInit;
  let receiver: utils.WalletInit;

  beforeEach(async () => {
    await allure.step('Start two wallets', async function () {
      fixture = getFixture();
      funded = await utils.initWalletWithSeed(seedFunded, fixture);
      receiver = await utils.initWalletWithSeed(seed, fixture);
      logger.info('Two wallets started');
    });
  });

  afterEach(async () => {
    await funded.wallet.stop();
    await receiver.wallet.stop();
  }, 20_000);

  const sendAndRegisterNightUtxos = async () => {
    const initialState = await utils.waitForSyncFacade(funded.wallet);
    const receiverInitialState = await utils.waitForSyncFacade(receiver.wallet);
    const receiverInitialAvailableCoins = receiverInitialState.unshielded.availableCoins.length;
    const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
    logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
    logger.info(`Wallet 1 total unshielded coins: ${initialState.unshielded.totalCoins.length}`);

    const outputsToCreate: CombinedTokenTransfer[] = [
      {
        type: 'shielded',
        outputs: [
          {
            type: shieldedTokenRaw,
            amount: outputValue,
            receiverAddress: receiverInitialState.shielded.address,
          },
        ],
      },
      {
        type: 'unshielded',
        outputs: [
          {
            amount: outputValue,
            receiverAddress: receiverInitialState.unshielded.address,
            type: unshieldedTokenRaw,
          },
        ],
      },
      {
        type: 'unshielded',
        outputs: [
          {
            amount: outputValue,
            receiverAddress: receiverInitialState.unshielded.address,
            type: unshieldedTokenRaw,
          },
        ],
      },
    ];

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const txRecipe = await funded.wallet.transferTransaction(
      outputsToCreate,
      {
        shieldedSecretKeys: funded.shieldedSecretKeys,
        dustSecretKey: funded.dustSecretKey,
      },
      { ttl },
    );
    const signedTxRecipe = await funded.wallet.signRecipe(txRecipe, (payload) =>
      funded.unshieldedKeystore.signData(payload),
    );
    const finalizedTx = await funded.wallet.finalizeRecipe(signedTxRecipe);
    const txId = await funded.wallet.submitTransaction(finalizedTx);
    logger.info('Transaction id: ' + txId);
    logger.info('Waiting for finalized balance...');
    const receiverState2 = await utils.waitForUnshieldedCoinUpdate(receiver.wallet, receiverInitialAvailableCoins);
    const finalUnshieldedBalance = receiverState2.unshielded.balances[unshieldedTokenRaw];
    logger.info(inspect(receiverState2.unshielded.availableCoins, { depth: null }));
    logger.info(`Wallet 2: ${finalUnshieldedBalance} unshielded tokens`);

    await utils.sleep(20);
    const nightUtxos = receiverState2.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );
    if (nightUtxos.length === 0) {
      throw new Error('No night UTXOs available to register');
    }
    logger.info(`night utxo length: ${nightUtxos.length}`);

    expect(ArrayOps.sumBigInt(nightUtxos.map((coin) => coin.utxo.value))).toEqual(finalUnshieldedBalance);
    logger.info(`utxo length: ${nightUtxos.length}`);

    const dustRegistrationRecipe = await receiver.wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      receiver.unshieldedKeystore.getPublicKey(),
      (payload) => receiver.unshieldedKeystore.signData(payload),
    );

    const finalizedDustTx = await receiver.wallet.finalizeRecipe(dustRegistrationRecipe);
    const dustRegistrationTxid = await receiver.wallet.submitTransaction(finalizedDustTx);
    logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);

    await utils.waitForSyncFacade(receiver.wallet);

    const receiverStateAfterRegistration = await utils.waitForStateAfterDustRegistration(
      receiver.wallet,
      finalizedDustTx,
    );

    const nightBalanceAfterRegistration = receiverStateAfterRegistration.unshielded.balances[unshieldedTokenRaw];
    expect(nightBalanceAfterRegistration).toBe(finalUnshieldedBalance);
  };

  test(
    'Able to register Night tokens for Dust generation after receiving unshielded tokens @healthcheck',
    async () => {
      await sendAndRegisterNightUtxos();
      const initialWalletState = await utils.waitForSyncFacade(receiver.wallet);
      const receiverDustBalance = await rx.firstValueFrom(
        receiver.wallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.balance(new Date()) > 1000n),
          rx.map((s) => s.dust.balance(new Date())),
        ),
      );

      expect(receiverDustBalance).toBeGreaterThan(0n);
      await utils.waitForRegisteredTokens(receiver.wallet);
      const registeredNightUtxos = initialWalletState.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );
      expect(registeredNightUtxos.length).toBeGreaterThan(0);
    },
    timeout,
  );

  test(
    'Able to deregister night tokens for dust decay',
    async () => {
      // allure.tag('smoke');
      // allure.tag('heanthcheck');
      // allure.tms('PM-8916', 'PM-8916');
      // allure.epic('Headless wallet');
      // allure.feature('Transactions');
      // allure.story('Valid transfer transaction');

      const initialWalletState = await utils.waitForSyncFacade(receiver.wallet);

      const registerdNightUtxosBeforeRegister = initialWalletState.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );

      if (registerdNightUtxosBeforeRegister.length === 0) {
        logger.info('No registered night UTXOs found, registering now...');
        await sendAndRegisterNightUtxos();
        await utils.waitForRegisteredTokens(receiver.wallet);
      }

      const receiverDustBalance = await rx.firstValueFrom(
        receiver.wallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.balance(new Date()) > 7n * 10n ** 14n),
          rx.map((s) => s.dust.balance(new Date())),
        ),
      );

      expect(receiverDustBalance).toBeGreaterThan(0n);
      logger.info(`Dust balance before deregistration: ${receiverDustBalance}`);

      const walletStateBeforeDeregister = await utils.waitForSyncFacade(receiver.wallet);
      const initialNightBalance = walletStateBeforeDeregister.unshielded.balances[unshieldedTokenRaw];
      logger.info(`Initial Night Balance: ${initialNightBalance}`);

      const initialDustBalance = walletStateBeforeDeregister.dust.balance(new Date());
      logger.info(`Initial Dust Balance: ${initialDustBalance}`);

      const registeredNightUtxos = walletStateBeforeDeregister.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );
      expect(registeredNightUtxos.length).toBeGreaterThan(0);

      const dustDeregistrationRecipe = await receiver.wallet.deregisterFromDustGeneration(
        registeredNightUtxos,
        receiver.unshieldedKeystore.getPublicKey(),
        (payload) => receiver.unshieldedKeystore.signData(payload),
      );

      const balancedTransactionRecipe = await receiver.wallet.balanceUnprovenTransaction(
        dustDeregistrationRecipe.transaction,
        {
          shieldedSecretKeys: receiver.shieldedSecretKeys,
          dustSecretKey: receiver.dustSecretKey,
        },
        { ttl: new Date(Date.now() + 30 * 60 * 1000) },
      );

      const finalizedDustTx = await receiver.wallet.finalizeRecipe(balancedTransactionRecipe);
      const dustDeregistrationTxid = await receiver.wallet.submitTransaction(finalizedDustTx);
      logger.info(`Dust de-registration tx id: ${dustDeregistrationTxid}`);

      const walletStateAfterDeregister = await utils.waitForSyncFacade(receiver.wallet);

      const finalDustBalance = await rx.firstValueFrom(
        receiver.wallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.balance(new Date()) == 0n),
          rx.map((s) => s.dust.balance(new Date())),
        ),
      );

      expect(finalDustBalance).toBe(0n);

      const finalWalletNightBalance = walletStateAfterDeregister.unshielded.balances[unshieldedTokenRaw];
      expect(finalWalletNightBalance).toBe(initialNightBalance);
    },
    timeout,
  );

  test(
    'Able to spend all shielded tokens',
    async () => {
      const walletState = await utils.waitForSyncFacade(receiver.wallet);

      const registerdNightUtxosBeforeRegister = walletState.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );

      if (registerdNightUtxosBeforeRegister.length === 0) {
        logger.info('No registered night UTXOs found, registering now...');
        await sendAndRegisterNightUtxos();
        await utils.waitForRegisteredTokens(receiver.wallet);
      }

      const receiverDustBalance = await rx.firstValueFrom(
        receiver.wallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.balance(new Date()) > 7n * 10n ** 14n),
          rx.map((s) => s.dust.balance(new Date())),
        ),
      );

      expect(receiverDustBalance).toBeGreaterThan(0n);
      // Wait for dust balance to be generated
      const initialWalletState = await rx.firstValueFrom(
        receiver.wallet.state().pipe(
          rx.tap((s) => {
            const registeredTokens = s.unshielded.availableCoins.filter(
              (coin) => coin.meta.registeredForDustGeneration === true,
            );
            logger.info(`registered tokens: ${registeredTokens.length}`);
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter(
            (s) =>
              s.unshielded.availableCoins.filter((coin) => coin.meta.registeredForDustGeneration === true).length > 0,
          ),
          rx.filter((s) => s.dust.balance(new Date()) > 1000n),
        ),
      );

      const initialshieldedBalance = initialWalletState.shielded.balances[shieldedTokenRaw];
      logger.info(`Wallet 1: ${initialshieldedBalance} shielded tokens`);

      const initialFundedState = await utils.waitForSyncFacade(funded.wallet);
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: initialshieldedBalance,
              receiverAddress: initialFundedState.shielded.address,
            },
          ],
        },
      ];
      const ttl = new Date(Date.now() + 30 * 60 * 1000);
      const txRecipe = await receiver.wallet.transferTransaction(
        outputsToCreate,
        {
          shieldedSecretKeys: receiver.shieldedSecretKeys,
          dustSecretKey: receiver.dustSecretKey,
        },
        { ttl },
      );
      const finalizedTx = await receiver.wallet.finalizeRecipe(txRecipe);
      const txId = await receiver.wallet.submitTransaction(finalizedTx);
      expect(txId).toBeDefined();
      logger.info('Transaction id: ' + txId);
      await utils.waitForFacadePendingClear(receiver.wallet);
      const finalReceiverState = await utils.waitForSyncFacade(receiver.wallet);
      const finalshieldedBalance = finalReceiverState.shielded.balances[shieldedTokenRaw];
      logger.info(`Final shielded balance: ${finalshieldedBalance}`);
      expect(finalshieldedBalance).toBe(undefined);
      logger.info(inspect(finalReceiverState.shielded.availableCoins, { depth: null }));
    },
    timeout,
  );

  test(
    'Able to spend all unshielded tokens with generated Dust',
    async () => {
      const walletState = await utils.waitForSyncFacade(receiver.wallet);

      const registerdNightUtxosBeforeRegister = walletState.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );

      if (registerdNightUtxosBeforeRegister.length === 0) {
        logger.info('No registered night UTXOs found, registering now...');
        await sendAndRegisterNightUtxos();
        await utils.waitForRegisteredTokens(receiver.wallet);
      }

      const receiverDustBalance = await rx.firstValueFrom(
        receiver.wallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.balance(new Date()) > 7n * 10n ** 14n),
          rx.map((s) => s.dust.balance(new Date())),
        ),
      );

      expect(receiverDustBalance).toBeGreaterThan(0n);
      // Wait for dust balance to be generated
      const initialWalletState = await rx.firstValueFrom(
        receiver.wallet.state().pipe(
          rx.debounceTime(10_000),
          rx.tap((s) => {
            const registeredTokens = s.unshielded.availableCoins.filter(
              (coin) => coin.meta.registeredForDustGeneration === true,
            );
            logger.info(`registered tokens: ${registeredTokens.length}`);
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.balance(new Date()) > s.unshielded.balances[unshieldedTokenRaw] * 5n),
        ),
      );

      const initialUnshieldedBalance = initialWalletState.unshielded.balances[unshieldedTokenRaw];
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);

      const initialFundedState = await utils.waitForSyncFacade(funded.wallet);
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'unshielded',
          outputs: [
            {
              amount: initialUnshieldedBalance,
              receiverAddress: initialFundedState.unshielded.address,
              type: ledger.unshieldedToken().raw,
            },
          ],
        },
      ];
      const ttl = new Date(Date.now() + 30 * 60 * 1000);
      const txRecipe = await receiver.wallet.transferTransaction(
        outputsToCreate,
        {
          shieldedSecretKeys: receiver.shieldedSecretKeys,
          dustSecretKey: receiver.dustSecretKey,
        },
        { ttl },
      );
      const signedTxRecipe = await receiver.wallet.signRecipe(txRecipe, (payload) =>
        receiver.unshieldedKeystore.signData(payload),
      );
      const finalizedTx = await receiver.wallet.finalizeRecipe(signedTxRecipe);
      const txId = await receiver.wallet.submitTransaction(finalizedTx);
      expect(txId).toBeDefined();
      logger.info('Transaction id: ' + txId);
      await utils.waitForFacadePendingClear(receiver.wallet);
      const finalReceiverState = await utils.waitForSyncFacade(receiver.wallet);
      const finalUnshieldedBalance = finalReceiverState.unshielded.balances[unshieldedTokenRaw];
      expect(finalUnshieldedBalance).toBe(undefined);
      logger.info(`Final unshielded balance: ${finalUnshieldedBalance}`);
      logger.info(inspect(finalReceiverState.unshielded.availableCoins, { depth: null }));
    },
    timeout,
  );
});
