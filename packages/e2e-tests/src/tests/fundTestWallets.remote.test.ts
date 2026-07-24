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
import { type TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnightntwrk/ledger-v9';
import { type NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { exit } from 'node:process';
import { randomBytes } from 'node:crypto';
import { logger } from './logger.js';
import { type CombinedTokenTransfer } from '@midnightntwrk/wallet-sdk-facade';
import { inspect } from 'node:util';

/** Tests performing a token transfer */

// Purpose of this script is to setup up the test wallets used for remote tests.
// SEED should be a wallet with funds e.g. faucet wallet
// The receiver wallet is generated fresh each run (a random hex seed, logged in beforeAll) so a new
// funded test wallet can be provisioned and its seed captured from the logs — no SEED2 required.
describe('Set up test wallet', () => {
  if (process.env['SEED'] === undefined) {
    logger.info('SEED env var not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const fundedSeed = process.env['SEED'];
  // Fresh random receiver wallet; its seed is logged so it can be reused as a provisioned test wallet.
  // const ReceiverSeed = randomBytes(32).toString('hex');
  const ReceiverSeed = process.env['SEED2'] ?? randomBytes(32).toString('hex');
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const nativeToken1Raw = '0000000000000000000000000000000000000000000000000000000000000001';
  const nativeToken2Raw = '0000000000000000000000000000000000000000000000000000000000000002';
  const syncTimeout = (1 * 60 + 30) * 60 * 1000; // 1 hour + 30 minutes in milliseconds
  const timeout = 600_000;
  const outputValue = utils.tNightAmount(10n);
  // The receiver must self-fund its dust registration from the grace-period dust its Night UTxO
  // projects; that fee (~0.3 DUST) accrues at ~35,900 / tNight seconds, so the registerable Night
  // must be a large single UTxO (well above the ~600 tNight floor) to self-fund in reasonable time.
  const receiverNightFunding = utils.tNightAmount(5000n);

  let sender: utils.WalletInit;
  let receiver: utils.WalletInit;
  let fixture: TestContainersFixture;
  let networkId: NetworkId.NetworkId;

  beforeAll(async () => {
    fixture = getFixture();
    networkId = fixture.getNetworkId();

    sender = await utils.initWalletWithSeed(fundedSeed, fixture);
    receiver = await utils.initWalletWithSeed(ReceiverSeed, fixture);
    logger.info(`Generated receiver wallet seed (save this to reuse the provisioned wallet): ${ReceiverSeed}`);
    logger.info('Two wallets started');
  }, syncTimeout);

  afterAll(async () => {
    await sender.wallet.stop();
    await receiver.wallet.stop();
  }, timeout);

  test(
    'Distributing tokens to test wallet',
    async () => {
      await Promise.all([sender.wallet.waitForSyncedState(), receiver.wallet.waitForSyncedState()]);
      const initialState = await firstValueFrom(sender.wallet.state());
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
      const initialDustBalance = initialState.dust.balance(new Date());

      logger.info(`Wallet 1: ${initialShieldedBalance} shielded tokens`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(inspect(initialState.shielded.availableCoins, { depth: null }));
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);
      logger.info(inspect(initialState.unshielded.availableCoins, { depth: null }));
      logger.info(`Wallet 1 address: ${utils.getUnshieldedAddress(networkId, initialState.unshielded.address)}`);

      const initialReceiverState = await firstValueFrom(receiver.wallet.state());
      const initialReceiverShieldedBalance = initialReceiverState.shielded.balances[shieldedTokenRaw];
      const initialReceiverUnshieldedBalance = initialReceiverState.unshielded.balances[unshieldedTokenRaw];
      const receiverUnshieldedAddress = initialReceiverState.unshielded.address;
      // logger.info(`Receiver unshielded address: ${receiverUnshieldedAddress}`);
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance} shielded tokens`);
      logger.info(`Wallet 2: ${initialReceiverUnshieldedBalance} unshielded tokens`);
      // logger.info(`Wallet 2 address: ${receiverUnshieldedAddress}`);
      logger.info(inspect(initialReceiverState.shielded.availableCoins, { depth: null }));
      logger.info(inspect(initialReceiverState.unshielded.availableCoins, { depth: null }));
      // Sending shielded and unshielded tokens to receiver wallet
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
              amount: receiverNightFunding * 1000n,
              receiverAddress: receiverUnshieldedAddress,
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: receiverNightFunding,
              receiverAddress: receiverUnshieldedAddress,
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: receiverNightFunding,
              receiverAddress: receiverUnshieldedAddress,
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: receiverNightFunding,
              receiverAddress: receiverUnshieldedAddress,
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
      const signedTxRecipe = await sender.wallet.signRecipe(txRecipe, sender.unshieldedKeystore.signDataAsync);
      logger.info('Transaction to prove...');
      logger.info(signedTxRecipe.type.toString());
      const finalizedTx = await sender.wallet.finalizeRecipe(signedTxRecipe);
      logger.info('Submitting transaction...');
      logger.info(finalizedTx.toString());
      const txId = await sender.wallet.submitTransaction(finalizedTx);
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);

      // Register unshielded tokens for dust generation
      await utils.waitForUnshieldedCoinUpdate(receiver.wallet, initialReceiverState.unshielded.availableCoins.length);
      const receiverStateAfterTransfer = await receiver.wallet.waitForSyncedState();
      const unregisteredNightUtxos = receiverStateAfterTransfer.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === false,
      );
      expect(unregisteredNightUtxos.length, 'No unregistered UTXOs found').toBeGreaterThan(0);
      const nightUtxoToRegister = unregisteredNightUtxos.reduce((largest, coin) =>
        coin.utxo.value > largest.utxo.value ? coin : largest,
      );

      const { fee: estimatedRegistrationFee } = await receiver.wallet.estimateRegistration([nightUtxoToRegister]);
      logger.info(`Estimated dust registration fee: ${estimatedRegistrationFee}; waiting for generated dust...`);
      await receiver.wallet.waitForGeneratedDust([nightUtxoToRegister], estimatedRegistrationFee, {
        timeoutMs: syncTimeout,
      });

      const dustRegistrationRecipe = await receiver.wallet.registerNightUtxosForDustGeneration(
        [nightUtxoToRegister],
        receiver.unshieldedKeystore.getPublicKey(),
        receiver.unshieldedKeystore.signDataAsync,
      );
      const finalizedDustTx = await receiver.wallet.finalizeRecipe(dustRegistrationRecipe);
      logger.info('Submitting dust registration transaction...');
      const dustRegistrationTxid = await receiver.wallet.submitTransaction(finalizedDustTx);
      expect(dustRegistrationTxid).toBeDefined();
      logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);
    },
    syncTimeout,
  );

  test(
    'Is working for preparing the stable wallet',
    async () => {
      const nativeToken1Amount = utils.tNightAmount(25n);
      const nativeToken2Amount = utils.tNightAmount(50n);

      await Promise.all([sender.wallet.waitForSyncedState(), receiver.wallet.waitForSyncedState()]);
      const initialState = await firstValueFrom(sender.wallet.state());
      const initialNativeToken1Balance = initialState.shielded.balances[nativeToken1Raw];
      const initialNativeToken2Balance = initialState.shielded.balances[nativeToken2Raw];
      const initialDustBalance = initialState.dust.balance(new Date());

      logger.info(`Wallet 1: ${initialNativeToken1Balance} native 1 tokens`);
      logger.info(`Wallet 1: ${initialNativeToken2Balance} native 2 tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(inspect(initialState.shielded.availableCoins, { depth: null }));
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);

      const initialReceiverState = await firstValueFrom(receiver.wallet.state());
      const initialReceiverNativeToken1Balance = initialReceiverState.shielded.balances[nativeToken1Raw];
      const initialReceiverNativeToken2Balance = initialReceiverState.shielded.balances[nativeToken2Raw];
      const receiverShieldedAddress = initialReceiverState.shielded.address;
      logger.info(`Wallet 2: ${initialReceiverNativeToken1Balance} native 1 tokens`);
      logger.info(`Wallet 2: ${initialReceiverNativeToken2Balance} native 2 tokens`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeToken1Raw,
              amount: nativeToken1Amount,
              receiverAddress: receiverShieldedAddress,
            },
            {
              type: nativeToken2Raw,
              amount: nativeToken2Amount,
              receiverAddress: receiverShieldedAddress,
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
      const signedTxRecipe = await sender.wallet.signRecipe(txRecipe, sender.unshieldedKeystore.signDataAsync);
      logger.info('Transaction to prove...');
      logger.info(signedTxRecipe);
      const finalizedTx = await sender.wallet.finalizeRecipe(signedTxRecipe);
      logger.info('Submitting transaction...');
      logger.info(finalizedTx.toString());
      const txId = await sender.wallet.submitTransaction(finalizedTx);
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);

      await utils.waitForFacadePendingClear(sender.wallet);
      await utils.waitForFacadePendingClear(receiver.wallet);
      const finalReceiverState = await firstValueFrom(receiver.wallet.state());
      expect(finalReceiverState.shielded.balances[nativeToken1Raw]).toBe(nativeToken1Amount);
      expect(finalReceiverState.shielded.balances[nativeToken2Raw]).toBe(nativeToken2Amount);
    },
    timeout,
  );
});
