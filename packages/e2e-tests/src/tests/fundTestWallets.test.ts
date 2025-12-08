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
import { CombinedTokenTransfer, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
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
  const ReceiverSeed = process.env['SEED2'];
  const StableSeed = process.env['SEED_STABLE'];
  const initialReceiverShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(ReceiverSeed));
  const initialFundedShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(fundedSeed));
  const initialReceiverDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(ReceiverSeed));
  const initialFundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(fundedSeed));
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const nativeToken1Raw = '0000000000000000000000000000000000000000000000000000000000000001';
  const nativeToken2Raw = '0000000000000000000000000000000000000000000000000000000000000002';
  const syncTimeout = (1 * 60 + 30) * 60 * 1000; // 1 hour + 30 minutes in milliseconds
  const timeout = 600_000;
  const outputValue = utils.tNightAmount(10n);

  let sender: WalletFacade;
  let receiver: WalletFacade;
  let senderKeyStore: UnshieldedKeystore;
  let fixture: TestContainersFixture;
  let networkId: NetworkId.NetworkId;

  beforeAll(async () => {
    fixture = getFixture();
    networkId = fixture.getNetworkId();
    senderKeyStore = createKeystore(utils.getUnshieldedSeed(fundedSeed), networkId);

    sender = await utils.buildWalletFacade(fundedSeed, fixture);
    receiver = await utils.buildWalletFacade(ReceiverSeed, fixture);
    await sender.start(initialFundedShieldedSecretKey, initialFundedDustSecretKey);
    await receiver.start(initialReceiverShieldedSecretKey, initialReceiverDustSecretKey);
    logger.info('Two wallets started');
    logger.info(`shielded token type: ${shieldedTokenRaw}`);
    logger.info(`unshielded token type: ${unshieldedTokenRaw}`);
  }, syncTimeout);

  afterAll(async () => {
    await utils.closeWallet(sender);
    await utils.closeWallet(receiver);
  }, timeout);

  test.only(
    'Distributing tokens to test wallet',
    async () => {
      await Promise.all([utils.waitForSyncFacade(sender), utils.waitForSyncFacade(receiver)]);
      const initialState = await firstValueFrom(sender.state());
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialUnshieldedBalance = initialState.unshielded.balances.get(unshieldedTokenRaw) ?? 0n;
      const initialDustBalance = initialState.dust.walletBalance(new Date());

      logger.info(`Wallet 1: ${initialShieldedBalance} shielded tokens`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(inspect(initialState.shielded.availableCoins, { depth: null }));
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);
      logger.info(inspect(initialState.unshielded.availableCoins, { depth: null }));
      logger.info(`Wallet 1 address: ${initialState.unshielded.address}`);

      const initialReceiverState = await firstValueFrom(receiver.state());
      const initialReceiverShieldedBalance = initialReceiverState.shielded.balances[shieldedTokenRaw] ?? 0n;
      const initialReceiverUnshieldedBalance = initialReceiverState.unshielded.balances.get(unshieldedTokenRaw) ?? 0n;
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance} shielded tokens`);
      logger.info(`Wallet 2: ${initialReceiverUnshieldedBalance} unshielded tokens`);
      logger.info(`Wallet 2 address: ${initialReceiverState.unshielded.address}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue + 1n,
              receiverAddress: utils.getShieldedAddress(networkId, initialReceiverState.shielded.address),
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: outputValue + 1n,
              receiverAddress: initialReceiverState.unshielded.address,
            },
          ],
        },
      ];

      const txToProve = await sender.transferTransaction(
        initialFundedShieldedSecretKey,
        initialFundedDustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      logger.info('Signing tx...');
      logger.info(txToProve);
      const signedTx = await sender.signTransaction(txToProve.transaction, (payload) =>
        senderKeyStore.signData(payload),
      );
      logger.info('Transaction to prove...');
      logger.info(signedTx.toString());
      const provenTx = await sender.finalizeTransaction({ ...txToProve, transaction: signedTx });
      logger.info('Submitting transaction...');
      logger.info(provenTx.toString());
      const txId = await sender.submitTransaction(provenTx);
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
      const stableWalletShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(StableSeed));
      const stableWalletDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(StableSeed));

      const stableWallet = await utils.buildWalletFacade(StableSeed, fixture);
      await stableWallet.start(stableWalletShieldedSecretKey, stableWalletDustSecretKey);

      await Promise.all([utils.waitForSyncFacade(sender), utils.waitForSyncFacade(stableWallet)]);
      const initialState = await firstValueFrom(sender.state());
      const initialNativeToken1Balance = initialState.shielded.balances[nativeToken1Raw];
      const initialNativeToken2Balance = initialState.shielded.balances[nativeToken2Raw];
      const initialDustBalance = initialState.dust.walletBalance(new Date());

      logger.info(`Wallet 1: ${initialNativeToken1Balance} native 1 tokens`);
      logger.info(`Wallet 1: ${initialNativeToken2Balance} native 1 tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(inspect(initialState.shielded.availableCoins, { depth: null }));
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);

      const initialReceiverState = await firstValueFrom(stableWallet.state());
      const initialReceiverShieldedBalance = initialReceiverState.shielded.balances[shieldedTokenRaw] ?? 0n;
      const initialReceiverUnshieldedBalance = initialReceiverState.unshielded.balances.get(unshieldedTokenRaw) ?? 0n;
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance} shielded tokens`);
      logger.info(`Wallet 2: ${initialReceiverUnshieldedBalance} unshielded tokens`);
      logger.info(`Wallet 2 address: ${initialReceiverState.unshielded.address}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeToken1Raw,
              amount: nativeToken1Amount,
              receiverAddress: utils.getShieldedAddress(networkId, initialReceiverState.shielded.address),
            },
            {
              type: nativeToken2Raw,
              amount: nativeToken2Amount,
              receiverAddress: utils.getShieldedAddress(networkId, initialReceiverState.shielded.address),
            },
          ],
        },
      ];

      const txToProve = await sender.transferTransaction(
        initialFundedShieldedSecretKey,
        initialFundedDustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      logger.info('Signing tx...');
      logger.info(txToProve);
      const signedTx = await sender.signTransaction(txToProve.transaction, (payload) =>
        senderKeyStore.signData(payload),
      );
      logger.info('Transaction to prove...');
      logger.info(signedTx.toString());
      const provenTx = await sender.finalizeTransaction({ ...txToProve, transaction: signedTx });
      logger.info('Submitting transaction...');
      logger.info(provenTx.toString());
      const txId = await sender.submitTransaction(provenTx);
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);

      await utils.waitForFacadePendingClear(sender);
      await utils.waitForFacadePendingClear(stableWallet);
      const finalReceiverState = await firstValueFrom(stableWallet.state());
      expect(finalReceiverState.shielded.balances[nativeToken1Raw] ?? 0n).toBe(nativeToken1Amount);
      expect(finalReceiverState.shielded.balances[nativeToken2Raw] ?? 0n).toBe(nativeToken2Amount);
    },
    timeout,
  );
});
