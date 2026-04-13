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
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, test, expect } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { type TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { type CombinedTokenTransfer, WalletEntrySchema } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet, type DustWalletClass } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

/**
 * Smoke tests
 *
 * @group undeployed
 */

describe('Smoke tests', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 300_000;
  const outputValue = 1_000n;

  let fixture: TestContainersFixture;
  let funded: utils.WalletInit;
  let receiver: utils.WalletInit;
  let Dust: DustWalletClass;

  beforeEach(async () => {
    fixture = getFixture();
    Dust = DustWallet({
      ...fixture.getWalletConfig(),
      ...fixture.getDustWalletConfig(),
    });
    funded = await utils.initWalletWithSeed(seedFunded, fixture);
    receiver = await utils.initWalletWithSeed(seed, fixture);
    logger.info('Two wallets started');
  });

  afterEach(async () => {
    await funded.wallet.stop();
    await receiver.wallet.stop();
  }, 20_000);

  test(
    'Valid transfer of shielded and unshielded token @healthcheck',
    async () => {
      logger.info(`shielded token type: ${shieldedTokenRaw}`);
      logger.info(`unshielded token type: ${unshieldedTokenRaw}`);

      const balance = 250000000000000n;
      const unshieldedFundedKeyStore = createKeystore(
        utils.getUnshieldedSeed(seedFunded),
        NetworkId.NetworkId.Undeployed,
      );
      await utils.waitForBlockAdvancement(fixture.getIndexerUri());
      await Promise.all([funded.wallet.waitForSyncedState(), receiver.wallet.waitForSyncedState()]);
      const initialState = await funded.wallet.waitForSyncedState();
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
      logger.info(`Wallet 1: ${initialShieldedBalance} shielded tokens`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
      logger.info(`Wallet 1 total shielded coins: ${initialState.shielded.totalCoins.length}`);
      logger.info(`Wallet 1 total unshielded coins: ${initialState.unshielded.totalCoins.length}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);
      expect(initialState.shielded.balances[shieldedTokenRaw]).toBe(balance);
      expect(initialState.unshielded.balances[unshieldedTokenRaw]).toBe(balance);
      expect(Object.keys(initialState.shielded.balances)).toHaveLength(3);
      // expect(initialState.unshielded.balances.size).toBe(3);

      const initialState2 = await firstValueFrom(receiver.wallet.state());
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw];
      expect(initialBalance2).toBe(undefined);
      expect(Object.keys(initialState2.shielded.balances)).toHaveLength(0);
      expect(Object.keys(initialState.unshielded.balances)).toHaveLength(1);
      logger.info(`Wallet 2: ${initialBalance2}`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

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
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: outputValue,
              receiverAddress: initialState2.unshielded.address,
            },
          ],
        },
      ];
      const txRecipe = await funded.wallet.transferTransaction(
        outputsToCreate,
        {
          shieldedSecretKeys: funded.shieldedSecretKeys,
          dustSecretKey: funded.dustSecretKey,
        },
        {
          ttl: new Date(Date.now() + 30 * 60 * 1000),
        },
      );
      const signedTxRecipe = await funded.wallet.signRecipe(txRecipe, (payload) =>
        unshieldedFundedKeyStore.signData(payload),
      );
      const finalizedTx = await funded.wallet.finalizeRecipe(signedTxRecipe);
      const txId = await funded.wallet.submitTransaction(finalizedTx);
      logger.info('Transaction id: ' + txId);
      const txHash = finalizedTx.transactionHash();

      const pendingState = await utils.waitForFacadePending(funded.wallet);
      expect(pendingState.shielded.totalCoins.length).toBe(7);
      expect(pendingState.unshielded.totalCoins.length).toBe(5);
      expect(pendingState.shielded.availableCoins.length).toBe(6);
      expect(pendingState.unshielded.availableCoins.length).toBe(4);

      logger.info('Waiting for finalized balance...');
      await utils.waitForFacadePendingClear(funded.wallet);
      const finalState = await funded.wallet.waitForSyncedState();
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(balance - outputValue);
      expect(finalState.unshielded.balances[unshieldedTokenRaw]).toBeLessThanOrEqual(balance - outputValue);
      expect(finalState.shielded.totalCoins.length).toBe(7);
      expect(finalState.shielded.availableCoins.length).toBe(7);
      expect(finalState.unshielded.totalCoins.length).toBe(5);
      expect(finalState.unshielded.availableCoins.length).toBe(5);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.unshielded.pendingCoins.length).toBe(0);

      await utils.waitForFinalizedShieldedBalance(receiver.wallet.shielded);
      const finalState2 = await receiver.wallet.waitForSyncedState();
      const finalShieldedBalance = finalState2.shielded.balances[shieldedTokenRaw];
      const finalUnshieldedBalance = finalState2.unshielded.balances[unshieldedTokenRaw];
      logger.info(finalState2);
      logger.info(`Wallet 2 available coins: ${finalState2.shielded.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalShieldedBalance} shielded tokens`);
      logger.info(`Wallet 2: ${finalUnshieldedBalance} unshielded tokens`);
      expect(finalShieldedBalance).toBe(outputValue);
      expect(finalUnshieldedBalance).toBe(outputValue);
      expect(finalState2.shielded.availableCoins.length).toBe(1);
      expect(finalState2.unshielded.availableCoins.length).toBe(1);
      expect(finalState2.shielded.pendingCoins.length).toBe(0);
      expect(finalState2.unshielded.pendingCoins.length).toBe(0);

      // Verify unshielded transaction history
      const senderTxHistory = await Array.fromAsync(funded.wallet.getAllFromTxHistory());
      const senderUnshieldedEntries = senderTxHistory.filter((e) => e.unshielded !== undefined);
      expect(senderUnshieldedEntries.length).toBeGreaterThan(0);
      senderUnshieldedEntries.forEach((entry) => utils.expectValidUnshieldedTxHistoryEntry(entry));

      const receiverTxEntry = await receiver.wallet.queryTxHistoryByHash(txHash);
      expect(receiverTxEntry).toBeDefined();
      utils.expectReceiverUnshieldedTxHistory(receiverTxEntry!, outputValue);

      // Verify shielded transaction history
      const senderShieldedEntries = senderTxHistory.filter((e) => e.shielded !== undefined);
      expect(senderShieldedEntries.length).toBeGreaterThan(0);
      senderShieldedEntries.forEach((entry) => utils.expectValidShieldedTxHistoryEntry(entry));

      const receiverTxHistory = await Array.fromAsync(receiver.wallet.getAllFromTxHistory());
      const receiverShieldedEntries = receiverTxHistory.filter((e) => e.shielded !== undefined);
      expect(receiverShieldedEntries.length).toBeGreaterThan(0);
      receiverShieldedEntries.forEach((entry) => utils.expectValidShieldedTxHistoryEntry(entry));
      const receiverShieldedWithReceived = receiverShieldedEntries.find((e) => e.shielded!.receivedCoins.length > 0);
      expect(receiverShieldedWithReceived).toBeDefined();
      utils.expectReceiverShieldedTxHistory(receiverShieldedWithReceived!, outputValue);
    },
    timeout,
  );

  test(
    'Shielded wallet state can be serialized and then restored',
    async () => {
      await funded.wallet.waitForSyncedState();
      const serializedState = await funded.wallet.shielded.serializeState();
      const stateObject = JSON.parse(serializedState);
      expect(Number(stateObject.offset)).toBeGreaterThan(0);
      expect(typeof stateObject.state).toBe('string');
      expect(stateObject.state).toBeTruthy();

      // Verify tx history has shielded entries before serialization
      const txHistoryBeforeSerialize = await Array.fromAsync(funded.wallet.getAllFromTxHistory());
      const shieldedEntries = txHistoryBeforeSerialize.filter((e) => e.shielded !== undefined);
      expect(shieldedEntries.length).toBeGreaterThan(0);

      const walletConfig = fixture.getWalletConfig();
      const txHistoryStorage = walletConfig.txHistoryStorage;
      const serializedTxHistory = await txHistoryStorage.serialize();

      logger.info('Restoring wallet from serialized state...');
      const restoredTxHistoryStorage = InMemoryTransactionHistoryStorage.restore(
        serializedTxHistory,
        WalletEntrySchema,
      );
      const RestoredWallet = ShieldedWallet({
        ...walletConfig,
        txHistoryStorage: restoredTxHistoryStorage,
      });
      const restoredWallet = RestoredWallet.restore(serializedState);
      await restoredWallet.start(funded.shieldedSecretKeys);
      try {
        await restoredWallet.waitForSyncedState();
        const restoredSerializedTxHistory = await restoredTxHistoryStorage.serialize();
        expect(restoredSerializedTxHistory).toEqual(serializedTxHistory);
      } finally {
        await restoredWallet.stop();
      }
    },
    timeout,
  );

  test(
    'Unshielded wallet can be serialized and restored',
    async () => {
      fixture = getFixture();
      const unshieldedTxHistoryStorage = new InMemoryTransactionHistoryStorage(WalletEntrySchema);
      const unshieldedKeyStore = createKeystore(utils.getUnshieldedSeed(seedFunded), fixture.getNetworkId());
      const initialWallet = UnshieldedWallet({
        networkId: fixture.getNetworkId(),
        indexerClientConnection: {
          indexerHttpUrl: fixture.getIndexerUri(),
          indexerWsUrl: fixture.getIndexerWsUri(),
        },
        txHistoryStorage: unshieldedTxHistoryStorage,
      }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeyStore));
      await initialWallet.start();
      logger.info(`Waiting to sync...`);
      // TODO IAN - Check if this is correct
      await initialWallet.start();
      await utils.waitForSyncUnshielded(initialWallet);

      // Verify tx history has unshielded entries before serialization
      await utils.expectTxHistoryHasSection(unshieldedTxHistoryStorage, 'unshielded');

      const serializedState = await initialWallet.serializeState();
      const serializedTxHistory = await unshieldedTxHistoryStorage.serialize();
      await initialWallet.stop();

      const restoredTxHistoryStorage = InMemoryTransactionHistoryStorage.restore(
        serializedTxHistory,
        WalletEntrySchema,
      );
      const restoredWallet = UnshieldedWallet({
        networkId: fixture.getNetworkId(),
        indexerClientConnection: {
          indexerHttpUrl: fixture.getIndexerUri(),
          indexerWsUrl: fixture.getIndexerWsUri(),
        },
        txHistoryStorage: restoredTxHistoryStorage,
      }).restore(serializedState);

      await restoredWallet.start();
      try {
        const restoredState = await utils.waitForSyncUnshielded(restoredWallet);
        expect(restoredState).toBeTruthy();
        const restoredSerializedTxHistory = await restoredTxHistoryStorage.serialize();
        expect(restoredSerializedTxHistory).toEqual(serializedTxHistory);

        // Verify unshielded tx history entries survive serialization round-trip
        await utils.expectTxHistoryHasSection(restoredTxHistoryStorage, 'unshielded');
      } finally {
        await restoredWallet.stop();
      }
    },
    timeout,
  );

  test(
    'Dust wallet can be serialized and restored',
    async () => {
      const initialState = await funded.wallet.waitForSyncedState();
      const publicKey = initialState.dust.publicKey;
      const address = initialState.dust.address;
      const dustBalance = initialState.dust.balance(new Date(3 * 1000));
      const serialized = await funded.wallet.dust.serializeState();
      logger.info(`serializeState: ${serialized}`);
      const stateObject = JSON.parse(serialized);
      expect(stateObject.publicKey.publicKey).toContain(publicKey);
      expect(stateObject.state).toBeTruthy();
      expect(stateObject.networkId).toBe(NetworkId.NetworkId.Undeployed);

      logger.info('Restoring wallet from serialized state...');
      const restoredWallet = Dust.restore(serialized);
      await restoredWallet.start(funded.dustSecretKey);
      const restoredState = await restoredWallet.waitForSyncedState();
      logger.info(restoredState);
      expect(restoredState.publicKey).toBe(publicKey);
      expect(restoredState.address.equals(address)).toBe(true);
      expect(restoredState.balance(new Date(3 * 1000))).toBe(dustBalance);
      await restoredWallet.stop();
    },
    timeout,
  );
});
