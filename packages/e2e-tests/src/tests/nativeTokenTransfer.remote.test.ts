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
import * as rx from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { exit } from 'node:process';
import * as allure from 'allure-js-commons';
import { CombinedTokenTransfer, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

/**
 * Tests performing a token transfer
 *
 * @group devnet
 * @group testnet
 */

describe('Token transfer', () => {
  if (process.env['NT_SEED'] === undefined || process.env['NT_SEED2'] === undefined) {
    logger.info('NT_SEED or NT_SEED2 env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const receivingSeed = process.env['NT_SEED2'];
  const fundedSeed = process.env['NT_SEED'];
  const initialReceiverSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(receivingSeed));
  const initialFundedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(fundedSeed));
  const receiverDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(receivingSeed));
  const fundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(fundedSeed));
  const outputValue = 10n;
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const nativeToken1Raw = '0000000000000000000000000000000000000000000000000000000000000001';
  const nativeToken2Raw = '0000000000000000000000000000000000000000000000000000000000000002';

  let sender: WalletFacade;
  let receiver: WalletFacade;
  let wallet: WalletFacade;
  let wallet2: WalletFacade;
  let senderSecretKey: ledger.ZswapSecretKeys;
  let senderDustSecretKey: ledger.DustSecretKey;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let senderKeyStore: UnshieldedKeystore;
  let fixture: TestContainersFixture;
  let networkId: NetworkId.NetworkId;
  const syncTimeout = 30 * 60 * 1000; // 30 minutes in milliseconds
  const timeout = 600_000;

  beforeAll(async () => {
    fixture = getFixture();
    networkId = fixture.getNetworkId();

    wallet = utils.buildWalletFacade(fundedSeed, fixture);
    wallet2 = utils.buildWalletFacade(receivingSeed, fixture);

    await wallet.start(initialFundedSecretKey, fundedDustSecretKey);
    await wallet2.start(initialReceiverSecretKey, receiverDustSecretKey);

    const initialState = await utils.waitForSyncFacade(wallet);
    const initialNativeBalance = initialState.shielded.balances[nativeToken1Raw];
    logger.info(`initial balance: ${initialNativeBalance}`);

    const date = new Date();
    const hour = date.getHours();

    if (hour % 2 !== 0) {
      logger.info('Wallet 1 will be sender');
      sender = wallet;
      senderSecretKey = initialFundedSecretKey;
      senderDustSecretKey = fundedDustSecretKey;
      receiver = wallet2;
      senderKeyStore = createKeystore(utils.getUnshieldedSeed(fundedSeed), networkId);
    } else {
      logger.info('Wallet 2 will be sender');
      sender = wallet2;
      senderSecretKey = initialReceiverSecretKey;
      senderDustSecretKey = receiverDustSecretKey;
      receiver = wallet;
      senderKeyStore = createKeystore(utils.getUnshieldedSeed(receivingSeed), networkId);
    }
  }, syncTimeout);

  afterAll(async () => {
    // await utils.saveState(sender, filenameWallet);
    // await utils.saveState(receiver, filenameWallet2);
    await sender.stop();
    await receiver.stop();
    logger.info('Wallets stopped');
  }, timeout);

  test(
    'Is working for valid native token transfer @smoke @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-8933', 'PM-8933');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer transaction using bech32m address');
      await Promise.all([utils.waitForSyncFacade(sender), utils.waitForSyncFacade(receiver)]);
      const initialState = await rx.firstValueFrom(sender.state());
      const initialNative1Balance = initialState.shielded.balances[nativeToken1Raw];
      const initialNative2Balance = initialState.shielded.balances[nativeToken2Raw];
      const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
      const initialDustBalance = initialState.dust.walletBalance(new Date());
      logger.info(`Wallet 1: ${initialNative1Balance} native 1 tokens`);
      logger.info(`Wallet 1: ${initialNative2Balance} native 2 tokens`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} shielded tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);

      const initialReceiverState = await rx.firstValueFrom(receiver.state());
      const initialReceiverShieldedBalance1 = initialReceiverState.shielded.balances[nativeToken1Raw];
      const initialReceiverShieldedBalance2 = initialReceiverState.shielded.balances[nativeToken2Raw];
      const initialReceiverShieldedBalance = initialReceiverState.shielded.balances[shieldedTokenRaw];
      const initialNumAvailableShieldedCoins = initialReceiverState.shielded.availableCoins.length;
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance1} native token 1`);
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance2} native token 2`);
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance} shielded tokens`);
      logger.info(`Wallet 2 available shielded coins: ${initialNumAvailableShieldedCoins}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeToken1Raw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(networkId, initialReceiverState.shielded.address),
            },
            {
              type: nativeToken2Raw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(networkId, initialReceiverState.shielded.address),
            },
          ],
        },
      ];

      const txToProve = await sender.transferTransaction(
        senderSecretKey,
        senderDustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      const provenTx = await sender.finalizeTransaction(txToProve);
      const txId = await sender.submitTransaction(provenTx);
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);

      // const pendingState = await utils.waitForFacadePending(sender);
      // expect(pendingState.shielded.balances[nativeToken1Raw] ?? 0n).toBeLessThanOrEqual(
      //   initialNative1Balance - outputValue,
      // );
      // expect(pendingState.shielded.balances[nativeToken2Raw] ?? 0n).toBeLessThanOrEqual(
      //   initialNative2Balance - outputValue,
      // );
      // expect(pendingState.shielded.availableCoins.length).toBeLessThanOrEqual(
      //   initialState.shielded.availableCoins.length,
      // );
      // expect(pendingState.shielded.pendingCoins.length).toBeGreaterThanOrEqual(1);
      // expect(pendingState.unshielded.pendingCoins.length).toBe(0);
      // expect(pendingState.dust.pendingCoins.length).toBeGreaterThanOrEqual(1);

      // logger.info('waiting for tx in history');
      // await utils.waitForFacadePendingClear(sender);
      await rx.firstValueFrom(
        receiver.state().pipe(
          rx.tap((state) => {
            const currentNumAvailableCoins = state.shielded.availableCoins.length;
            logger.info(
              `Shielded available coins: ${currentNumAvailableCoins}, waiting for more than ${initialNumAvailableShieldedCoins}...`,
            );
          }),
          rx.debounceTime(10_000),
          rx.filter((s) => s.isSynced),
          rx.filter((s) => s.shielded.availableCoins.length > initialNumAvailableShieldedCoins),
        ),
      );
      const finalState = await utils.waitForSyncFacade(sender);
      const senderFinalShieldedBalance1 = finalState.shielded.balances[nativeToken1Raw];
      const senderFinalShieldedBalance2 = finalState.shielded.balances[nativeToken2Raw];
      const senderFinalUnshieldedBalance = finalState.unshielded.balances[unshieldedTokenRaw];
      const senderFinalDustBalance = finalState.dust.walletBalance(new Date(3 * 1000));
      logger.info(`Wallet 1 final available dust: ${senderFinalDustBalance}`);
      logger.info(`Wallet 1 final available shielded coins: ${senderFinalShieldedBalance1}`);
      logger.info(`Wallet 2 final available shielded coins: ${senderFinalShieldedBalance2}`);
      logger.info(`Wallet 1 final available unshielded coins: ${senderFinalUnshieldedBalance}`);
      expect(senderFinalShieldedBalance1).toBe(initialNative1Balance - outputValue);
      expect(senderFinalShieldedBalance2).toBe(initialNative2Balance - outputValue);
      expect(senderFinalUnshieldedBalance).toBe(initialUnshieldedBalance);
      expect(finalState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(finalState.dust.pendingCoins.length).toBe(0);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBeLessThanOrEqual(initialState.shielded.totalCoins.length);
      expect(finalState.unshielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.unshielded.availableCoins.length,
      );
      expect(finalState.unshielded.pendingCoins.length).toBe(0);
      expect(finalState.unshielded.totalCoins.length).toBeLessThanOrEqual(initialState.shielded.totalCoins.length);

      const finalState2 = await utils.waitForSyncFacade(receiver);
      const receiverFinalShieldedBalance1 = finalState2.shielded.balances[nativeToken1Raw];
      const receiverFinalShieldedBalance2 = finalState2.shielded.balances[nativeToken2Raw];
      const receiverFinalShieldedBalance = finalState2.shielded.balances[shieldedTokenRaw];
      logger.info(`Wallet 2 final available shielded coins: ${receiverFinalShieldedBalance1}`);
      logger.info(`Wallet 2 final available shielded coins: ${receiverFinalShieldedBalance2}`);
      logger.info(`Wallet 2 final available shielded coins: ${receiverFinalShieldedBalance}`);
      expect(receiverFinalShieldedBalance1).toBe(initialReceiverShieldedBalance1 + outputValue);
      expect(receiverFinalShieldedBalance2).toBe(initialReceiverShieldedBalance2 + outputValue);
      expect(receiverFinalShieldedBalance).toBe(initialReceiverShieldedBalance);
      expect(finalState2.shielded.pendingCoins.length).toBe(0);
      expect(finalState2.shielded.totalCoins.length).toBeGreaterThanOrEqual(
        initialReceiverState.shielded.totalCoins.length + 1,
      );
    },
    syncTimeout,
  );

  test(
    'can perform a self-transaction',
    async () => {
      allure.tag('smoke');
      allure.tms('PM-9680', 'PM-9680');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer self-transaction');

      const initialState = await utils.waitForSyncFacade(sender);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw];
      logger.info(initialState.shielded.availableCoins);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(networkId, initialState.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await sender.transferTransaction(
        senderSecretKey,
        senderDustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      const provenTx = await sender.finalizeTransaction(txToProve);
      const txId = await sender.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      await utils.waitForFacadePending(sender);
      await utils.waitForFacadePendingClear(sender);
      const finalState = await utils.waitForSyncFacade(sender);
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]}`);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialBalance);
      expect(finalState.shielded.availableCoins.length).toBe(initialState.shielded.availableCoins.length);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);
    },
    syncTimeout,
  );

  // test.skip(
  //   'coins become available when native token tx fails on node @smoke',
  //   async () => {
  //     allure.tag('smoke');
  //     allure.tms('PM-8936', 'PM-8936');
  //     allure.epic('Headless wallet');
  //     allure.feature('Transactions');
  //     allure.story('Invalid native token transaction');
  //     const initialState = await firstValueFrom(sender.state());
  //     const syncedState = await utils.waitForSyncShielded(sender.shielded);
  //     const initialDustBalance = syncedState?.balances[rawNativeTokenType] ?? 0n;
  //     Object.entries(initialState.shielded.balances).forEach(([key, _]) => {
  //       if (key !== rawNativeTokenType) tokenTypeHash = key;
  //     });
  //     if (tokenTypeHash === undefined) {
  //       throw new Error('No native tokens found');
  //     }
  //     const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
  //     logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
  //     logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

  //     const syncedState2 = await utils.waitForSyncShielded(receiver.shielded);
  //     const initialDustBalance2 = syncedState2?.balances[rawNativeTokenType] ?? 0n;
  //     const initialBalance2 = syncedState2?.balances[tokenTypeHash] ?? 0n;
  //     logger.info(`Wallet 1 balance is: ${initialDustBalance2} tDUST`);
  //     logger.info(`Wallet 1 balance is: ${initialBalance2} ${tokenTypeHash}`);

  //     const coin = createShieldedCoinInfo(tokenTypeHash, outputValue);
  //     const output = ledger.ZswapOutput.new(
  //       coin,
  //       Segments.guaranteed,
  //       initialState.shielded.coinPublicKey.toHexString(),
  //       initialState.shielded.encryptionPublicKey.toHexString(),
  //     );
  //     const offer = ledger.ZswapOffer.fromOutput(output, rawNativeTokenType, outputValue);
  //     const unprovenTx = ledger.Transaction.fromParts(networkId, offer).eraseProofs();
  //     const provenTx = await sender.finalizeTransaction({
  //       type: 'TransactionToProve',
  //       transaction: unprovenTx,
  //     });

  //     await expect(
  //       Promise.all([sender.submitTransaction(provenTx), sender.submitTransaction(provenTx)]),
  //     ).rejects.toThrow();

  //     const finalState = await utils.waitForFinalizedShieldedBalance(sender.shielded);
  //     expect(finalState).toMatchObject(syncedState);
  //     expect(finalState.balances[rawNativeTokenType]).toBe(initialDustBalance);
  //     expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
  //     expect(finalState.availableCoins.length).toBe(syncedState.availableCoins.length);
  //     expect(finalState.pendingCoins.length).toBe(0);
  //     expect(finalState.totalCoins.length).toBe(syncedState.totalCoins.length);
  //     // expect(finalState.transactionHistory.length).toBe(syncedState.transactionHistory.length);
  //   },
  //   timeout,
  // );

  // test(
  //   'coins become available when native token tx does not get proved',
  //   async () => {
  //     allure.tms('PM-8934', 'PM-8934');
  //     allure.epic('Headless wallet');
  //     allure.feature('Transactions');
  //     allure.story('Transaction not proved');
  //     const syncedState = await waitForSyncShielded(sender.shielded);
  //     const initialDustBalance = syncedState?.balances[rawNativeTokenType] ?? 0n;
  //     Object.entries(syncedState.balances).forEach(([key, _]) => {
  //       if (key !== rawNativeTokenType) tokenTypeHash = key;
  //     });
  //     if (tokenTypeHash === undefined) {
  //       throw new Error('No native tokens found');
  //     }
  //     const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
  //     logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
  //     logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

  //     logger.info('Stopping proof server container..');
  //     await fixture.getProofServerContainer().stop({ timeout: 10_000 });

  //     const initialState2 = await firstValueFrom(receiver.state());

  //     const outputsToCreate: CombinedTokenTransfer[] = [
  //       {
  //         type: 'shielded',
  //         outputs: [
  //           {
  //             type: tokenTypeHash,
  //             amount: outputValue,
  //             receiverAddress: getShieldedAddress(networkId, initialState2.shielded.address),
  //           },
  //         ],
  //       },
  //     ];
  //     const txToProve = await sender.transferTransaction(
  //       senderSecretKey,
  //       senderDustSecretKey,
  //       outputsToCreate,
  //       new Date(),
  //     );
  //     await expect(sender.finalizeTransaction(txToProve)).rejects.toThrow();

  //     const finalState = await waitForFinalizedShieldedBalance(sender.shielded);
  //     expect(finalState).toMatchObject(syncedState);
  //     expect(finalState.balances[rawNativeTokenType]).toBe(initialDustBalance);
  //     expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
  //     expect(finalState.availableCoins.length).toBe(syncedState.availableCoins.length);
  //     expect(finalState.pendingCoins.length).toBe(0);
  //     expect(finalState.totalCoins.length).toBe(syncedState.totalCoins.length);
  //     // expect(finalState.transactionHistory.length).toBe(syncedState.transactionHistory.length);
  //   },
  //   timeout,
  // );
});
