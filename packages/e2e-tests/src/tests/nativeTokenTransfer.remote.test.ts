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
import * as rx from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { exit } from 'node:process';
import { CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';

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
  const outputValue = 10n;
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const nativeToken1Raw = '0000000000000000000000000000000000000000000000000000000000000001';
  const nativeToken2Raw = '0000000000000000000000000000000000000000000000000000000000000002';
  const filenameWallet = `${fundedSeed.substring(0, 7)}-${TestContainersFixture.network}.state`;
  const filenameWallet2 = `${receivingSeed.substring(0, 7)}-${TestContainersFixture.network}.state`;

  let sender: utils.WalletInit;
  let receiver: utils.WalletInit;
  let wallet: utils.WalletInit;
  let wallet2: utils.WalletInit;
  let fixture: TestContainersFixture;
  const syncTimeout = 60 * 60 * 1000; // 60 minutes in milliseconds
  const timeout = 600_000;

  beforeEach(async () => {
    fixture = getFixture();

    wallet = await utils.provideWallet(filenameWallet, fundedSeed, fixture);
    wallet2 = await utils.provideWallet(filenameWallet2, receivingSeed, fixture);

    const [state1, state2] = await Promise.all([
      wallet.wallet.waitForSyncedState(),
      wallet2.wallet.waitForSyncedState(),
    ]);
    const balance1 = state1.shielded.balances[nativeToken1Raw] ?? 0n;
    const balance2 = state2.shielded.balances[nativeToken1Raw] ?? 0n;
    logger.info(`Wallet 1 native token 1 balance: ${balance1}, Wallet 2 native token 1 balance: ${balance2}`);

    if (balance1 >= balance2) {
      logger.info('Wallet 1 has more native tokens — using as sender');
      sender = wallet;
      receiver = wallet2;
    } else {
      logger.info('Wallet 2 has more native tokens — using as sender');
      sender = wallet2;
      receiver = wallet;
    }
  }, syncTimeout);

  afterEach(async () => {
    await utils.saveState(wallet.wallet, filenameWallet);
    await utils.saveState(wallet2.wallet, filenameWallet2);
    await sender.wallet.stop();
    await receiver.wallet.stop();
    logger.info('Wallets stopped');
  }, timeout);

  test(
    'Is working for valid native token transfer @smoke @healthcheck',
    async () => {
      await Promise.all([sender.wallet.waitForSyncedState(), receiver.wallet.waitForSyncedState()]);
      const initialState = await rx.firstValueFrom(sender.wallet.state());
      const initialNative1Balance = initialState.shielded.balances[nativeToken1Raw];
      const initialNative2Balance = initialState.shielded.balances[nativeToken2Raw];
      const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
      const initialDustBalance = initialState.dust.balance(new Date());
      logger.info(`Wallet 1: ${initialNative1Balance} native 1 tokens`);
      logger.info(`Wallet 1: ${initialNative2Balance} native 2 tokens`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} shielded tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);

      const initialReceiverState = await rx.firstValueFrom(receiver.wallet.state());
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
              receiverAddress: initialReceiverState.shielded.address,
            },
            {
              type: nativeToken2Raw,
              amount: outputValue,
              receiverAddress: initialReceiverState.shielded.address,
            },
          ],
        },
      ];

      const txRecipe = await sender.wallet.transferTransaction(
        outputsToCreate,
        {
          shieldedSecretKeys: sender.shieldedSecretKeys,
          dustSecretKey: sender.dustSecretKey,
        },
        {
          ttl: new Date(Date.now() + 30 * 60 * 1000),
        },
      );
      logger.info(txRecipe);
      const finalizedTx = await sender.wallet.finalizeRecipe(txRecipe);
      logger.info(finalizedTx.toString());
      logger.info('Submitting tx:');
      const txId = await sender.wallet.submitTransaction(finalizedTx);
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
        receiver.wallet.state().pipe(
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
      const finalState = await sender.wallet.waitForSyncedState();
      const senderFinalShieldedBalance1 = finalState.shielded.balances[nativeToken1Raw];
      const senderFinalShieldedBalance2 = finalState.shielded.balances[nativeToken2Raw];
      const senderFinalUnshieldedBalance = finalState.unshielded.balances[unshieldedTokenRaw];
      const senderFinalDustBalance = finalState.dust.balance(new Date(3 * 1000));
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

      const finalState2 = await receiver.wallet.waitForSyncedState();
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
      const initialState = await sender.wallet.waitForSyncedState();
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
              receiverAddress: initialState.shielded.address,
            },
          ],
        },
      ];
      const txRecipe = await sender.wallet.transferTransaction(
        outputsToCreate,
        {
          shieldedSecretKeys: sender.shieldedSecretKeys,
          dustSecretKey: sender.dustSecretKey,
        },
        {
          ttl: new Date(Date.now() + 30 * 60 * 1000),
        },
      );
      const finalizedTx = await sender.wallet.finalizeRecipe(txRecipe);
      const txId = await sender.wallet.submitTransaction(finalizedTx);
      logger.info('Transaction id: ' + txId);

      await utils.waitForFacadePending(sender.wallet);
      await utils.waitForFacadePendingClear(sender.wallet);
      const finalState = await sender.wallet.waitForSyncedState();
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]}`);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialBalance);
      expect(finalState.shielded.availableCoins.length).toBe(initialState.shielded.availableCoins.length + 1);
      expect(finalState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length + 1);
    },
    syncTimeout,
  );
});
