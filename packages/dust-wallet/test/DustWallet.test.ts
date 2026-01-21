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
import {
  DustSecretKey,
  Intent,
  LedgerParameters,
  nativeToken,
  ProofErasedTransaction,
  Transaction,
  UnshieldedOffer,
  UserAddress,
} from '@midnight-ntwrk/ledger-v7';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { Proving } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { beforeEach, describe, it } from '@vitest/runner';
import { BigInt as BI, Chunk, Effect, Scope, Stream, SubscriptionRef } from 'effect';

import { expect, vi } from 'vitest';
import { DustCoreWallet, RunningV1Variant, Transacting, UtxoWithMeta, V1Builder, V1Variant } from '../src/index.js';
import { Simulator, SimulatorState } from '../src/Simulator.js';
import * as Submission from '../src/Submission.js';
import { makeSimulatorSyncCapability, makeSimulatorSyncService, SimulatorSyncUpdate } from '../src/Sync.js';
import { createUnshieldedKeystore, UnshieldedKeystore } from './UnshieldedKeyStore.js';
import { getDustSeed, sumUtxos } from './utils.js';

vi.setConfig({ testTimeout: 1 * 1000 });

const NIGHT_TOKEN_TYPE = nativeToken().raw;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const SEED_BOB = '0000000000000000000000000000000000000000000000000000000000000002';
const NETWORK = 'undeployed';

const getNightTokens = (state: SimulatorState, walletAddress: UserAddress) => {
  const utxos = state.ledger.utxo.filter(walletAddress);
  return [...utxos].filter((utxo) => utxo.type === NIGHT_TOKEN_TYPE);
};

const getNightTokensWithMeta = (state: SimulatorState, walletAddress: UserAddress): Array<UtxoWithMeta> => {
  const utxos = state.ledger.utxo.filter(walletAddress);
  const result: Array<UtxoWithMeta> = [];
  for (const utxo of utxos) {
    if (utxo.type === NIGHT_TOKEN_TYPE) {
      const meta = state.ledger.utxo.lookupMeta(utxo);
      if (meta) {
        result.push({ ...utxo, ctime: meta.ctime });
      }
    }
  }
  return result;
};

const toTxTime = (secs: number | bigint): Date => new Date(Number(secs) * 1000);

const getCurrentTime = (simulatorState: SimulatorState) => DateOps.addSeconds(toTxTime(simulatorState.lastTxNumber), 1);

const waitForTx = (stateRef: SubscriptionRef.SubscriptionRef<DustCoreWallet>, txTime: bigint | number) => {
  const stream = stateRef.changes.pipe(Stream.find((val) => val.progress.appliedIndex === BigInt(txTime)));
  return Stream.runLast(stream);
};

type WalletVariant = V1Variant<string, SimulatorSyncUpdate, ProofErasedTransaction, DustSecretKey>;
type RunningWallet = RunningV1Variant<string, SimulatorSyncUpdate, ProofErasedTransaction, DustSecretKey>;

