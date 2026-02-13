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
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, test, expect } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { InMemoryTransactionHistoryStorage, NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import * as allure from 'allure-js-commons';
import { ShieldedWallet, ShieldedWalletClass } from '@midnight-ntwrk/wallet-sdk-shielded';
import { CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  UnshieldedTransactionHistoryEntry,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet, DustWalletClass } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { restoreUnshieldedTransactionHistoryStorage } from '../../../unshielded-wallet/dist/v1/TransactionHistory.js';

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
  let Wallet: ShieldedWalletClass;
  let funded: utils.WalletInit;
  let receiver: utils.WalletInit;
  let Dust: DustWalletClass;

  beforeEach(async () => {
    await allure.step('Start two wallets', async function () {
      fixture = getFixture();
      Dust = DustWallet({
        ...fixture.getWalletConfig(),
        ...fixture.getDustWalletConfig(),
      });
      Wallet = ShieldedWallet(fixture.getWalletConfig());
      funded = await utils.initWalletWithSeed(seedFunded, fixture);
      receiver = await utils.initWalletWithSeed(seed, fixture);
      logger.info('Two wallets started');
    });
  });

  afterEach(async () => {
    await funded.wallet.stop();
    await receiver.wallet.stop();
  }, 20_000);

  test(
    'Valid transfer of shielded and unshielded token @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('heanthcheck');
      allure.tms('PM-8916', 'PM-8916');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer transaction');
      logger.info(`shielded token type: ${shieldedTokenRaw}`);
      logger.info(`unshielded token type: ${unshieldedTokenRaw}`);

      const balance = 2500000000000000n;
      const unshieldedFundedKeyStore = createKeystore(
        utils.getUnshieldedSeed(seedFunded),
        NetworkId.NetworkId.Undeployed,
      );
      await Promise.all([utils.waitForSyncFacade(funded.wallet), utils.waitForSyncFacade(receiver.wallet)]);
      const initialState = await utils.waitForSyncFacade(funded.wallet);
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

      const pendingState = await utils.waitForFacadePending(funded.wallet);
      expect(pendingState.shielded.totalCoins.length).toBe(7);
      expect(pendingState.unshielded.totalCoins.length).toBe(5);
      expect(pendingState.shielded.availableCoins.length).toBe(6);
      expect(pendingState.unshielded.availableCoins.length).toBe(4);

      logger.info('Waiting for finalized balance...');
      await utils.waitForFacadePendingClear(funded.wallet);
      const finalState = await utils.waitForSyncFacade(funded.wallet);
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
      const finalState2 = await utils.waitForSyncFacade(receiver.wallet);
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
    },
    timeout,
  );

  // TODO @QA - update to test the restored state properly
  // NOTE: tx history is not part of state anymore
  test(
    'Shielded wallet state can be serialized and then restored',
    async () => {
      allure.tag('smoke');
      allure.tms('PM-9084', 'PM-9084');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - serialize');
      const initialState = await utils.waitForSyncFacade(funded.wallet);
      const initialStateTxHistory = utils.getTransactionHistoryIds(initialState.shielded);
      const serialized = await funded.wallet.shielded.serializeState();
      const stateObject = JSON.parse(serialized);
      expect(Number(stateObject.offset)).toBeGreaterThan(0);
      expect(typeof stateObject.state).toBe('string');
      expect(stateObject.state).toBeTruthy();

      logger.info('Restoring wallet from serialized state...');
      const restoredWallet = Wallet.restore(serialized);
      await restoredWallet.start(funded.shieldedSecretKeys);
      try {
        const restoredState = await restoredWallet.waitForSyncedState();
        const restoredStateTxHistory = utils.getTransactionHistoryIds(restoredState);
        expect(restoredStateTxHistory).toEqual(initialStateTxHistory);
      } finally {
        await restoredWallet.stop();
      }
    },
    timeout,
  );

  test(
    'Unshielded wallet can be serialized and restored',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-11088', 'PM-11088');
      allure.epic('Headless wallet');
      allure.feature('Wallet building');
      allure.story('Building with discardTxHistory undefined');

      fixture = getFixture();
      const unshieldedTxHistoryStorage = new InMemoryTransactionHistoryStorage<UnshieldedTransactionHistoryEntry>();
      const unshieldedKeyStore = createKeystore(utils.getUnshieldedSeed(seedFunded), fixture.getNetworkId());
      const initialWallet = UnshieldedWallet({
        networkId: fixture.getNetworkId(),
        indexerClientConnection: {
          indexerHttpUrl: fixture.getIndexerUri(),
          indexerWsUrl: fixture.getIndexerWsUri(),
        },
        unshieldedTxHistoryStorage,
      }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeyStore));
      logger.info(`Waiting to sync...`);
      const initialState = await initialWallet.waitForSyncedState();
      // const syncedState = await utils.waitForSyncUnshielded(initialWallet);
      // TODO add assertion for Tx history
      const serializedState = await initialWallet.serializeState();
      const serializedTxHistory = await initialState.transactionHistory.serialize();
      await initialWallet.stop();

      const restoredTxHistory = await restoreUnshieldedTransactionHistoryStorage(serializedTxHistory, () => {
        return new InMemoryTransactionHistoryStorage<UnshieldedTransactionHistoryEntry>();
      });
      const restoredWallet = UnshieldedWallet({
        networkId: fixture.getNetworkId(),
        indexerClientConnection: {
          indexerHttpUrl: fixture.getIndexerUri(),
          indexerWsUrl: fixture.getIndexerWsUri(),
        },
        unshieldedTxHistoryStorage: new InMemoryTransactionHistoryStorage<UnshieldedTransactionHistoryEntry>(),
      }).restore(serializedState);

      await restoredWallet.start();
      const restoredState = await utils.waitForSyncUnshielded(restoredWallet);
      expect(restoredState).toBeTruthy();
      // TODO add assertion for Tx history
      await restoredWallet.stop();
    },
    timeout,
  );

  test(
    'Dust wallet can be serialized and restored',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-11088', 'PM-11088');
      allure.epic('Headless wallet');
      allure.feature('Wallet building');
      allure.story('Building with discardTxHistory undefined');

      const initialState = await utils.waitForSyncFacade(funded.wallet);
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

// describe('Wallet building', () => {
//   const getFixture = useTestContainersFixture();
//   const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
//   const rawNativeTokenType = (nativeToken() as { tag: string; raw: string }).raw;
//   const timeout = 60_000;

//   let walletFunded: ShieldedWallet;
//   let fixture: TestContainersFixture;

//   afterEach(async () => {
//     await walletFunded.stop();
//   });

//   test(
//     'Unshielded wallet is working if txHistoryStorage is not defined @healthcheck',
//     async () => {
//       allure.tag('smoke');
//       allure.tag('healthcheck');
//       allure.tms('PM-11088', 'PM-11088');
//       allure.epic('Headless wallet');
//       allure.feature('Wallet building');
//       allure.story('Building with discardTxHistory undefined');

//       fixture = getFixture();
//       const unshieldedKeyStore = createKeystore(getUnshieldedSeed(seedFunded), fixture.getNetworkId());
//       const unshieldedWallet = await WalletBuilder.build({
//         publicKey: PublicKey.fromKeyStore(unshieldedKeyStore),
//         networkId: fixture.getNetworkId(),
//         indexerUrl: fixture.getIndexerUri(),
//       });
//       logger.info(`Waiting to receive tokens...`);
//       const syncedState = await waitForSyncUnshielded(unshieldedWallet);
//       // logger.info(`Wallet 1 balance: ${syncedState.balances[rawNativeTokenType]}`);
//       // expect(syncedState.transactionHistory).toHaveLength(1);
//     },
//     timeout,
//   );

//   test(
//     'Is working if discardTxHistory is set to false @healthcheck',
//     async () => {
//       allure.tag('smoke');
//       allure.tag('healthcheck');
//       allure.tms('PM-11090', 'PM-11090');
//       allure.epic('Headless wallet');
//       allure.feature('Wallet building');
//       allure.story('Building with discardTxHistory set to false');

//       await allure.step('Start a wallet', async function () {
//         fixture = getFixture();

//         walletFunded = await WalletBuilder.build(
//           fixture.getIndexerUri(),
//           fixture.getIndexerWsUri(),
//           fixture.getProverUri(),
//           fixture.getNodeUri(),
//           seedFunded,
//           NetworkId.Undeployed,
//           'info',
//           false,
//         );

//         walletFunded.start();
//       });

//       logger.info(`Waiting to receive tokens...`);
//       const syncedState = await waitForSync(walletFunded);
//       logger.info(`Wallet 1 balance: ${syncedState.balances[nativeToken()]}`);
//       expect(syncedState.transactionHistory).toHaveLength(1);
//     },
//     timeout,
//   );

//   test(
//     'Is working if discardTxHistory is set to true @healthcheck',
//     async () => {
//       allure.tag('smoke');
//       allure.tag('healthcheck');
//       allure.tms('PM-11091', 'PM-11091');
//       allure.epic('Headless wallet');
//       allure.feature('Wallet building');
//       allure.story('Building with discardTxHistory set to true');

//       await allure.step('Start a wallet', async function () {
//         fixture = getFixture();

//         walletFunded = await WalletBuilder.build(
//           fixture.getIndexerUri(),
//           fixture.getIndexerWsUri(),
//           fixture.getProverUri(),
//           fixture.getNodeUri(),
//           seedFunded,
//           NetworkId.Undeployed,
//           'info',
//           true,
//         );

//         walletFunded.start();
//       });

//       logger.info(`Waiting to receive tokens...`);
//       const syncedState = await waitForSync(walletFunded);
//       logger.info(`Wallet 1 balance: ${syncedState.balances[nativeToken()]}`);
//       expect(syncedState.transactionHistory).toHaveLength(0);
//     },
//     timeout,
//   );
// });
