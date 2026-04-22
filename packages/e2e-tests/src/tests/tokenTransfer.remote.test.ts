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
import { firstValueFrom } from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { type NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { exit } from 'node:process';
import { logger } from './logger.js';
import { type CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';
import { inspect } from 'node:util';

/**
 * Tests performing a token transfer
 *
 * @group devnet
 * @group testnet
 */

describe('Token transfer', () => {
  if (process.env['SEED2'] === undefined || process.env['SEED'] === undefined) {
    logger.info('SEED or SEED2 env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const seed = process.env['SEED2'];
  const seedFunded = process.env['SEED'];
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const syncTimeout = 60 * 60 * 1000; //  60 minutes in milliseconds
  const timeout = 600_000;
  const outputValue = utils.tNightAmount(10n);
  const filenameWallet = `${seedFunded.substring(0, 7)}-${TestContainersFixture.network}.state`;
  const filenameWallet2 = `${seed.substring(0, 7)}-${TestContainersFixture.network}.state`;

  let sender: utils.WalletInit;
  let receiver: utils.WalletInit;
  let wallet: utils.WalletInit;
  let wallet2: utils.WalletInit;
  let fixture: TestContainersFixture;
  let networkId: NetworkId.NetworkId;

  beforeEach(async () => {
    fixture = getFixture();
    networkId = fixture.getNetworkId();

    wallet = await utils.provideWallet(filenameWallet, seedFunded, fixture);
    wallet2 = await utils.provideWallet(filenameWallet2, seed, fixture);
    logger.info('Two wallets started');

    const [state1, state2] = await Promise.all([
      wallet.wallet.waitForSyncedState(),
      wallet2.wallet.waitForSyncedState(),
    ]);
    const balance1 = state1.shielded.balances[shieldedTokenRaw] ?? 0n;
    const balance2 = state2.shielded.balances[shieldedTokenRaw] ?? 0n;
    logger.info(`Wallet 1 shielded balance: ${balance1}, Wallet 2 shielded balance: ${balance2}`);

    if (balance1 >= balance2) {
      logger.info('Wallet 1 (SEED) has more funds — using as sender');
      sender = wallet;
      receiver = wallet2;
    } else {
      logger.info('Wallet 2 (SEED2) has more funds — using as sender');
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
    'Is working for valid transfer @healthcheck',
    async () => {
      await Promise.all([sender.wallet.waitForSyncedState(), receiver.wallet.waitForSyncedState()]);
      const senderInitialState = await firstValueFrom(sender.wallet.state());
      const initialShieldedBalance = senderInitialState.shielded.balances[shieldedTokenRaw];
      const initialUnshieldedBalance = senderInitialState.unshielded.balances[unshieldedTokenRaw] ?? 0n;
      const initialDustBalance = senderInitialState.dust.balance(new Date());

      logger.info(`Wallet 1: ${initialShieldedBalance} shielded tokens`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(
        `Wallet 1 shielded address: ${utils.getShieldedAddress(networkId, senderInitialState.shielded.address)}`,
      );
      logger.info(`Wallet 1 available shielded coins: ${senderInitialState.shielded.availableCoins.length}`);
      logger.info(inspect(senderInitialState.shielded.availableCoins, { depth: null }));
      logger.info(`Wallet 1 available unshielded coins: ${senderInitialState.unshielded.availableCoins.length}`);
      logger.info(inspect(senderInitialState.unshielded.availableCoins, { depth: null }));
      logger.info(
        `Wallet 1 unshielded address: ${utils.getUnshieldedAddress(networkId, senderInitialState.unshielded.address)}`,
      );

      const initialReceiverState = await firstValueFrom(receiver.wallet.state());
      const initialReceiverShieldedBalance = initialReceiverState.shielded.balances[shieldedTokenRaw] ?? 0n;
      const initialReceiverUnshieldedBalance = initialReceiverState.unshielded.balances[unshieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance} shielded tokens`);
      logger.info(`Wallet 2: ${initialReceiverUnshieldedBalance} unshielded tokens`);
      logger.info(
        `Wallet 2 unshielded address: ${utils.getUnshieldedAddress(networkId, initialReceiverState.unshielded.address)}`,
      );
      logger.info(
        `Wallet 2 shielded address: ${utils.getShieldedAddress(networkId, initialReceiverState.shielded.address)}`,
      );

      const senderInitialTxHistory = await sender.wallet.getAllFromTxHistory();
      const receiverInitialTxHistory = await receiver.wallet.getAllFromTxHistory();

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: initialReceiverState.shielded.address,
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: outputValue,
              receiverAddress: initialReceiverState.unshielded.address,
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
      logger.info('Signing tx...');
      logger.info(txRecipe);
      const signedTxRecipe = await sender.wallet.signRecipe(txRecipe, (payload) =>
        sender.unshieldedKeystore.signData(payload),
      );
      logger.info('Transaction to prove...');
      logger.info(signedTxRecipe);
      const finalizedTx = await sender.wallet.finalizeRecipe(signedTxRecipe);
      logger.info('Submitting transaction...');
      logger.info(finalizedTx.toString());
      const txId = await sender.wallet.submitTransaction(finalizedTx);
      const txHash = finalizedTx.transactionHash();
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);
      logger.info('waiting for tx in history');
      const senderTxEntry = await utils.waitForTxInHistory(
        txHash,
        sender.wallet,
        (e) => e.shielded !== undefined && e.unshielded !== undefined,
      );
      const senderFinalState = await sender.wallet.waitForSyncedState();
      const senderFinalShieldedBalance = senderFinalState.shielded.balances[shieldedTokenRaw];
      const senderFinalUnshieldedBalance = senderFinalState.unshielded.balances[unshieldedTokenRaw];
      const senderFinalDustBalance = senderFinalState.dust.balance(new Date(3 * 1000));
      logger.info(`Wallet 1 final available dust: ${senderFinalDustBalance}`);
      logger.info(`Wallet 1 final available shielded coins: ${senderFinalShieldedBalance}`);
      logger.info(`Wallet 1 final available unshielded coins: ${senderFinalUnshieldedBalance}`);
      // assert balance after tx history is fixed
      expect(senderFinalShieldedBalance).toBe(initialShieldedBalance - outputValue);
      expect(senderFinalUnshieldedBalance).toBe(initialUnshieldedBalance - outputValue);
      expect(senderFinalShieldedBalance).toBeLessThan(initialShieldedBalance);
      expect(senderFinalUnshieldedBalance).toBeLessThan(initialUnshieldedBalance);
      expect(senderFinalState.shielded.availableCoins.length).toBeLessThanOrEqual(
        senderInitialState.shielded.availableCoins.length,
      );
      expect(senderFinalState.dust.pendingCoins.length).toBe(0);
      expect(senderFinalState.shielded.pendingCoins.length).toBe(0);
      expect(senderFinalState.shielded.totalCoins.length).toBeLessThanOrEqual(
        senderInitialState.shielded.totalCoins.length,
      );
      expect(senderFinalState.unshielded.pendingCoins.length).toBe(0);
      expect(senderFinalState.unshielded.availableCoins.length).toBeLessThanOrEqual(
        senderInitialState.unshielded.availableCoins.length,
      );
      expect(senderFinalState.unshielded.totalCoins.length).toBeLessThanOrEqual(
        senderInitialState.unshielded.totalCoins.length,
      );
      // Verify sender unshielded transaction history grew and contains the specific transaction
      const senderFinalTxHistory = await sender.wallet.getAllFromTxHistory();
      expect(senderFinalTxHistory.length).toBeGreaterThanOrEqual(senderInitialTxHistory.length + 1);
      utils.expectSenderShieldedTxHistory(senderTxEntry);
      utils.expectSenderUnshieldedTxHistory(senderTxEntry);

      const receiverFinalState = await receiver.wallet.waitForSyncedState();
      // logger.info(walletStateTrimmed(finalState2));
      const receiverFinalShieldedBalance = receiverFinalState.shielded.balances[shieldedTokenRaw] ?? 0n;
      const receiverFinalUnshieldedBalance = receiverFinalState.unshielded.balances[unshieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 2 final available shielded coins: ${receiverFinalShieldedBalance}`);
      logger.info(`Wallet 2 final available unshielded coins: ${receiverFinalUnshieldedBalance}`);
      expect(receiverFinalShieldedBalance).toBe(initialReceiverShieldedBalance + outputValue);
      expect(receiverFinalUnshieldedBalance).toBe(initialReceiverUnshieldedBalance + outputValue);
      expect(receiverFinalState.shielded.pendingCoins.length).toBe(0);
      expect(receiverFinalState.shielded.availableCoins.length).toBeGreaterThanOrEqual(
        initialReceiverState.shielded.availableCoins.length + 1,
      );
      expect(receiverFinalState.shielded.totalCoins.length).toBeGreaterThanOrEqual(
        initialReceiverState.shielded.totalCoins.length + 1,
      );

      // Verify receiver unshielded transaction history grew and contains the specific transaction
      const receiverFinalTxHistory = await receiver.wallet.getAllFromTxHistory();
      expect(receiverFinalTxHistory.length).toBeGreaterThanOrEqual(receiverInitialTxHistory.length + 1);
      const receiverTxEntry = await receiver.wallet.queryTxHistoryByHash(txHash);
      expect(receiverTxEntry).toBeDefined();
      utils.expectReceiverShieldedTxHistory(receiverTxEntry!, outputValue);
      utils.expectReceiverUnshieldedTxHistory(receiverTxEntry!, outputValue);
    },
    syncTimeout,
  );

  test(
    'can perform a self-transaction',
    async () => {
      const initialState = await sender.wallet.waitForSyncedState();
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw];
      logger.info(initialState.shielded.availableCoins);
      logger.info(`Wallet 1 shielded balance: ${initialBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);

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
      logger.info('Transfer transaction...');
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
      logger.info('Transaction to prove...');
      logger.info(txRecipe);
      const finalizedTx = await sender.wallet.finalizeRecipe(txRecipe);
      logger.info('Submitting transaction...');
      logger.info(finalizedTx);
      const txId = await sender.wallet.submitTransaction(finalizedTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(sender.wallet);
      logger.info(`Wallet 1 available coins: ${pendingState.shielded.availableCoins.length}`);
      logger.info(inspect(pendingState.shielded.pendingCoins, { depth: null }));
      expect(pendingState.shielded.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);

      const txHash = finalizedTx.transactionHash();
      const txEntry = await utils.waitForTxInHistory(txHash, sender.wallet, (e) => e.shielded !== undefined);
      const finalState = await sender.wallet.waitForSyncedState();
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]}`);
      // actually deducted fees are greater - PM-7721
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialBalance);
      expect(finalState.shielded.availableCoins.length).toBe(initialState.shielded.availableCoins.length);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);

      // Self-transaction: sender has both spentCoins and receivedCoins
      utils.expectSenderShieldedTxHistory(txEntry);
      expect(txEntry.shielded!.receivedCoins.length).toBeGreaterThan(0);
    },
    timeout,
  );

  test('Able to swap shielded tokens', async () => {
    const shieldedToken1 = '0000000000000000000000000000000000000000000000000000000000000001';
    const shieldedToken2 = '0000000000000000000000000000000000000000000000000000000000000002';
    const ttl = new Date(Date.now() + 30 * 60 * 1000);

    const initialStateWallet1 = await sender.wallet.waitForSyncedState();
    const initialStateWallet2 = await receiver.wallet.waitForSyncedState();

    // Does walllet have shielded tokens to swap
    const wallet1BalanceToken1 = initialStateWallet1.shielded.balances[shieldedToken1] ?? 0n;
    const wallet1BalanceToken2 = initialStateWallet1.shielded.balances[shieldedToken2] ?? 0n;
    const wallet2BalanceToken1 = initialStateWallet2.shielded.balances[shieldedToken1] ?? 0n;
    const wallet2BalanceToken2 = initialStateWallet2.shielded.balances[shieldedToken2] ?? 0n;

    if (wallet1BalanceToken1 < 1000000n || wallet2BalanceToken2 < 1000000n) {
      logger.info('One of the wallets does not have enough shielded tokens to swap');
      return;
    }

    const swapTx = await sender.wallet.initSwap(
      { shielded: { [shieldedToken1]: 1000000n } },
      [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedToken2,
              amount: 1000000n,
              receiverAddress: initialStateWallet1.shielded.address,
            },
          ],
        },
      ],
      {
        shieldedSecretKeys: sender.shieldedSecretKeys,
        dustSecretKey: sender.dustSecretKey,
      },
      {
        ttl,
        payFees: false,
      },
    );
    const finalizedTx = await sender.wallet.finalizeRecipe(swapTx);
    const wallet1TxId = await sender.wallet.submitTransaction(finalizedTx);
    logger.info('Transaction id: ' + wallet1TxId);

    const wallet2BalancedTx = await receiver.wallet.balanceFinalizedTransaction(
      finalizedTx,
      {
        shieldedSecretKeys: receiver.shieldedSecretKeys,
        dustSecretKey: receiver.dustSecretKey,
      },
      {
        ttl,
      },
    );
    const finalizedSwapTx = await receiver.wallet.finalizeRecipe(wallet2BalancedTx);
    const wallet2TxId = await receiver.wallet.submitTransaction(finalizedSwapTx);
    logger.info('Transaction id 2: ' + wallet2TxId);

    const finalStateWallet1 = await utils.waitForFinalizedShieldedBalance(sender.wallet.shielded);
    const finalStateWallet2 = await utils.waitForFinalizedShieldedBalance(receiver.wallet.shielded);
    expect(finalStateWallet1.balances[shieldedToken1] ?? 0n).toBe(wallet1BalanceToken1 - 1000000n);
    expect(finalStateWallet1.balances[shieldedToken2] ?? 0n).toBe(wallet1BalanceToken2 + 1000000n);
    expect(finalStateWallet2.balances[shieldedToken2] ?? 0n).toBe(wallet2BalanceToken2 - 1000000n);
    expect(finalStateWallet2.balances[shieldedToken1] ?? 0n).toBe(wallet2BalanceToken1 + 1000000n);
  });

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx fails on node',
    async () => {
      const initialState = await firstValueFrom(sender.wallet.state());
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 25000000000000000n;

      const initialState2 = await firstValueFrom(receiver.wallet.state());
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw];
      if (initialBalance2 === undefined || initialBalance2 === 0n) {
        logger.info(`Waiting to receive tokens...`);
      }

      // const outputsToCreate = [
      //   {
      //     type: rawNativeTokenType,
      //     amount: outputValue,
      //     receiverAddress: initialState2.address,
      //   },
      // ];
      const coin = ledger.createShieldedCoinInfo(shieldedTokenRaw, balance);
      const output = ledger.ZswapOutput.new(
        coin,
        0,
        initialState.shielded.coinPublicKey.toHexString(),
        initialState.shielded.encryptionPublicKey.toHexString(),
      );
      const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenRaw, outputValue);
      const unprovenTx = ledger.Transaction.fromParts(networkId, offer);
      const finalizedTx = await sender.wallet.finalizeTransaction(unprovenTx);
      // const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      // const provenTx = await walletFunded.proveTransaction(txToProve);
      await expect(
        Promise.all([sender.wallet.submitTransaction(finalizedTx), sender.wallet.submitTransaction(finalizedTx)]),
      ).rejects.toThrow();
      // const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      // const provenTx = await walletFunded.proveTransaction(txToProve);
      // const id = await walletFunded.submitTransaction(provenTx);
      // logger.info('Transaction id: ' + id);

      // const pendingState = await waitForPending(walletFunded);
      // logger.info(pendingState);
      // expect(pendingState.balances[rawNativeTokenType]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(2);

      const finalState = await utils.waitForFinalizedShieldedBalance(sender.wallet.shielded);
      // const finalState = await waitForTxHistory(walletFunded, 2);
      expect(finalState.balances[shieldedTokenRaw]).toBe(balance);
      expect(finalState.availableCoins.length).toBe(5);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.totalCoins.length).toBe(5);
      // expect(finalState.transactionHistory.length).toBe(1);

      // const finalState2 = await waitForFinalizedShieldedBalance(wallet2);
      // logger.info(finalState2);
      // expect(finalState2.balances[rawNativeTokenType]).toBe(outputValue);
      // expect(finalState2.availableCoins.length).toBe(1);
      // expect(finalState2.pendingCoins.length).toBe(0);
      // expect(finalState2.coins.length).toBe(1);
      // expect(finalState2.transactionHistory.length).toBe(1);
    },
    timeout,
  );

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx does not get proved',
    async () => {
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      logger.info('Stopping proof server container..');
      await fixture.getProofServerContainer().stop({ timeout: 10_000 });

      const initialState2 = await firstValueFrom(receiver.wallet.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: initialState2.shielded.address,
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
          ttl: new Date(),
        },
      );
      await expect(sender.wallet.finalizeRecipe(txRecipe)).rejects.toThrow();
      // const pendingState = await waitForPending(walletFunded);
      // logger.info(pendingState);
      // expect(pendingState.balances[rawNativeTokenType]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(1);

      const finalState = await utils.waitForFinalizedShieldedBalance(sender.wallet.shielded);
      expect(finalState).toMatchObject(syncedState);
      // expect(finalState.balances[rawNativeTokenType]).toBe(initialBalance);
      // expect(finalState.availableCoins.length).toBe(5);
      // expect(finalState.pendingCoins.length).toBe(0);
      // expect(finalState.coins.length).toBe(5);
      // expect(finalState.transactionHistory.length).toBe(1);
    },
    timeout,
  );

  test(
    'error message when attempting to send an invalid amount',
    async () => {
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      // the max amount that we support: Rust u64 max. The entire Midnight supply
      // is 24 billion tDUST, 1 tDUST = 10^6 specks, which is lesser
      // Check below amount is still erroring with invalid transaction after rewrite
      // const invalidAmount = 18446744073709551616n;
      const aboveBalance = initialBalance + 1000n;
      const initialState2 = await firstValueFrom(receiver.wallet.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: aboveBalance,
              receiverAddress: initialState2.shielded.address,
            },
          ],
        },
      ];
      try {
        const txRecipe = await sender.wallet.transferTransaction(
          outputsToCreate,
          {
            shieldedSecretKeys: sender.shieldedSecretKeys,
            dustSecretKey: sender.dustSecretKey,
          },
          {
            ttl: new Date(),
          },
        );
        const finalizedTx = await sender.wallet.finalizeRecipe(txRecipe);
        await sender.wallet.submitTransaction(finalizedTx);
      } catch (e: unknown) {
        if (e instanceof Error) {
          expect(e.message).toContain('Insufficient funds');
        } else {
          logger.info(e);
        }
      }
    },
    timeout,
  );

  test(
    'error message when attempting to send a negative amount',
    async () => {
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(receiver.wallet.state());
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: -5n,
              receiverAddress: initialState2.shielded.address,
            },
          ],
        },
      ];
      await expect(
        sender.wallet.transferTransaction(
          outputsToCreate,
          {
            shieldedSecretKeys: sender.shieldedSecretKeys,
            dustSecretKey: sender.dustSecretKey,
          },
          {
            ttl: new Date(),
          },
        ),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting to send a zero amount',
    async () => {
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const initialState2 = await firstValueFrom(receiver.wallet.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: 0n,
              receiverAddress: initialState2.shielded.address,
            },
          ],
        },
      ];

      await expect(
        sender.wallet.transferTransaction(
          outputsToCreate,
          {
            shieldedSecretKeys: sender.shieldedSecretKeys,
            dustSecretKey: sender.dustSecretKey,
          },
          {
            ttl: new Date(),
          },
        ),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting to send an empty array of outputs',
    async () => {
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      await expect(
        sender.wallet.transferTransaction(
          [],
          {
            shieldedSecretKeys: sender.shieldedSecretKeys,
            dustSecretKey: sender.dustSecretKey,
          },
          {
            ttl: new Date(),
          },
        ),
      ).rejects.toThrow('At least one shielded or unshielded output is required.');
    },
    timeout,
  );
});
