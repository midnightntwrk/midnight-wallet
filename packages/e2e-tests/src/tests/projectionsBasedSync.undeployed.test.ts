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
import { describe, test, expect } from 'vitest';
import * as rx from 'rxjs';
import { Array as Arr } from 'effect';
import { type TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { type CombinedTokenTransfer, type FacadeState, type UtxoWithMeta } from '@midnightntwrk/wallet-sdk-facade';
import { ArrayOps } from '@midnightntwrk/wallet-sdk-utilities';
import { inspect } from 'node:util';
import {
  CustomDustWallet,
  type DefaultDustConfiguration,
  makeEventLessSyncCapability,
  makeEventLessSyncService,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { V1Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';

/** @group undeployed */

describe('Projections-based synchronisation model', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 300_000;
  const outputValue = utils.tNightAmount(1000n);

  const eventLessDustWallet = (config: DefaultDustConfiguration) =>
    CustomDustWallet(
      config,
      new V1Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability),
    );

  let fixture: TestContainersFixture;
  let fundedEventsSynced: utils.WalletInit;
  let funded: utils.WalletInit;
  let receiverEventsSynced: utils.WalletInit;
  let receiver: utils.WalletInit;

  beforeEach(async () => {
    fixture = getFixture();
    fundedEventsSynced = await utils.initWalletWithSeed(seedFunded, fixture);
    funded = await utils.initWalletWithSeed(seedFunded, fixture, {
      dustWallet: eventLessDustWallet,
      manualSync: true,
    });
    receiverEventsSynced = await utils.initWalletWithSeed(seed, fixture);
    receiver = await utils.initWalletWithSeed(seed, fixture, {
      dustWallet: eventLessDustWallet,
      manualSync: true,
    });
    logger.info('Two wallets started');
  });

  afterEach(async () => {
    await fundedEventsSynced.wallet.stop();
    await funded.wallet.stop();
    await receiverEventsSynced.wallet.stop();
    await receiver.wallet.stop();
  }, 20_000);

  const stringifyWithBigInts = (value: unknown) =>
    JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

  const sameItems = <T>(left: readonly T[], right: readonly T[], equal: (leftItem: T, rightItem: T) => boolean) =>
    left.length === right.length &&
    Arr.differenceWith<T>(equal)(left, right).length === 0 &&
    Arr.differenceWith<T>(equal)(right, left).length === 0;

  const rootsEqual = (state1: ledger.DustLocalState, state2: ledger.DustLocalState) =>
    state1.commitmentTreeRoot() === state2.commitmentTreeRoot() &&
    state1.generatingTreeRoot() === state2.generatingTreeRoot();

  const dustStatesEqual = (state1: ledger.DustLocalState, state2: ledger.DustLocalState) =>
    rootsEqual(state1, state2) &&
    sameItems<ledger.QualifiedDustOutput>(
      state1.utxos,
      state2.utxos,
      (utxo1, utxo2) => stringifyWithBigInts(utxo1) === stringifyWithBigInts(utxo2),
    );

  const unshieldedCoinsEqual = (coins1: readonly UtxoWithMeta[], coins2: readonly UtxoWithMeta[]) =>
    sameItems(
      coins1,
      coins2,
      (coin1, coin2) =>
        coin1.meta.registeredForDustGeneration === coin2.meta.registeredForDustGeneration &&
        stringifyWithBigInts(coin1.utxo) === stringifyWithBigInts(coin2.utxo),
    );

  const expectSameSyncState = (eventsSyncState: FacadeState, projectionsSyncState: FacadeState) => {
    const statesEqual = dustStatesEqual(eventsSyncState.dust.state.state, projectionsSyncState.dust.state.state);
    expect(statesEqual).toBe(true);
    expect(eventsSyncState.unshielded.balances[unshieldedTokenRaw]).toEqual(
      projectionsSyncState.unshielded.balances[unshieldedTokenRaw],
    );
    expect(
      unshieldedCoinsEqual(eventsSyncState.unshielded.availableCoins, projectionsSyncState.unshielded.availableCoins),
    ).toBe(true);
  };

  const expectSameRoots = (state1: FacadeState, state2: FacadeState) => {
    expect(rootsEqual(state1.dust.state.state, state2.dust.state.state)).toBe(true);
  };

  const syncAndVerify = async () => {
    // Events-based sync
    const fundedStateEventsSynced = await fundedEventsSynced.wallet.waitForSyncedState();
    const receiverStateEventsSynced = await receiverEventsSynced.wallet.waitForSyncedState();

    // Projections-based sync
    await funded.wallet.doSync(funded.dustSecretKey);
    await receiver.wallet.doSync(receiver.dustSecretKey);

    const fundedState = await funded.wallet.waitForSyncedState();
    const receiverState = await receiver.wallet.waitForSyncedState();

    expectSameSyncState(fundedStateEventsSynced, fundedState);
    expectSameSyncState(receiverStateEventsSynced, receiverState);
    expectSameRoots(fundedState, receiverState);

    logger.info('States are correct');

    return {
      fundedState,
      receiverState,
    };
  };

  const sendAndRegisterNightUtxos = async () => {
    const { fundedState: initialState, receiverState: receiverInitialState } = await syncAndVerify();

    const receiverInitialAvailableCoins = receiverInitialState.unshielded.availableCoins.length;
    const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
    logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
    logger.info(`Wallet 1 total unshielded coins: ${initialState.unshielded.totalCoins.length}`);

    // Step 1: Send tokens to receiver's address
    const outputsToCreate: CombinedTokenTransfer[] = [
      {
        type: 'shielded',
        outputs: [
          {
            type: shieldedTokenRaw,
            amount: outputValue,
            receiverAddress: receiverInitialState.shielded.address,
          },
        ],
      },
      {
        type: 'unshielded',
        outputs: [
          {
            amount: outputValue,
            receiverAddress: receiverInitialState.unshielded.address,
            type: unshieldedTokenRaw,
          },
        ],
      },
      {
        type: 'unshielded',
        outputs: [
          {
            amount: outputValue,
            receiverAddress: receiverInitialState.unshielded.address,
            type: unshieldedTokenRaw,
          },
        ],
      },
    ];

    await utils.waitForBlockAdvancement(fixture.getIndexerUri());

    await funded.wallet.doSync(funded.dustSecretKey);
    await receiver.wallet.doSync(receiver.dustSecretKey);

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const txRecipe = await funded.wallet.transferTransaction(
      outputsToCreate,
      {
        shieldedSecretKeys: funded.shieldedSecretKeys,
        dustSecretKey: funded.dustSecretKey,
      },
      { ttl },
    );
    const signedTxRecipe = await funded.wallet.signRecipe(txRecipe, (payload) =>
      funded.unshieldedKeystore.signData(payload),
    );
    const finalizedTx = await funded.wallet.finalizeRecipe(signedTxRecipe);
    const txId = await funded.wallet.submitTransaction(finalizedTx);
    logger.info('Transaction id: ' + txId);
    logger.info('Waiting for finalized balance...');

    // verify received tokens
    const receiverStateAfterTransfer = await utils.waitForUnshieldedCoinUpdate(
      receiver.wallet,
      receiverInitialAvailableCoins,
    );
    const finalUnshieldedBalance = receiverStateAfterTransfer.unshielded.balances[unshieldedTokenRaw];
    logger.info(inspect(receiverStateAfterTransfer.unshielded.availableCoins, { depth: null }));
    logger.info(`Wallet 2: ${finalUnshieldedBalance} unshielded tokens`);

    await utils.waitForBlockAdvancement(fixture.getIndexerUri());
    await syncAndVerify();

    const nightUtxos = receiverStateAfterTransfer.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );
    if (nightUtxos.length === 0) {
      throw new Error('No night UTXOs available to register');
    }
    logger.info(`night utxo length: ${nightUtxos.length}`);

    expect(ArrayOps.sumBigInt(nightUtxos.map((coin) => coin.utxo.value))).toEqual(finalUnshieldedBalance);
    logger.info(`utxo length: ${nightUtxos.length}`);

    // Step 2: Register night UTXOs for Dust generation
    const { fee: estimatedRegistrationFee } = await receiver.wallet.estimateRegistration(nightUtxos);
    logger.info(`Estimated registration fee: ${estimatedRegistrationFee} stroke; waiting for generation to cover it`);
    await receiver.wallet.waitForGeneratedDust(nightUtxos, estimatedRegistrationFee);

    const dustRegistrationRecipe = await receiver.wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      receiver.unshieldedKeystore.getPublicKey(),
      (payload) => receiver.unshieldedKeystore.signData(payload),
    );

    const finalizedDustTx = await receiver.wallet.finalizeRecipe(dustRegistrationRecipe);
    const dustRegistrationTxid = await receiver.wallet.submitTransaction(finalizedDustTx);
    logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);

    await utils.waitForBlockAdvancement(fixture.getIndexerUri());
    await receiver.wallet.doSync(receiver.dustSecretKey);

    const receiverStateAfterRegistration = await utils.waitForStateAfterDustRegistration(
      receiver.wallet,
      finalizedDustTx,
    );
    logger.info('Registered for Dust generation');
    const nightBalanceAfterRegistration = receiverStateAfterRegistration.unshielded.balances[unshieldedTokenRaw];
    expect(nightBalanceAfterRegistration).toBe(finalUnshieldedBalance);

    return await syncAndVerify();
  };

  const submitHistoryBuildingTransfer = async (receiverAddress: FacadeState['shielded']['address']) => {
    const txRecipe = await fundedEventsSynced.wallet.transferTransaction(
      [
        {
          type: 'shielded',
          outputs: [{ type: shieldedTokenRaw, amount: outputValue, receiverAddress }],
        },
      ],
      {
        shieldedSecretKeys: fundedEventsSynced.shieldedSecretKeys,
        dustSecretKey: fundedEventsSynced.dustSecretKey,
      },
      { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );
    const finalizedTx = await fundedEventsSynced.wallet.finalizeRecipe(txRecipe);
    await fundedEventsSynced.wallet.submitTransaction(finalizedTx);

    const txHash = finalizedTx.transactionHash();
    await utils.waitForTxInHistory(txHash, fundedEventsSynced.wallet, {
      ready: (entry) => entry.shielded !== undefined && entry.dust !== undefined,
    });
    await utils.waitForFacadePendingClear(fundedEventsSynced.wallet);
  };

  test(
    'Projections-based sync recovers a pre-funded wallet with a multi-spend Dust nullifier chain',
    async () => {
      const receiverState = await receiverEventsSynced.wallet.waitForSyncedState();
      await fundedEventsSynced.wallet.waitForSyncedState();

      for (const expectedChainDepth of [1, 2]) {
        await submitHistoryBuildingTransfer(receiverState.shielded.address);

        const eventsState = await fundedEventsSynced.wallet.waitForSyncedState();
        const deepestDustChain = Math.max(...eventsState.dust.state.state.utxos.map((utxo) => utxo.seq));
        expect(deepestDustChain).toBeGreaterThanOrEqual(expectedChainDepth);
      }

      await funded.wallet.doSync(funded.dustSecretKey);

      const eventsState = await fundedEventsSynced.wallet.waitForSyncedState();
      const projectionsState = await funded.wallet.waitForSyncedState();
      expectSameSyncState(eventsState, projectionsState);
    },
    timeout * 2,
  );

  test(
    'Initial projections-based sync of empty wallet (no transaction history) is near-instant',
    async () => {
      // receiver starts on a fresh blockchain with no prior UTXOs — the projection snapshot is
      // empty, so the sync should be purely a roundtrip to the indexer with no heavy computation.
      const start = Date.now();
      await receiver.wallet.doSync(receiver.dustSecretKey);
      const elapsedMs = Date.now() - start;

      const state = await receiver.wallet.waitForSyncedState();
      logger.info(`Empty wallet projections sync took ${elapsedMs}ms`);

      expect(state.isSynced).toBe(true);
      expect(elapsedMs).toBeLessThan(30_000);
    },
    timeout,
  );

  test(
    'Incremental projections-based sync after new blocks is near-instant',
    async () => {
      // Establish a clean baseline state for receiver (empty wallet).
      await receiver.wallet.doSync(receiver.dustSecretKey);
      await receiver.wallet.waitForSyncedState();

      // Advance the chain without involving the receiver wallet.
      // The projections sync only fetches the delta since the last snapshot,
      // so re-syncing should be a tiny request even if many blocks were produced.
      await utils.waitForBlockAdvancement(fixture.getIndexerUri());
      await utils.waitForBlockAdvancement(fixture.getIndexerUri());

      const start = Date.now();
      await receiver.wallet.doSync(receiver.dustSecretKey);
      const elapsedMs = Date.now() - start;

      const state = await receiver.wallet.waitForSyncedState();
      logger.info(`Incremental projections sync took ${elapsedMs}ms`);

      expect(state.isSynced).toBe(true);
      expect(elapsedMs).toBeLessThan(15_000);
    },
    timeout,
  );

  test(
    'Able to register Night tokens for Dust generation after receiving unshielded tokens using projections sync model @healthcheck',
    async () => {
      const { receiverState } = await sendAndRegisterNightUtxos();
      const receiverDustBalance = await rx.firstValueFrom(
        receiver.wallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.balance(new Date()) > 1000n),
          rx.map((s) => s.dust.balance(new Date())),
        ),
      );

      expect(receiverDustBalance).toBeGreaterThan(0n);
      await utils.waitForRegisteredTokens(receiver.wallet);
      const registeredNightUtxos = receiverState.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );
      expect(registeredNightUtxos.length).toBeGreaterThan(0);
    },
    timeout,
  );
});
