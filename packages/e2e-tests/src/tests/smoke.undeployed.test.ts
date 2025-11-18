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
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import * as allure from 'allure-js-commons';
import { ShieldedWallet, ShieldedWalletClass } from '@midnight-ntwrk/wallet-sdk-shielded';
import { CombinedTokenTransfer, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  WalletBuilder as UnshieldedWalletBuilder,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { InMemoryTransactionHistoryStorage } from '../../../unshielded-wallet/dist/tx-history-storage/InMemoryTransactionHistoryStorage.js';
import { DustWallet, DustWalletClass } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

/**
 * Smoke tests
 *
 * @group undeployed
 */

describe('Smoke tests', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const fundedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seedFunded));
  const receiverWalletSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
  const fundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seedFunded));
  const receiverWalletDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seed));
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 240_000;
  const outputValue = 1_000n;

  let fixture: TestContainersFixture;
  let Wallet: ShieldedWalletClass;
  let walletFunded: WalletFacade;
  let receiverWallet: WalletFacade;
  let Dust: DustWalletClass;

  beforeEach(async () => {
    await allure.step('Start two wallets', async function () {
      fixture = getFixture();
      Dust = DustWallet(fixture.getDustWalletConfig());
      Wallet = ShieldedWallet(fixture.getWalletConfig());
      walletFunded = await utils.buildWalletFacade(seedFunded, fixture);
      receiverWallet = await utils.buildWalletFacade(seed, fixture);
      await walletFunded.start(fundedSecretKey, fundedDustSecretKey);
      await receiverWallet.start(receiverWalletSecretKey, receiverWalletDustSecretKey);
      logger.info('Two wallets started');
    });
  });

  afterEach(async () => {
    await utils.closeWallet(walletFunded);
    await utils.closeWallet(receiverWallet);
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
      await Promise.all([utils.waitForSyncFacade(walletFunded), utils.waitForSyncFacade(receiverWallet)]);
      const initialState = await utils.waitForSyncFacade(walletFunded);
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialUnshieldedBalance = initialState.unshielded.balances.get(unshieldedTokenRaw);
      logger.info(`Wallet 1: ${initialShieldedBalance} shielded tokens`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
      logger.info(`Wallet 1 total shielded coins: ${initialState.shielded.totalCoins.length}`);
      logger.info(`Wallet 1 total unshielded coins: ${initialState.unshielded.totalCoins.length}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);
      expect(initialState.shielded.balances[shieldedTokenRaw]).toBe(balance);
      expect(initialState.unshielded.balances.get(unshieldedTokenRaw)).toBe(balance);
      expect(Object.keys(initialState.shielded.balances)).toHaveLength(3);
      // expect(initialState.unshielded.balances.size).toBe(3);

      const initialState2 = await firstValueFrom(receiverWallet.state());
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw];
      expect(initialBalance2).toBe(undefined);
      expect(Object.keys(initialState2.shielded.balances)).toHaveLength(0);
      expect(initialState.unshielded.balances.size).toBe(1);
      logger.info(`Wallet 2: ${initialBalance2}`);
      logger.info(`Wallet 2 available coins: ${initialState2.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(NetworkId.NetworkId.Undeployed, initialState2.shielded.address),
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
      const txToProve = await walletFunded.transferTransaction(
        fundedSecretKey,
        fundedDustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      const signedTx = await walletFunded.signTransaction(txToProve.transaction, (payload) =>
        unshieldedFundedKeyStore.signData(payload),
      );
      const provenTx = await walletFunded.finalizeTransaction({ ...txToProve, transaction: signedTx });
      const txId = await walletFunded.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(walletFunded);
      expect(pendingState.shielded.balances[shieldedTokenRaw] ?? 0n).toBeLessThanOrEqual(balance - outputValue);
      expect(pendingState.unshielded.balances.get(unshieldedTokenRaw) ?? 0n).toBeLessThanOrEqual(balance - outputValue);
      expect(pendingState.shielded.totalCoins.length).toBe(7);
      expect(pendingState.unshielded.totalCoins.length).toBe(5);
      expect(pendingState.shielded.availableCoins.length).toBe(6);
      expect(pendingState.unshielded.availableCoins.length).toBe(4);
      expect(pendingState.shielded.pendingCoins.length).toBe(1);
      expect(pendingState.unshielded.pendingCoins.length).toBe(1);

      logger.info('Waiting for finalized balance...');
      await utils.waitForFacadePendingClear(walletFunded);
      const finalState = await utils.waitForSyncFacade(walletFunded);
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(balance - outputValue);
      expect(finalState.unshielded.balances.get(unshieldedTokenRaw) ?? 0n).toBeLessThanOrEqual(balance - outputValue);
      expect(finalState.shielded.totalCoins.length).toBe(7);
      expect(finalState.unshielded.totalCoins.length).toBe(5);
      expect(finalState.unshielded.availableCoins.length).toBe(5);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.unshielded.pendingCoins.length).toBe(0);

      await utils.waitForFinalizedBalance(receiverWallet.shielded);
      const finalState2 = await utils.waitForSyncFacade(receiverWallet);
      const finalShieldedBalance = finalState2.shielded.balances[shieldedTokenRaw];
      const finalUnshieldedBalance = finalState2.unshielded.balances.get(unshieldedTokenRaw);
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

  test(
    'Shielded wallet state can be serialized and then restored',
    async () => {
      allure.tag('smoke');
      allure.tms('PM-9084', 'PM-9084');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - serialize');
      const initialState = await utils.waitForSyncFacade(walletFunded);
      const initialStateTxHistory = utils.getTransactionHistoryIds(initialState.shielded);
      const serialized = await walletFunded.shielded.serializeState();
      const stateObject = JSON.parse(serialized);
      expect(stateObject.txHistory).toHaveLength(1);
      expect(Number(stateObject.offset)).toBeGreaterThan(0);
      expect(typeof stateObject.state).toBe('string');
      expect(stateObject.state).toBeTruthy();
      await walletFunded.stop();

      logger.info('Restoring wallet from serialized state...');
      const restoredWallet = Wallet.restore(serialized);
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
    'Unshielded wallet can be serialized and restored with in memory tx history storage',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-11088', 'PM-11088');
      allure.epic('Headless wallet');
      allure.feature('Wallet building');
      allure.story('Building with discardTxHistory undefined');

      fixture = getFixture();
      const txHistoryStorage = new InMemoryTransactionHistoryStorage();
      const unshieldedKeyStore = createKeystore(utils.getUnshieldedSeed(seedFunded), fixture.getNetworkId());
      const initialWallet = await UnshieldedWalletBuilder.build({
        publicKey: PublicKey.fromKeyStore(unshieldedKeyStore),
        networkId: fixture.getNetworkId(),
        indexerUrl: fixture.getIndexerUri(),
        txHistoryStorage,
      });
      logger.info(`Waiting to sync...`);
      // const syncedState = await utils.waitForSyncUnshielded(initialWallet);
      // TODO add assertion for Tx history
      const serializedState = await initialWallet.serializeState();
      const serializedTxHistory = txHistoryStorage.serialize();
      await initialWallet.stop();

      const restoredTxHistory = InMemoryTransactionHistoryStorage.fromSerialized(serializedTxHistory);
      const restoredWallet = await UnshieldedWalletBuilder.restore({
        publicKey: PublicKey.fromKeyStore(unshieldedKeyStore),
        networkId: fixture.getNetworkId(),
        indexerUrl: fixture.getIndexerUri(),
        serializedState,
        txHistoryStorage: restoredTxHistory,
      });

      const restoredState = await utils.waitForSyncUnshielded(restoredWallet);
      expect(restoredState).toBeTruthy();
      // TODO add assertion for Tx history
    },
    timeout,
  );

  test(
    'Dust wallet can be serialized and restored with in memory tx history storage',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-11088', 'PM-11088');
      allure.epic('Headless wallet');
      allure.feature('Wallet building');
      allure.story('Building with discardTxHistory undefined');

      const initialState = await utils.waitForSyncFacade(walletFunded);
      const publicKey = initialState.dust.dustPublicKey;
      const address = initialState.dust.dustAddress;
      const dustBalance = initialState.dust.walletBalance(new Date());
      const serialized = await walletFunded.dust.serializeState();
      logger.info(`serializeState: ${serialized}`);
      const stateObject = JSON.parse(serialized);
      expect(stateObject.publicKey.publicKey).toContain(publicKey);
      expect(stateObject.state).toBeTruthy();
      expect(stateObject.networkId).toBe(NetworkId.NetworkId.Undeployed);

      logger.info('Restoring wallet from serialized state...');
      const restoredWallet = Dust.restore(serialized);
      await restoredWallet.start(fundedDustSecretKey);
      const restoredState = await restoredWallet.waitForSyncedState();
      logger.info(restoredState);
      expect(restoredState.dustPublicKey).toBe(publicKey);
      expect(restoredState.dustAddress).toBe(address);
      expect(restoredState.walletBalance(new Date())).toBe(dustBalance);
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
