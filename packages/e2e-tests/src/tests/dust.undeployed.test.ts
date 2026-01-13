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
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import * as allure from 'allure-js-commons';
import { CombinedTokenTransfer, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { ArrayOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { inspect } from 'node:util';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 *
 * @group undeployed
 */

describe('Dust tests', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const fundedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seedFunded));
  const fundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seedFunded));
  const unshieldedFundedKeyStore = createKeystore(utils.getUnshieldedSeed(seedFunded), NetworkId.NetworkId.Undeployed);
  const receiverWalletSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
  const receiverWalletDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seed));
  const receiverKeystore = createKeystore(utils.getUnshieldedSeed(seed), NetworkId.NetworkId.Undeployed);
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 300_000;
  const outputValue = utils.tNightAmount(1000n);

  let fixture: TestContainersFixture;
  let walletFunded: WalletFacade;
  let receiverWallet: WalletFacade;

  beforeEach(async () => {
    await allure.step('Start two wallets', async function () {
      fixture = getFixture();
      walletFunded = utils.buildWalletFacade(seedFunded, fixture);
      receiverWallet = utils.buildWalletFacade(seed, fixture);
      await walletFunded.start(fundedSecretKey, fundedDustSecretKey);
      await receiverWallet.start(receiverWalletSecretKey, receiverWalletDustSecretKey);
      logger.info('Two wallets started');
    });
  });

  afterEach(async () => {
    await walletFunded.stop();
    await receiverWallet.stop();
  }, 20_000);

  const sendAndRegisterNightUtxos = async () => {
    const initialState = await utils.waitForSyncFacade(walletFunded);
    const receiverInitialState = await utils.waitForSyncFacade(receiverWallet);
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
            receiverAddress: utils.getShieldedAddress(fixture.getNetworkId(), receiverInitialState.shielded.address),
          },
        ],
      },
      {
        type: 'unshielded',
        outputs: [
          {
            amount: outputValue,
            receiverAddress: UnshieldedAddress.codec
              .encode(fixture.getNetworkId(), receiverInitialState.unshielded.address)
              .asString(),
            type: unshieldedTokenRaw,
          },
        ],
      },
    ];

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const txToProveRecipe = await walletFunded.transferTransaction(
      fundedSecretKey,
      fundedDustSecretKey,
      outputsToCreate,
      ttl,
    );
    const signedRecipe = await walletFunded.signRecipe(txToProveRecipe, (payload) =>
      unshieldedFundedKeyStore.signData(payload),
    );
    const provenTx = await walletFunded.finalizeRecipe(signedRecipe);
    const txId = await walletFunded.submitTransaction(provenTx);
    logger.info('Transaction id: ' + txId);

    logger.info('Waiting for finalized balance...');
    const receiverState2 = await utils.waitForUnshieldedCoinUpdate(receiverWallet, receiverInitialAvailableCoins);
    const finalUnshieldedBalance = receiverState2.unshielded.balances[unshieldedTokenRaw];
    logger.info(inspect(receiverState2.unshielded.availableCoins, { depth: null }));
    logger.info(`Wallet 2: ${finalUnshieldedBalance} unshielded tokens`);

    const nightUtxos = receiverState2.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );
    if (nightUtxos.length === 0) {
      throw new Error('No night UTXOs available to register');
    }

    const firstNightUtxo = nightUtxos[0];

    expect(ArrayOps.sumBigInt(nightUtxos.map((coin) => coin.utxo.value))).toEqual(finalUnshieldedBalance);
    logger.info(`utxo length: ${nightUtxos.length}`);

    const dustRegistrationRecipe = await receiverWallet.registerNightUtxosForDustGeneration(
      [firstNightUtxo],
      receiverKeystore.getPublicKey(),
      (payload) => receiverKeystore.signData(payload),
    );

    const finalizedDustTx = await receiverWallet.finalizeRecipe(dustRegistrationRecipe);
    const dustRegistrationTxid = await receiverWallet.submitTransaction(finalizedDustTx);
    logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);

    await utils.waitForSyncFacade(receiverWallet);

    const receiverStateAfterRegistration = await utils.waitForStateAfterDustRegistration(
      receiverWallet,
      finalizedDustTx,
    );

    const nightBalanceAfterRegistration = receiverStateAfterRegistration.unshielded.balances[unshieldedTokenRaw];
    expect(nightBalanceAfterRegistration).toBe(finalUnshieldedBalance);
  };

  test(
    'Able to register Night tokens for Dust generation after receiving unshielded tokens @healthcheck',
    async () => {
      await sendAndRegisterNightUtxos();
      const initialWalletState = await utils.waitForSyncFacade(receiverWallet);
      const receiverDustBalance = await rx.firstValueFrom(
        receiverWallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.walletBalance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.walletBalance(new Date()) > 1000n),
          rx.map((s) => s.dust.walletBalance(new Date())),
        ),
      );

      expect(receiverDustBalance).toBeGreaterThan(0n);
      await rx.firstValueFrom(
        receiverWallet.state().pipe(
          rx.tap((s) => {
            const registeredTokens = s.unshielded.availableCoins.filter(
              (coin) => coin.meta.registeredForDustGeneration === true,
            );
            logger.info(`registered tokens: ${registeredTokens.length}`);
          }),
          rx.filter(
            (s) =>
              s.unshielded.availableCoins.filter((coin) => coin.meta.registeredForDustGeneration === true).length > 0,
          ),
        ),
      );
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

      const initialWalletState = await utils.waitForSyncFacade(receiverWallet);

      const registerdNightUtxosBeforeRegister = initialWalletState.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );

      if (registerdNightUtxosBeforeRegister.length === 0) {
        logger.info('No registered night UTXOs found, registering now...');
        await sendAndRegisterNightUtxos();
        // Wait for registered tokens
        await rx.firstValueFrom(
          receiverWallet.state().pipe(
            rx.tap((s) => {
              const registeredTokens = s.unshielded.availableCoins.filter(
                (coin) => coin.meta.registeredForDustGeneration === true,
              );
              logger.info(`registered tokens: ${registeredTokens.length}`);
            }),
            rx.filter(
              (s) =>
                s.unshielded.availableCoins.filter((coin) => coin.meta.registeredForDustGeneration === true).length > 0,
            ),
          ),
        );
      }

      const walletStateBeforeDeregister = await utils.waitForSyncFacade(receiverWallet);
      const initialNightBalance = walletStateBeforeDeregister.unshielded.balances[unshieldedTokenRaw];
      logger.info(`Initial Night Balance: ${initialNightBalance}`);

      const initialDustBalance = walletStateBeforeDeregister.dust.walletBalance(new Date());
      logger.info(`Initial Dust Balance: ${initialDustBalance}`);

      const registeredNightUtxos = initialWalletState.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );
      expect(registeredNightUtxos.length).toBeGreaterThan(0);

      const deregisterTokens = 2;
      const dustDeregistrationRecipe = await receiverWallet.deregisterFromDustGeneration(
        registeredNightUtxos.slice(0, deregisterTokens),
        receiverKeystore.getPublicKey(),
        (payload) => receiverKeystore.signData(payload),
      );

      const balancedTransactionRecipe = await receiverWallet.balanceUnprovenTransaction(
        receiverWalletSecretKey,
        receiverWalletDustSecretKey,
        dustDeregistrationRecipe.transaction,
        new Date(Date.now() + 30 * 60 * 1000),
      );

      const finalizedDustTx = await receiverWallet.finalizeRecipe(balancedTransactionRecipe);
      const dustDeregistrationTxid = await receiverWallet.submitTransaction(finalizedDustTx);
      logger.info(`Dust de-registration tx id: ${dustDeregistrationTxid}`);

      const walletStateAfterDeregister = await utils.waitForSyncFacade(receiverWallet);

      const finalDustBalance = await rx.firstValueFrom(
        receiverWallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.walletBalance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.walletBalance(new Date()) == 0n),
          rx.map((s) => s.dust.walletBalance(new Date())),
        ),
      );

      expect(finalDustBalance).toBe(0n);

      const finalWalletNightBalance = walletStateAfterDeregister.unshielded.balances[unshieldedTokenRaw];
      expect(finalWalletNightBalance).toBe(initialNightBalance);
    },
    timeout,
  );

  test.skip(
    // skipping due to PM-21005
    'Able to spend all unshielded tokens with generated Dust',
    async () => {
      await sendAndRegisterNightUtxos();
      // Wait for dust balance to be generated
      const initialWalletState = await rx.firstValueFrom(
        receiverWallet.state().pipe(
          rx.debounceTime(10_000),
          rx.tap((s) => {
            const registeredTokens = s.unshielded.availableCoins.filter(
              (coin) => coin.meta.registeredForDustGeneration === true,
            );
            logger.info(`registered tokens: ${registeredTokens.length}`);
            const dustBalance = s.dust.walletBalance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.walletBalance(new Date()) > s.unshielded.balances[unshieldedTokenRaw] * 5n),
        ),
      );

      const initialUnshieldedBalance = initialWalletState.unshielded.balances[unshieldedTokenRaw];
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);

      const initialFundedState = await utils.waitForSyncFacade(walletFunded);
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'unshielded',
          outputs: [
            {
              amount: initialUnshieldedBalance,
              receiverAddress: UnshieldedAddress.codec
                .encode(fixture.getNetworkId(), initialFundedState.unshielded.address)
                .asString(),
              type: ledger.unshieldedToken().raw,
            },
          ],
        },
      ];
      const ttl = new Date(Date.now() + 30 * 60 * 1000);
      const txToProveRecipe = await receiverWallet.transferTransaction(
        receiverWalletSecretKey,
        receiverWalletDustSecretKey,
        outputsToCreate,
        ttl,
      );
      const signedRecipe = await receiverWallet.signRecipe(txToProveRecipe, (payload) =>
        receiverKeystore.signData(payload),
      );
      const provenTx = await receiverWallet.finalizeRecipe(signedRecipe);
      const txId = await receiverWallet.submitTransaction(provenTx);
      expect(txId).toBeDefined();
      logger.info('Transaction id: ' + txId);
      await utils.waitForFacadePendingClear(receiverWallet);
      const finalReceiverState = await utils.waitForSyncFacade(receiverWallet);
      const finalUnshieldedBalance = finalReceiverState.unshielded.balances[unshieldedTokenRaw];
      expect(finalUnshieldedBalance).toBe(0n);
      logger.info(`Final unshielded balance: ${finalUnshieldedBalance}`);
      logger.info(inspect(finalReceiverState.unshielded.availableCoins, { depth: null }));
    },
    timeout,
  );

  test.skip(
    'Able to spend all shielded tokens',
    async () => {
      await sendAndRegisterNightUtxos();
      // Wait for dust balance to be generated
      const initialWalletState = await rx.firstValueFrom(
        receiverWallet.state().pipe(
          rx.tap((s) => {
            const registeredTokens = s.unshielded.availableCoins.filter(
              (coin) => coin.meta.registeredForDustGeneration === true,
            );
            logger.info(`registered tokens: ${registeredTokens.length}`);
            const dustBalance = s.dust.walletBalance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter(
            (s) =>
              s.unshielded.availableCoins.filter((coin) => coin.meta.registeredForDustGeneration === true).length > 0,
          ),
          rx.filter((s) => s.dust.walletBalance(new Date()) > 1000n),
        ),
      );

      const initialshieldedBalance = initialWalletState.shielded.balances[shieldedTokenRaw];
      logger.info(`Wallet 1: ${initialshieldedBalance} shielded tokens`);

      const initialFundedState = await utils.waitForSyncFacade(walletFunded);
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: initialshieldedBalance,
              receiverAddress: utils.getShieldedAddress(fixture.getNetworkId(), initialFundedState.shielded.address),
            },
          ],
        },
      ];
      const ttl = new Date(Date.now() + 30 * 60 * 1000);
      const txToProveRecipe = await receiverWallet.transferTransaction(
        receiverWalletSecretKey,
        receiverWalletDustSecretKey,
        outputsToCreate,
        ttl,
      );
      const provenTx = await receiverWallet.finalizeRecipe(txToProveRecipe);
      const txId = await receiverWallet.submitTransaction(provenTx);
      expect(txId).toBeDefined();
      logger.info('Transaction id: ' + txId);
      await utils.waitForFacadePendingClear(receiverWallet);
      const finalReceiverState = await utils.waitForSyncFacade(receiverWallet);
      const finalshieldedBalance = finalReceiverState.shielded.balances[shieldedTokenRaw];
      logger.info(`Final shielded balance: ${finalshieldedBalance}`);
      expect(finalshieldedBalance).toBe(0n);
      logger.info(inspect(finalReceiverState.shielded.availableCoins, { depth: null }));
    },
    timeout,
  );
});