describe('DustWallet', () => {
  const costParameters = {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  };
  const dustParameters = LedgerParameters.initialParameters().dust;
  let walletVariant: WalletVariant;
  let wallet: RunningWallet;
  let stateRef: SubscriptionRef.SubscriptionRef<DustCoreWallet>;
  let simulator: Simulator;
  let keyStore: UnshieldedKeystore;

  const registerNightTokens = (wallet: RunningWallet, nightTokens: Array<UtxoWithMeta>, nightVerifyingKey: string) => {
    return Effect.gen(function* () {
      const lastState = yield* SubscriptionRef.get(stateRef);
      const simulatorState = yield* simulator.getLatestState();
      const currentTime = getCurrentTime(simulatorState);
      const ttl = DateOps.addSeconds(currentTime, 1);

      const registerForDustTransaction = yield* wallet.createDustGenerationTransaction(
        currentTime,
        ttl,
        nightTokens,
        nightVerifyingKey,
        DustAddress.encodePublicKey(NETWORK, lastState.publicKey.publicKey),
      );

      const intent = registerForDustTransaction.intents!.get(1);
      const intentSignatureData = intent!.signatureData(1);
      const signature = keyStore.signData(intentSignatureData);
      const dustGenerationTransaction = yield* wallet.addDustGenerationSignature(registerForDustTransaction, signature);

      const transaction = yield* wallet.proveTransaction(dustGenerationTransaction);
      const result = yield* wallet.submitTransaction(transaction);
      const latestSimulatorState = yield* simulator.getLatestState();
      expect(result.blockHeight).toBe(latestSimulatorState.lastTxNumber);
      expect(latestSimulatorState.lastTxResult?.type).toBe('success');
      return { submission: result, transaction };
    });
  };

  const deregisterNightTokens = (
    wallet: RunningWallet,
    nightTokens: Array<UtxoWithMeta>,
    nightVerifyingKey: string,
    dustSecretKey: DustSecretKey,
  ) => {
    return Effect.gen(function* () {
      const simulatorState = yield* simulator.getLatestState();
      const currentTime = getCurrentTime(simulatorState);
      const ttl = DateOps.addSeconds(currentTime, 1);

      const registerForDustTransaction = yield* wallet.createDustGenerationTransaction(
        currentTime,
        ttl,
        nightTokens,
        nightVerifyingKey,
        undefined,
      );

      const balancingTransaction = yield* wallet.balanceTransactions(
        dustSecretKey,
        [registerForDustTransaction],
        ttl,
        currentTime,
      );

      const balancedTransaction = registerForDustTransaction.merge(balancingTransaction);

      const intent = balancedTransaction.intents!.get(1);
      const intentSignatureData = intent!.signatureData(1);
      const signature = keyStore.signData(intentSignatureData);
      const dustGenerationTransaction = yield* wallet.addDustGenerationSignature(balancedTransaction, signature);

      const transaction = yield* wallet.proveTransaction(dustGenerationTransaction);
      const result = yield* wallet.submitTransaction(transaction);
      const latestSimulatorState = yield* simulator.getLatestState();
      expect(result.blockHeight).toBe(latestSimulatorState.lastTxNumber);
      expect(latestSimulatorState.lastTxResult?.type).toBe('success');
      return result;
    });
  };

  beforeEach(async () =>
    Effect.gen(function* () {
      const dustSeed = getDustSeed(SEED);
      keyStore = createUnshieldedKeystore(dustSeed);
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const scope = yield* Scope.make();

      simulator = yield* Simulator.init(NETWORK).pipe(Effect.provideService(Scope.Scope, scope));

      walletVariant = new V1Builder()
        .withTransactionType<ProofErasedTransaction>()
        .withProving(Proving.makeSimulatorProvingService)
        .withCoinSelectionDefaults()
        .withTransacting(Transacting.makeSimulatorTransactingCapability)
        .withSync(makeSimulatorSyncService, makeSimulatorSyncCapability)
        .withCoinsAndBalancesDefaults()
        .withKeysDefaults()
        .withSubmission(Submission.makeSimulatorSubmissionService())
        .withSerializationDefaults()
        .build({
          simulator,
          networkId: NETWORK,
          costParameters,
        });

      const initialState = DustCoreWallet.initEmpty(dustParameters, dustSecretKey, NETWORK);
      stateRef = yield* SubscriptionRef.make(initialState);
      wallet = yield* walletVariant.start({ stateRef }).pipe(Effect.provideService(Scope.Scope, scope));
      yield* wallet.startSyncInBackground(dustSecretKey);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('should build', async () => {
    return Effect.gen(function* () {
      const lastState = yield* SubscriptionRef.get(stateRef);
      expect(lastState).toBeTruthy();
    }).pipe(Effect.runPromise);
  });

  it('should get the night tokens', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000n;

      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      const simulatorState = yield* simulator.getLatestState();
      expect(rewardNight.blockNumber).toBe(1n);
      expect(simulatorState.lastTxNumber).toBe(1n);
      expect(simulatorState.lastTxResult!.type).toBe('success');

      const nightTokens = getNightTokens(yield* simulator.getLatestState(), walletAddress);
      yield* waitForTx(stateRef, 1);

      expect(nightTokens.length).toBe(1);
      expect(nightTokens[0].value).toBe(awardTokens);
    }).pipe(Effect.runPromise);
  });

  it('should register the night tokens', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1n);

      let latestState = yield* SubscriptionRef.get(stateRef);
      const walletBalance = walletVariant.coinsAndBalances.getWalletBalance(latestState, toTxTime(1));
      expect(walletBalance).toEqual(0n);

      const simulatorState = yield* simulator.getLatestState();
      const nightTokens = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokens.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokens, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      latestState = yield* SubscriptionRef.get(stateRef);
      const newWalletBalance = walletVariant.coinsAndBalances.getWalletBalance(latestState, toTxTime(3));
      expect(newWalletBalance).toBe(1_240_050_000_000_000n);
    }).pipe(Effect.runPromise);
  });

  it('should split night utxos between fallible and guaranteed section', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const singleAwardTokens = 150_000_000_000n;
      const awardUtxos = 5;

      // reward & claim Night tokens
      const nightRewards: Chunk.Chunk<{ blockNumber: bigint }> = yield* Stream.repeatEffect(
        simulator.rewardNight(walletAddress, singleAwardTokens, nightVerifyingKey),
      ).pipe(Stream.take(awardUtxos), Stream.runCollect);
      const maxBlockNr = nightRewards.pipe(
        Chunk.map(({ blockNumber }) => blockNumber),
        Chunk.reduceRight(0n, BI.max),
      );
      yield* waitForTx(stateRef, maxBlockNr);

      const simulatorState = yield* simulator.getLatestState();
      const initialNightTokens = getNightTokensWithMeta(simulatorState, walletAddress);

      const { transaction } = yield* registerNightTokens(wallet, initialNightTokens, nightVerifyingKey);
      yield* waitForTx(stateRef, maxBlockNr + 1n);

      expect(sumUtxos(transaction, 'guaranteed', 'input')).toEqual(1);
      expect(sumUtxos(transaction, 'guaranteed', 'output')).toEqual(1);
      expect(sumUtxos(transaction, 'fallible', 'input')).toEqual(awardUtxos - 1);
      expect(sumUtxos(transaction, 'fallible', 'output')).toEqual(1);

      const latestState = yield* SubscriptionRef.get(stateRef);
      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(latestState);
      expect(availableCoins.length).toEqual(2);
    }).pipe(Effect.runPromise);
  });

  it('should get the right Dust balances', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1);

      const simulatorState = yield* simulator.getLatestState();
      const nightTokens = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokens.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokens, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      const latestState = yield* SubscriptionRef.get(stateRef);

      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(latestState);
      expect(availableCoins.length).toBe(1);
      expect(DateOps.dateToSeconds(availableCoins.at(0)!.ctime)).toBe(2n);

      const pendingCoins = walletVariant.coinsAndBalances.getPendingCoins(latestState);
      expect(pendingCoins.length).toBe(0);

      const generationInfo = walletVariant.coinsAndBalances.getGenerationInfo(latestState, availableCoins.at(0)!);
      expect(generationInfo?.value).toBe(awardTokens);
    }).pipe(Effect.runPromise);
  });

  it('should allow spending Dust tokens', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      // get more night tokens with a different amount
      const newNightTokenAmount = 160_000_000_000n;
      const rewardNight2 = yield* simulator.rewardNight(walletAddress, newNightTokenAmount, nightVerifyingKey);
      expect(rewardNight2.blockNumber).toBe(3n);
      simulatorState = yield* simulator.getLatestState();
      expect(simulatorState.lastTxResult!.type).toBe('success');
      yield* waitForTx(stateRef, 3);

      const walletState = yield* SubscriptionRef.get(stateRef);
      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(walletState);
      expect(availableCoins.length).toBe(2);

      // send one token to Bob
      const nightTokens = getNightTokens(simulatorState, walletAddress);
      const sendToken = nightTokens.find((val) => val.value === awardTokens);
      expect(sendToken).toBeDefined();

      const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
      const bobAddress = bobKeyStore.getAddress();

      const inputs = [
        {
          ...sendToken!,
          owner: nightVerifyingKey,
        },
      ];
      const outputs = [
        {
          type: NIGHT_TOKEN_TYPE,
          owner: bobAddress,
          value: sendToken!.value,
        },
      ];
      const currentTime = getCurrentTime(simulatorState);
      const ttl = DateOps.addSeconds(currentTime, 1);
      const intent = Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(inputs, outputs, []);
      const transferTransaction = Transaction.fromParts(NETWORK, undefined, undefined, intent);

      // cover fees with dust
      const balancingTransaction = yield* wallet.balanceTransactions(
        dustSecretKey,
        [transferTransaction],
        ttl,
        currentTime,
      );

      const balancedTransaction = transferTransaction.merge(balancingTransaction);

      const provenTransaction = yield* wallet.proveTransaction(balancedTransaction);

      yield* wallet.submitTransaction(provenTransaction);
      yield* waitForTx(stateRef, 4);

      simulatorState = yield* simulator.getLatestState();
      expect(simulatorState.lastTxResult?.type).toBe('success');

      const latestState = yield* SubscriptionRef.get(stateRef);
      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoins(latestState);
      const generationInfo = walletVariant.coinsAndBalances.getGenerationInfo(
        latestState,
        newAvailableCoins.find((c) => c.seq === 0)!,
      );
      expect(newAvailableCoins.length).toBe(2);
      expect(newAvailableCoins.some((coin) => DateOps.dateToSeconds(coin.ctime) === 4n)).toBe(true);
      expect(generationInfo?.dtime).toStrictEqual(DateOps.secondsToDate(4n));

      const pendingCoins = walletVariant.coinsAndBalances.getPendingCoins(latestState);
      expect(pendingCoins.length).toBe(0);
    }).pipe(Effect.runPromise);
  });

  it('should allow spending multiple Dust tokens', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      let nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // get more night tokens with a different amount
      const newNightTokenAmount = 140_000_000_000n;
      const rewardNight2 = yield* simulator.rewardNight(walletAddress, newNightTokenAmount, nightVerifyingKey);
      expect(rewardNight2.blockNumber).toBe(2n);
      simulatorState = yield* simulator.getLatestState();
      expect(simulatorState.lastTxResult!.type).toBe('success');
      yield* waitForTx(stateRef, 2);

      // get one more night token with a different amount
      const newNightTokenAmount2 = 160_000_000_000n;
      const rewardNight3 = yield* simulator.rewardNight(walletAddress, newNightTokenAmount2, nightVerifyingKey);
      expect(rewardNight3.blockNumber).toBe(3n);
      simulatorState = yield* simulator.getLatestState();
      expect(simulatorState.lastTxResult!.type).toBe('success');
      yield* waitForTx(stateRef, 3);

      // verify we have 3 Night tokens
      nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(3);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForTx(stateRef, 4);
      simulatorState = yield* simulator.getLatestState();

      const walletState = yield* SubscriptionRef.get(stateRef);
      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoinsWithFullInfo(
        walletState,
        toTxTime(simulatorState.lastTxNumber),
      );
      expect(availableCoins.length).toBe(2);

      nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(2);
      expect(nightTokensWithMeta.some((token) => token.value === newNightTokenAmount + newNightTokenAmount2)).toBe(
        true,
      );
    }).pipe(Effect.runPromise);
  });

  it('spend the only Dust token', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      let walletState = yield* SubscriptionRef.get(stateRef);
      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(walletState);
      expect(availableCoins.length).toBe(1);

      // add more time to generate dust
      yield* simulator.fastForward(10n);

      // send one token to Bob
      simulatorState = yield* simulator.getLatestState();
      const nightTokens = getNightTokens(simulatorState, walletAddress);
      const sendToken = nightTokens.find((val) => val.value === awardTokens);
      expect(sendToken).toBeDefined();

      const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
      const bobAddress = bobKeyStore.getAddress();

      const inputs = [
        {
          ...sendToken!,
          owner: nightVerifyingKey,
        },
      ];
      const outputs = [
        {
          type: NIGHT_TOKEN_TYPE,
          owner: bobAddress,
          value: sendToken!.value,
        },
      ];
      const currentTime = getCurrentTime(simulatorState);
      const ttl = DateOps.addSeconds(currentTime, 1);
      const intent = Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(inputs, outputs, []);
      const transferTransaction = Transaction.fromParts(NETWORK, undefined, undefined, intent);

      walletState = yield* SubscriptionRef.get(stateRef);

      // capture fees
      const totalFee = yield* wallet.calculateFee([transferTransaction]);
      const walletBalance = walletVariant.coinsAndBalances.getWalletBalance(
        walletState,
        getCurrentTime(simulatorState),
      );
      expect(totalFee).toBeGreaterThan(0n);

      // cover fees with dust
      const balancingTransaction = yield* wallet.balanceTransactions(
        dustSecretKey,
        [transferTransaction],
        ttl,
        currentTime,
      );

      const balancedTransaction = transferTransaction.merge(balancingTransaction);

      const provenTransaction = yield* wallet.proveTransaction(balancedTransaction);

      // validate fee imbalance
      expect(Transacting.TransactingCapabilityImplementation.feeImbalance(provenTransaction, totalFee)).toBe(0n);

      yield* wallet.submitTransaction(provenTransaction);
      yield* waitForTx(stateRef, 11);

      walletState = yield* SubscriptionRef.get(stateRef);
      simulatorState = yield* simulator.getLatestState();
      expect(simulatorState.lastTxResult?.type).toBe('success');

      const lastTxNumber = Number(simulatorState.lastTxNumber);
      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoinsWithFullInfo(
        walletState,
        toTxTime(lastTxNumber),
      );
      expect(newAvailableCoins.length).toBe(1);
      expect(newAvailableCoins[0].dtime).toStrictEqual(DateOps.secondsToDate(lastTxNumber));

      // validate wallet balance changed to balance_now = balance_before - tx_fee
      expect(walletVariant.coinsAndBalances.getWalletBalance(walletState, toTxTime(lastTxNumber))).toBe(
        walletBalance - totalFee,
      );

      // validate it decays properly
      expect(walletVariant.coinsAndBalances.getWalletBalance(walletState, toTxTime(lastTxNumber + 1))).toBe(
        walletBalance - totalFee - newAvailableCoins[0].rate,
      );

      // validate at the maxCapReachedAt the balance will be 0
      expect(walletVariant.coinsAndBalances.getWalletBalance(walletState, newAvailableCoins[0].maxCapReachedAt)).toBe(
        0n,
      );

      // check there are no pending tokens left
      const pendingCoins = walletVariant.coinsAndBalances.getPendingCoins(walletState);
      expect(pendingCoins.length).toBe(0);
    }).pipe(Effect.runPromise);
  });

  it('deregisters from Dust generation', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000_000n;

      // reward & claim Night tokens
      const rewardNight = yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
      expect(rewardNight.blockNumber).toBe(1n);
      yield* waitForTx(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      let walletState = yield* SubscriptionRef.get(stateRef);
      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(walletState);
      expect(availableCoins.length).toBe(1);

      // add more time to generate dust
      yield* simulator.fastForward(10n);
      simulatorState = yield* simulator.getLatestState();

      // address_delegation should be not empty
      expect(simulatorState.ledger.dust.toString().includes('address_delegation: {}')).toBeFalsy();

      // deregister Night tokens from dust generation
      // NOTE: to only unregister the address, set the night tokens param to []
      yield* deregisterNightTokens(
        wallet,
        getNightTokensWithMeta(simulatorState, walletAddress),
        nightVerifyingKey,
        dustSecretKey,
      );
      yield* waitForTx(stateRef, 11);

      walletState = yield* SubscriptionRef.get(stateRef);
      simulatorState = yield* simulator.getLatestState();

      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoinsWithFullInfo(
        walletState,
        toTxTime(simulatorState.lastTxNumber),
      );
      expect(newAvailableCoins.length).toBe(1);
      expect(newAvailableCoins[0].dtime).toStrictEqual(DateOps.secondsToDate(simulatorState.lastTxNumber));

      // address_delegation should be empty
      expect(simulatorState.ledger.dust.toString()).toMatch(/address_delegation: {},/);
    }).pipe(Effect.runPromise);
  });
});
