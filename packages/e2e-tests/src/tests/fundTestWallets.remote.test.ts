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
import { firstValueFrom } from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { exit } from 'node:process';
import { logger } from './logger.js';
import { CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';
import { inspect } from 'node:util';

/**
 * Tests performing a token transfer
 *
 * @group devnet
 * @group testnet
 */

describe('Token transfer', () => {
  if (
    process.env['SEED2'] === undefined ||
    process.env['SEED'] === undefined ||
    process.env['SEED_STABLE'] === undefined
  ) {
    logger.info('SEED or SEED2 or SEED_STABLE env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const fundedSeed = process.env['SEED'];
  const ReceiverSeed = process.env['SEED_STABLE'];
  const StableSeed = process.env['SEED_STABLE'];
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const nativeToken1Raw = '0000000000000000000000000000000000000000000000000000000000000001';
  const nativeToken2Raw = '0000000000000000000000000000000000000000000000000000000000000002';
  const syncTimeout = (1 * 60 + 30) * 60 * 1000; // 1 hour + 30 minutes in milliseconds
  const timeout = 600_000;
  const outputValue = utils.tNightAmount(10n);

  let sender: utils.WalletInit;
  let receiver: utils.WalletInit;
  let fixture: TestContainersFixture;
  let networkId: NetworkId.NetworkId;

  beforeAll(async () => {
    fixture = getFixture();
    networkId = fixture.getNetworkId();

    sender = await utils.initWalletWithSeed(fundedSeed, fixture);
    receiver = await utils.initWalletWithSeed(ReceiverSeed, fixture);
    logger.info('Two wallets started');
  }, syncTimeout);

  afterAll(async () => {
    await sender.wallet.stop();
    await receiver.wallet.stop();
  }, timeout);

  test(
    'Distributing tokens to test wallet',
    async () => {
      await Promise.all([utils.waitForSyncFacade(sender.wallet), utils.waitForSyncFacade(receiver.wallet)]);
      const initialState = await firstValueFrom(sender.wallet.state());
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
      const initialDustBalance = initialState.dust.walletBalance(new Date());

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
      const receiverUnshieldedAddress = utils.getUnshieldedAddress(networkId, initialReceiverState.unshielded.address);
      logger.info(`Receiver unshielded address: ${receiverUnshieldedAddress}`);
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance} shielded tokens`);
      logger.info(`Wallet 2: ${initialReceiverUnshieldedBalance} unshielded tokens`);
      logger.info(`Wallet 2 address: ${receiverUnshieldedAddress}`);
      logger.info(inspect(initialReceiverState.shielded.availableCoins, { depth: null }));
      logger.info(inspect(initialReceiverState.unshielded.availableCoins, { depth: null }));

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(networkId, initialReceiverState.shielded.address),
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: outputValue,
              receiverAddress: receiverUnshieldedAddress,
            },
          ],
        },
      ];

      const txToProve = await sender.wallet.transferTransaction(
        sender.shieldedSecretKeys,
        sender.dustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      logger.info('Signing tx...');
      logger.info(txToProve);
      const signedTx = await sender.wallet.signTransaction(txToProve.transaction, (payload) =>
        sender.unshieldedKeystore.signData(payload),
      );
      logger.info('Transaction to prove...');
      logger.info(signedTx.toString());
      const provenTx = await sender.wallet.finalizeTransaction({ ...txToProve, transaction: signedTx });
      logger.info('Submitting transaction...');
      logger.info(provenTx.toString());
      const txId = await sender.wallet.submitTransaction(provenTx);
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);
    },
    syncTimeout,
  );

  test(
    'Is working for preparing the stable wallet',
    async () => {
      const nativeToken1Amount = utils.tNightAmount(25n);
      const nativeToken2Amount = utils.tNightAmount(50n);

      const stable = await utils.initWalletWithSeed(StableSeed, fixture);

      await Promise.all([utils.waitForSyncFacade(sender.wallet), utils.waitForSyncFacade(stable.wallet)]);
      const initialState = await firstValueFrom(sender.wallet.state());
      const initialNativeToken1Balance = initialState.shielded.balances[nativeToken1Raw];
      const initialNativeToken2Balance = initialState.shielded.balances[nativeToken2Raw];
      const initialDustBalance = initialState.dust.walletBalance(new Date());

      logger.info(`Wallet 1: ${initialNativeToken1Balance} native 1 tokens`);
      logger.info(`Wallet 1: ${initialNativeToken2Balance} native 2 tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(inspect(initialState.shielded.availableCoins, { depth: null }));
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);

      const initialReceiverState = await firstValueFrom(stable.wallet.state());
      const initialReceiverNativeToken1Balance = initialReceiverState.shielded.balances[nativeToken1Raw];
      const initialReceiverNativeToken2Balance = initialReceiverState.shielded.balances[nativeToken2Raw];
      const receiverShieldedAddress = utils.getShieldedAddress(networkId, initialReceiverState.shielded.address);
      logger.info(`Receiver shielded address: ${receiverShieldedAddress}`);
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

      const txToProve = await sender.wallet.transferTransaction(
        sender.shieldedSecretKeys,
        sender.dustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      logger.info('Signing tx...');
      logger.info(txToProve);
      const signedTx = await sender.wallet.signTransaction(txToProve.transaction, (payload) =>
        sender.unshieldedKeystore.signData(payload),
      );
      logger.info('Transaction to prove...');
      logger.info(signedTx.toString());
      const provenTx = await sender.wallet.finalizeTransaction({ ...txToProve, transaction: signedTx });
      logger.info('Submitting transaction...');
      logger.info(provenTx.toString());
      const txId = await sender.wallet.submitTransaction(provenTx);
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);

      await utils.waitForFacadePendingClear(sender.wallet);
      await utils.waitForFacadePendingClear(stable.wallet);
      const finalReceiverState = await firstValueFrom(stable.wallet.state());
      expect(finalReceiverState.shielded.balances[nativeToken1Raw]).toBe(nativeToken1Amount);
      expect(finalReceiverState.shielded.balances[nativeToken2Raw]).toBe(nativeToken2Amount);
    },
    timeout,
  );
});
