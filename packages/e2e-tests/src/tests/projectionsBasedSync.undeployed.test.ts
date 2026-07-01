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
  let funded: utils.WalletInit;
  let fundedNew: utils.WalletInit;
  let receiver: utils.WalletInit;
  let receiverNew: utils.WalletInit;

  beforeEach(async () => {
    fixture = getFixture();
    funded = await utils.initWalletWithSeed(seedFunded, fixture);
    fundedNew = await utils.initWalletWithSeed(seedFunded, fixture, {
      dustWallet: eventLessDustWallet,
      manualSync: true,
    });
    logger.info('fundedNew synced in before stage');
    receiver = await utils.initWalletWithSeed(seed, fixture);
    receiverNew = await utils.initWalletWithSeed(seed, fixture, {
      dustWallet: eventLessDustWallet,
      manualSync: true,
    });
    logger.info('Two wallets started');
  });

  afterEach(async () => {
    await funded.wallet.stop();
    await fundedNew.wallet.stop();
    await receiver.wallet.stop();
    await receiverNew.wallet.stop();
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

  const expectSameSyncState = (oldSyncState: FacadeState, projectionsSyncState: FacadeState) => {
    expect(dustStatesEqual(oldSyncState.dust.state.state, projectionsSyncState.dust.state.state)).toBe(true);
    expect(oldSyncState.unshielded.balances[unshieldedTokenRaw]).toEqual(
      projectionsSyncState.unshielded.balances[unshieldedTokenRaw],
    );
    expect(
      unshieldedCoinsEqual(oldSyncState.unshielded.availableCoins, projectionsSyncState.unshielded.availableCoins),
    ).toBe(true);
  };

  const sendAndRegisterNightUtxos = async () => {
    await fundedNew.wallet.doSync(fundedNew.shieldedSecretKeys, fundedNew.dustSecretKey);
    await receiverNew.wallet.doSync(receiverNew.shieldedSecretKeys, receiverNew.dustSecretKey);

    const initialState = await funded.wallet.waitForSyncedState();
    const initialStateNew = await fundedNew.wallet.waitForSyncedState();
    const receiverInitialState = await receiver.wallet.waitForSyncedState();
    const receiverInitialStateNew = await receiverNew.wallet.waitForSyncedState();

    const receiverInitialAvailableCoins = receiverInitialStateNew.unshielded.availableCoins.length;
    const initialUnshieldedBalance = initialStateNew.unshielded.balances[unshieldedTokenRaw];
    logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
    logger.info(`Wallet 1 total unshielded coins: ${initialStateNew.unshielded.totalCoins.length}`);

    const outputsToCreate: CombinedTokenTransfer[] = [
      {
        type: 'shielded',
        outputs: [
          {
            type: shieldedTokenRaw,
            amount: outputValue,
            receiverAddress: receiverInitialStateNew.shielded.address,
          },
        ],
      },
      {
        type: 'unshielded',
        outputs: [
          {
            amount: outputValue,
            receiverAddress: receiverInitialStateNew.unshielded.address,
            type: unshieldedTokenRaw,
          },
        ],
      },
      {
        type: 'unshielded',
        outputs: [
          {
            amount: outputValue,
            receiverAddress: receiverInitialStateNew.unshielded.address,
            type: unshieldedTokenRaw,
          },
        ],
      },
    ];
    const fundedStatesEqual = dustStatesEqual(initialState.dust.state.state, initialStateNew.dust.state.state);
    logger.info(`dust states equal for the "funded" wallets: ${fundedStatesEqual}`);
    if (!fundedStatesEqual) {
      logger.info(`funded dust state1 old: ${initialState.dust.state.state.toString()}`);
      logger.info(`funded dust state1 new: ${initialStateNew.dust.state.state.toString()}`);
    }
    expect(fundedStatesEqual).toBe(true);

    const receiverStatesEqual = dustStatesEqual(
      receiverInitialState.dust.state.state,
      receiverInitialStateNew.dust.state.state,
    );
    logger.info(`dust states equal for "receiver" wallets: ${receiverStatesEqual}`);
    if (!receiverStatesEqual) {
      logger.info(`receiver dust state1 new: ${receiverInitialStateNew.dust.state.state.toString()}`);
      logger.info(`receiver dust state1 old: ${receiverInitialState.dust.state.state.toString()}`);
    }
    expect(receiverStatesEqual).toBe(true);

    await utils.waitForBlockAdvancement(fixture.getIndexerUri());

    await fundedNew.wallet.doSync(fundedNew.shieldedSecretKeys, fundedNew.dustSecretKey);
    await receiverNew.wallet.doSync(receiverNew.shieldedSecretKeys, receiverNew.dustSecretKey);

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const txRecipe = await fundedNew.wallet.transferTransaction(
      outputsToCreate,
      {
        shieldedSecretKeys: fundedNew.shieldedSecretKeys,
        dustSecretKey: fundedNew.dustSecretKey,
      },
      { ttl },
    );
    const signedTxRecipe = await fundedNew.wallet.signRecipe(txRecipe, (payload) =>
      fundedNew.unshieldedKeystore.signData(payload),
    );
    const finalizedTx = await fundedNew.wallet.finalizeRecipe(signedTxRecipe);
    const txId = await fundedNew.wallet.submitTransaction(finalizedTx);
    logger.info('Transaction id: ' + txId);
    logger.info('Waiting for finalized balance...');
    const receiverState2 = await utils.waitForUnshieldedCoinUpdate(receiverNew.wallet, receiverInitialAvailableCoins);
    const finalUnshieldedBalance = receiverState2.unshielded.balances[unshieldedTokenRaw];
    logger.info(inspect(receiverState2.unshielded.availableCoins, { depth: null }));
    logger.info(`Wallet 2: ${finalUnshieldedBalance} unshielded tokens`);

    await utils.waitForBlockAdvancement(fixture.getIndexerUri());
    await fundedNew.wallet.doSync(fundedNew.shieldedSecretKeys, fundedNew.dustSecretKey);
    await receiverNew.wallet.doSync(receiverNew.shieldedSecretKeys, receiverNew.dustSecretKey);

    const fundedState = await funded.wallet.waitForSyncedState();
    const fundedNewState = await fundedNew.wallet.waitForSyncedState();
    const receiverState = await receiver.wallet.waitForSyncedState();
    const receiverNewState = await receiverNew.wallet.waitForSyncedState();

    logger.info(`2) rootsEqual new: ${rootsEqual(fundedNewState.dust.state.state, receiverNewState.dust.state.state)}`);

    const nightUtxos = receiverState2.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );
    if (nightUtxos.length === 0) {
      throw new Error('No night UTXOs available to register');
    }
    logger.info(`night utxo length: ${nightUtxos.length}`);

    expect(ArrayOps.sumBigInt(nightUtxos.map((coin) => coin.utxo.value))).toEqual(finalUnshieldedBalance);
    logger.info(`utxo length: ${nightUtxos.length}`);

    const { fee: estimatedRegistrationFee } = await receiverNew.wallet.estimateRegistration(nightUtxos);
    logger.info(`Estimated registration fee: ${estimatedRegistrationFee} stroke; waiting for generation to cover it`);
    await receiverNew.wallet.waitForGeneratedDust(nightUtxos, estimatedRegistrationFee);

    const dustRegistrationRecipe = await receiverNew.wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      receiverNew.unshieldedKeystore.getPublicKey(),
      (payload) => receiverNew.unshieldedKeystore.signData(payload),
    );

    const finalizedDustTx = await receiverNew.wallet.finalizeRecipe(dustRegistrationRecipe);
    const dustRegistrationTxid = await receiverNew.wallet.submitTransaction(finalizedDustTx);
    logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);

    await utils.waitForBlockAdvancement(fixture.getIndexerUri());
    await fundedNew.wallet.doSync(fundedNew.shieldedSecretKeys, fundedNew.dustSecretKey);
    await receiverNew.wallet.doSync(receiverNew.shieldedSecretKeys, receiverNew.dustSecretKey);
    // await receiverNew.wallet.waitForSyncedState();
    const fundedNewStateAfterRegistration = await fundedNew.wallet.waitForSyncedState();
    const receiverNewStateSyncedAfterRegistration = await receiverNew.wallet.waitForSyncedState();
    logger.info(
      `3) rootsEqual new: ${rootsEqual(
        fundedNewStateAfterRegistration.dust.state.state,
        receiverNewStateSyncedAfterRegistration.dust.state.state,
      )}`,
    );

    const receiverStateAfterRegistration = await utils.waitForStateAfterDustRegistration(
      receiverNew.wallet,
      finalizedDustTx,
    );
    const receiverStateAfterRegistrationOld = await rx.firstValueFrom(
      receiver.wallet.state().pipe(
        rx.filter((s) => s.isSynced),
        rx.filter(
          (s) =>
            s.dust.availableCoins.length > 0 &&
            s.unshielded.availableCoins.some((coin) => coin.meta.registeredForDustGeneration === true),
        ),
      ),
    );

    const nightBalanceAfterRegistration = receiverStateAfterRegistration.unshielded.balances[unshieldedTokenRaw];
    expect(nightBalanceAfterRegistration).toBe(finalUnshieldedBalance);

    return {
      fundedState,
      fundedNewState,
      receiverState,
      receiverNewState,
      fundedNewStateAfterRegistration,
      receiverStateAfterRegistration: receiverStateAfterRegistrationOld,
      receiverNewStateAfterRegistration: receiverStateAfterRegistration,
      finalUnshieldedBalance,
    };
  };

  test(
    'Able to register Night tokens for Dust generation after receiving unshielded tokens using new sync model @healthcheck',
    async () => {
      await sendAndRegisterNightUtxos();
      const initialWalletState = await receiverNew.wallet.waitForSyncedState();
      const receiverDustBalance = await rx.firstValueFrom(
        receiverNew.wallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.balance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.balance(new Date()) > 1000n),
          rx.map((s) => s.dust.balance(new Date())),
        ),
      );

      expect(receiverDustBalance).toBeGreaterThan(0n);
      await utils.waitForRegisteredTokens(receiverNew.wallet);
      const registeredNightUtxos = initialWalletState.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );
      expect(registeredNightUtxos.length).toBeGreaterThan(0);
    },
    timeout,
  );

  test(
    'New sync model matches the default sync model after transfer and Dust registration',
    async () => {
      const {
        fundedState,
        fundedNewState,
        receiverState,
        receiverNewState,
        fundedNewStateAfterRegistration,
        receiverStateAfterRegistration,
        receiverNewStateAfterRegistration,
        finalUnshieldedBalance,
      } = await sendAndRegisterNightUtxos();

      expectSameSyncState(fundedState, fundedNewState);
      expectSameSyncState(receiverState, receiverNewState);
      expectSameSyncState(receiverStateAfterRegistration, receiverNewStateAfterRegistration);
      expect(rootsEqual(fundedNewState.dust.state.state, receiverNewState.dust.state.state)).toBe(true);
      expect(
        rootsEqual(
          fundedNewStateAfterRegistration.dust.state.state,
          receiverNewStateAfterRegistration.dust.state.state,
        ),
      ).toBe(true);

      const registeredNightUtxos = receiverNewStateAfterRegistration.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === true,
      );
      expect(registeredNightUtxos.length).toBeGreaterThan(0);
      expect(ArrayOps.sumBigInt(registeredNightUtxos.map((coin) => coin.utxo.value))).toEqual(finalUnshieldedBalance);
      expect(receiverNewStateAfterRegistration.dust.balance(new Date())).toBeGreaterThan(0n);
    },
    timeout,
  );
});
