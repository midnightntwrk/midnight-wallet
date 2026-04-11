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
import {
  DustSecretKey,
  Intent,
  LedgerParameters,
  nativeToken,
  type ProofErasedTransaction,
  Transaction,
  type UnprovenTransaction,
  UnshieldedOffer,
  type UserAddress,
} from '@midnight-ntwrk/ledger-v8';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { makeSimulatorProvingServiceEffect } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import { getBalanceRecipe, Imbalances as CapImbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { beforeEach, describe, it } from '@vitest/runner';
import { BigInt as BI, Chunk, Effect, Scope, Stream, SubscriptionRef } from 'effect';
import * as Submission from '@midnight-ntwrk/wallet-sdk-capabilities/submission';

import { expect, vi } from 'vitest';
import {
  CoreWallet,
  type RunningV1Variant,
  Transacting,
  type UtxoWithMeta,
  V1Builder,
  type V1Variant,
} from '../src/v1/index.js';
import { type AnyTransaction } from '../src/v1/types/ledger.js';
import { Simulator, type SimulatorState } from '../src/v1/Simulator.js';
import { makeSimulatorSyncCapability, makeSimulatorSyncService, type SimulatorSyncUpdate } from '../src/v1/Sync.js';
import { createUnshieldedKeystore, type UnshieldedKeystore } from './UnshieldedKeyStore.js';
import { getDustSeed, sumUtxos } from './utils.js';

vi.setConfig({ testTimeout: 10000 });

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
        result.push({ ...utxo, ctime: meta.ctime, registeredForDustGeneration: false });
      }
    }
  }
  return result;
};

const toTxTime = (secs: number | bigint): Date => new Date(Number(secs) * 1000);

const getCurrentTime = (simulatorState: SimulatorState) => DateOps.addSeconds(toTxTime(simulatorState.lastTxNumber), 1);

const waitForTx = (stateRef: SubscriptionRef.SubscriptionRef<CoreWallet>, txTime: bigint | number) => {
  const stream = stateRef.changes.pipe(Stream.find((val) => val.progress.appliedIndex === BigInt(txTime)));
  return Stream.runLast(stream);
};

const expectWithMargin = (actual: bigint, expected: bigint, reference: bigint, marginPercent = 2n) => {
  const diff = actual > expected ? actual - expected : expected - actual;
  const margin = (reference * marginPercent) / 100n;
  expect(diff).toBeLessThanOrEqual(margin);
};

type WalletVariant = V1Variant<string, SimulatorSyncUpdate, ProofErasedTransaction, DustSecretKey>;
type RunningWallet = RunningV1Variant<string, SimulatorSyncUpdate, ProofErasedTransaction, DustSecretKey>;

describe('DustWallet', () => {
  const costParameters = {
    feeBlocksMargin: 5,
  };
  const dustParameters = LedgerParameters.initialParameters().dust;
  let walletVariant: WalletVariant;
  let wallet: RunningWallet;
  let stateRef: SubscriptionRef.SubscriptionRef<CoreWallet>;
  let simulator: Simulator;
  let keyStore: UnshieldedKeystore;
  let submissionService: Submission.SubmissionServiceEffect<ProofErasedTransaction>;
  const provingService = makeSimulatorProvingServiceEffect();

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
        new DustAddress(lastState.publicKey.publicKey),
      );

      const intent = registerForDustTransaction.intents!.get(1);
      const intentSignatureData = intent!.signatureData(1);
      const signature = keyStore.signData(intentSignatureData);
      const dustGenerationTransaction = yield* wallet.addDustGenerationSignature(registerForDustTransaction, signature);

      const transaction = yield* provingService.prove(dustGenerationTransaction);
      const result = yield* submissionService.submitTransaction(transaction, 'InBlock');
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

      const deRegisterForDustTransaction = yield* wallet.createDustGenerationTransaction(
        currentTime,
        ttl,
        nightTokens,
        nightVerifyingKey,
        undefined,
      );

      const balancingTransaction = yield* wallet.balanceTransactions(
        dustSecretKey,
        [deRegisterForDustTransaction],
        ttl,
        currentTime,
      );

      const balancedTransaction = deRegisterForDustTransaction.merge(balancingTransaction);

      const intent = balancedTransaction.intents!.get(1);
      const intentSignatureData = intent!.signatureData(1);
      const signature = keyStore.signData(intentSignatureData);
      const dustGenerationTransaction = yield* wallet.addDustGenerationSignature(balancedTransaction, signature);

      const transaction = yield* provingService.prove(dustGenerationTransaction);
      const result = yield* submissionService.submitTransaction(transaction, 'InBlock');
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
        .withCoinSelectionDefaults()
        .withTransacting(Transacting.makeSimulatorTransactingCapability)
        .withSync(makeSimulatorSyncService, makeSimulatorSyncCapability)
        .withCoinsAndBalancesDefaults()
        .withKeysDefaults()
        .withSerializationDefaults()
        .build({
          simulator,
          networkId: NETWORK,
          costParameters,
        });

      const initialState = CoreWallet.initEmpty(dustParameters, dustSecretKey, NETWORK);
      stateRef = yield* SubscriptionRef.make(initialState);
      wallet = yield* walletVariant.start({ stateRef }).pipe(Effect.provideService(Scope.Scope, scope));
      yield* wallet.startSyncInBackground(dustSecretKey);

      submissionService = Submission.makeSimulatorSubmissionService<ProofErasedTransaction>('InBlock')({ simulator });
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
      expect(newWalletBalance).toBe(2_023_348_759_707_626n);
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
      expect(DateOps.dateToSeconds(availableCoins.at(0)!.token.ctime)).toBe(2n);

      const pendingCoins = walletVariant.coinsAndBalances.getPendingCoins(latestState);
      expect(pendingCoins.length).toBe(0);

      const generationInfo = walletVariant.coinsAndBalances.getGenerationInfo(latestState, availableCoins.at(0)!.token);
      expect(generationInfo?.value).toBe(awardTokens);
    }).pipe(Effect.runPromise);
  });

  it('should allow spending Dust', async () => {
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

      const provenTransaction = yield* provingService.prove(balancedTransaction);

      yield* submissionService.submitTransaction(provenTransaction, 'InBlock');
      yield* waitForTx(stateRef, 4);

      simulatorState = yield* simulator.getLatestState();
      expect(simulatorState.lastTxResult?.type).toBe('success');

      const latestState = yield* SubscriptionRef.get(stateRef);
      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoins(latestState);
      const generationInfo = walletVariant.coinsAndBalances.getGenerationInfo(
        latestState,
        newAvailableCoins.find((c) => c.token.seq === 0)!.token,
      );
      expect(newAvailableCoins.length).toBe(2);
      expect(newAvailableCoins.some((coin) => DateOps.dateToSeconds(coin.token.ctime) === 4n)).toBe(true);
      expect(generationInfo?.dtime).toStrictEqual(DateOps.secondsToDate(4n));

      const pendingCoins = walletVariant.coinsAndBalances.getPendingCoins(latestState);
      expect(pendingCoins.length).toBe(0);
    }).pipe(Effect.runPromise);
  });

  it('should allow spending multiple Dust', async () => {
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
      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(
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

  it('spend the only Dust', async () => {
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

      const totalFee = yield* wallet.estimateFee(dustSecretKey, [transferTransaction], ttl, currentTime);

      const walletBalance = walletVariant.coinsAndBalances.getWalletBalance(
        walletState,
        getCurrentTime(simulatorState),
      );

      // cover fees with dust
      const balancingTransaction = yield* wallet.balanceTransactions(
        dustSecretKey,
        [transferTransaction],
        ttl,
        currentTime,
      );

      const balancedTransaction = transferTransaction.merge(balancingTransaction);

      const provenTransaction = yield* provingService.prove(balancedTransaction);

      // validate fee imbalance, allowing ±2% margin due to non-deterministic transaction serialization
      const feeImbalance = Transacting.TransactingCapabilityImplementation.feeImbalance(provenTransaction, totalFee);
      expectWithMargin(feeImbalance, 0n, totalFee);

      yield* submissionService.submitTransaction(provenTransaction, 'InBlock');
      yield* waitForTx(stateRef, 11);

      walletState = yield* SubscriptionRef.get(stateRef);
      simulatorState = yield* simulator.getLatestState();
      expect(simulatorState.lastTxResult?.type).toBe('success');

      const lastTxNumber = Number(simulatorState.lastTxNumber);
      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoins(walletState, toTxTime(lastTxNumber));
      expect(newAvailableCoins.length).toBe(1);
      expect(newAvailableCoins[0].dtime).toStrictEqual(DateOps.secondsToDate(lastTxNumber));

      // validate wallet balance changed to balance_now ≈ balance_before - tx_fee (±2% margin)
      expectWithMargin(
        walletVariant.coinsAndBalances.getWalletBalance(walletState, toTxTime(lastTxNumber)),
        walletBalance - totalFee,
        totalFee,
      );

      // validate it decays properly (±2% margin)
      expectWithMargin(
        walletVariant.coinsAndBalances.getWalletBalance(walletState, toTxTime(lastTxNumber + 1)),
        walletBalance - totalFee - newAvailableCoins[0].rate,
        totalFee,
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

  it('should revert a transaction and clear pending dust', async () => {
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

      // register Night tokens to gain dust coins
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForTx(stateRef, 2);

      let walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getAvailableCoins(walletState).length).toBe(1);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(0);

      // fast-forward time to accumulate enough dust to cover fees
      yield* simulator.fastForward(10n);

      simulatorState = yield* simulator.getLatestState();
      const currentTime = getCurrentTime(simulatorState);
      const ttl = DateOps.addSeconds(currentTime, 1);

      // build a transfer transaction that requires dust for fees
      const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
      const bobAddress = bobKeyStore.getAddress();
      const nightTokens = getNightTokens(simulatorState, walletAddress);
      const sendToken = nightTokens[0];

      const inputs = [{ ...sendToken, owner: nightVerifyingKey }];
      const outputs = [{ type: NIGHT_TOKEN_TYPE, owner: bobAddress, value: sendToken.value }];
      const intent = Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(inputs, outputs, []);
      const transferTransaction = Transaction.fromParts(NETWORK, undefined, undefined, intent);

      // balance the transaction — this marks dust as pending
      const balancingTransaction = yield* wallet.balanceTransactions(
        dustSecretKey,
        [transferTransaction],
        ttl,
        currentTime,
      );

      walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBeGreaterThan(0);

      // revert the balancing transaction (simulating the underlying tx being rejected)
      yield* wallet.revertTransaction(balancingTransaction);

      walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(0);
      expect(walletVariant.coinsAndBalances.getAvailableCoins(walletState).length).toBe(1);
    }).pipe(Effect.runPromise);
  });

  it('should preserve pending coins of the non-reverted tx when reverting one of two balanced txs', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const walletAddress = keyStore.getAddress();
      const singleAwardTokens = 150_000_000_000n;
      const awardCount = 5;

      // reward 5 night tokens — registering all at once produces 2 dust coins (guaranteed + fallible)
      const nightRewards: Chunk.Chunk<{ blockNumber: bigint }> = yield* Stream.repeatEffect(
        simulator.rewardNight(walletAddress, singleAwardTokens, nightVerifyingKey),
      ).pipe(Stream.take(awardCount), Stream.runCollect);
      const maxBlockNr = nightRewards.pipe(
        Chunk.map(({ blockNumber }) => blockNumber),
        Chunk.reduceRight(0n, BI.max),
      );
      yield* waitForTx(stateRef, maxBlockNr);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(awardCount);

      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForTx(stateRef, maxBlockNr + 1n);

      let walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getAvailableCoins(walletState).length).toBe(2);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(0);

      // fast-forward to accumulate enough dust to cover fees for both transactions
      yield* simulator.fastForward(10n);

      simulatorState = yield* simulator.getLatestState();
      const currentTime = getCurrentTime(simulatorState);
      const ttl = DateOps.addSeconds(currentTime, 1);

      const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
      const bobAddress = bobKeyStore.getAddress();
      const nightTokens = getNightTokens(simulatorState, walletAddress);
      expect(nightTokens.length).toBe(2);

      const makeTransferTx = (sendToken: (typeof nightTokens)[0]) => {
        const intent = Intent.new(ttl);
        intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(
          [{ ...sendToken, owner: nightVerifyingKey }],
          [{ type: NIGHT_TOKEN_TYPE, owner: bobAddress, value: sendToken.value }],
          [],
        );
        return Transaction.fromParts(NETWORK, undefined, undefined, intent);
      };

      // balance two separate transactions — each picks a different dust coin
      const balancingTx1 = yield* wallet.balanceTransactions(
        dustSecretKey,
        [makeTransferTx(nightTokens[0])],
        ttl,
        currentTime,
      );

      const balancingTx2 = yield* wallet.balanceTransactions(
        dustSecretKey,
        [makeTransferTx(nightTokens[1])],
        ttl,
        currentTime,
      );

      walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(2);

      // revert only the first balancing transaction
      yield* wallet.revertTransaction(balancingTx1);

      walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(1);
      expect(walletVariant.coinsAndBalances.getAvailableCoins(walletState).length).toBe(1);

      // revert the second tx
      yield* wallet.revertTransaction(balancingTx2);

      walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(0);
      expect(walletVariant.coinsAndBalances.getAvailableCoins(walletState).length).toBe(2);
    }).pipe(Effect.runPromise);
  });

  it('should revert a transaction that spent multiple dust coins in a single balance call', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const walletAddress = keyStore.getAddress();
      const singleAwardTokens = 150_000_000_000n;
      const awardCount = 5;

      const nightRewards: Chunk.Chunk<{ blockNumber: bigint }> = yield* Stream.repeatEffect(
        simulator.rewardNight(walletAddress, singleAwardTokens, nightVerifyingKey),
      ).pipe(Stream.take(awardCount), Stream.runCollect);
      const maxBlockNr = nightRewards.pipe(
        Chunk.map(({ blockNumber }) => blockNumber),
        Chunk.reduceRight(0n, BI.max),
      );
      yield* waitForTx(stateRef, maxBlockNr);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(awardCount);

      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForTx(stateRef, maxBlockNr + 1n);

      let walletState = yield* SubscriptionRef.get(stateRef);
      const dustCoinsCount = walletVariant.coinsAndBalances.getAvailableCoins(walletState).length;
      expect(dustCoinsCount).toBe(2);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(0);

      yield* simulator.fastForward(10n);

      simulatorState = yield* simulator.getLatestState();
      const currentTime = getCurrentTime(simulatorState);
      const ttl = DateOps.addSeconds(currentTime, 1);

      const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
      const bobAddress = bobKeyStore.getAddress();
      const nightTokens = getNightTokens(simulatorState, walletAddress);

      const makeTransferTx = (sendToken: (typeof nightTokens)[0]) => {
        const intent = Intent.new(ttl);
        intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(
          [{ ...sendToken, owner: nightVerifyingKey }],
          [{ type: NIGHT_TOKEN_TYPE, owner: bobAddress, value: sendToken.value }],
          [],
        );
        return Transaction.fromPartsRandomized(NETWORK, undefined, undefined, intent);
      };

      const transferTxs = Array.from({ length: 40 }, () => makeTransferTx(nightTokens[0]));

      const balancingTx = yield* wallet.balanceTransactions(dustSecretKey, transferTxs, ttl, currentTime);

      walletState = yield* SubscriptionRef.get(stateRef);
      const pendingAfterBalance = walletVariant.coinsAndBalances.getPendingCoins(walletState);

      expect(pendingAfterBalance.length).toBeGreaterThan(1);

      yield* wallet.revertTransaction(balancingTx);

      walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(0);
      expect(walletVariant.coinsAndBalances.getAvailableCoins(walletState).length).toBe(dustCoinsCount);
    }).pipe(Effect.runPromise);
  });

  describe('external transaction shapes', () => {
    // Covers transaction structures from external dApps (via midnight-js / dApp connector)
    // that the existing wallet-originated tests never exercise.

    const setupDustCoins = () =>
      Effect.gen(function* () {
        const nightVerifyingKey = keyStore.getPublicKey();
        const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
        const walletAddress = keyStore.getAddress();
        const awardTokens = 150_000_000_000n;

        yield* simulator.rewardNight(walletAddress, awardTokens, nightVerifyingKey);
        yield* waitForTx(stateRef, 1);

        const simulatorState = yield* simulator.getLatestState();
        const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
        yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
        yield* waitForTx(stateRef, 2);

        yield* simulator.fastForward(10n);

        const latestSimState = yield* simulator.getLatestState();
        const currentTime = getCurrentTime(latestSimState);
        const ttl = DateOps.addSeconds(currentTime, 1);
        const nightTokens = getNightTokens(latestSimState, walletAddress);

        return { nightVerifyingKey, dustSecretKey, walletAddress, currentTime, ttl, nightTokens, latestSimState };
      });

    it('getBalanceRecipe selects 0 coins when dust imbalance is positive', () => {
      // getBalanceRecipe treats positive imbalance as surplus (no coins needed)
      // and negative as deficit (coins selected). The convergence loop in
      // computeBalancingRecipe must negate positive fees before calling this.
      type CoinStub = { type: string; value: bigint };
      const coins = [{ type: 'dust', value: 100n, token: { type: 'dust' as const, value: 100n } }];
      const balancerArgs = {
        coins,
        feeTokenType: 'dust',
        transactionCostModel: { inputFeeOverhead: 0n, outputFeeOverhead: 0n },
        createOutput: (coin: CoinStub) => coin,
        isCoinEqual: (a: CoinStub, b: CoinStub) => a.type === b.type && a.value === b.value,
      };

      const buggyRecipe = getBalanceRecipe({
        ...balancerArgs,
        initialImbalances: CapImbalances.fromEntry('dust', 5n),
      });
      expect(buggyRecipe.inputs).toHaveLength(0);

      const fixedRecipe = getBalanceRecipe({
        ...balancerArgs,
        initialImbalances: CapImbalances.fromEntry('dust', -5n),
      });
      expect(fixedRecipe.inputs).toHaveLength(1);
    });

    it('balanceTransactions handles fallible-only transaction', async () => {
      return Effect.gen(function* () {
        const { dustSecretKey, nightVerifyingKey, currentTime, ttl, nightTokens } = yield* setupDustCoins();

        const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
        const bobAddress = bobKeyStore.getAddress();
        const sendToken = nightTokens[0];

        const intent = Intent.new(ttl);
        intent.fallibleUnshieldedOffer = UnshieldedOffer.new(
          [{ ...sendToken, owner: nightVerifyingKey }],
          [{ type: NIGHT_TOKEN_TYPE, owner: bobAddress, value: sendToken.value }],
          [],
        );
        const tx = Transaction.fromPartsRandomized(NETWORK, undefined, undefined, intent);

        const balancingTx = yield* wallet.balanceTransactions(dustSecretKey, [tx], ttl, currentTime);
        const merged = tx.merge(balancingTx);
        expect(merged).toBeTruthy();
      }).pipe(Effect.runPromise);
    });

    it('balanceTransactions handles transaction with both guaranteed and fallible content', async () => {
      return Effect.gen(function* () {
        const { dustSecretKey, nightVerifyingKey, currentTime, ttl, nightTokens } = yield* setupDustCoins();

        const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
        const bobAddress = bobKeyStore.getAddress();
        const sendToken = nightTokens[0];

        const inputs = [{ ...sendToken, owner: nightVerifyingKey }];
        const outputs = [{ type: NIGHT_TOKEN_TYPE, owner: bobAddress, value: sendToken.value }];

        const intent = Intent.new(ttl);
        intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(inputs, outputs, []);
        intent.fallibleUnshieldedOffer = UnshieldedOffer.new([], [], []);
        const tx = Transaction.fromPartsRandomized(NETWORK, undefined, undefined, intent);

        const balancingTx = yield* wallet.balanceTransactions(dustSecretKey, [tx], ttl, currentTime);
        const merged = tx.merge(balancingTx);
        expect(merged).toBeTruthy();
      }).pipe(Effect.runPromise);
    });

    it('feeImbalance includes fee as dust deficit even for bare intent', () => {
      // imbalances(0, fee) always includes the fee as a dust deficit regardless
      // of transaction content. initialFees = 0 only occurs when the transaction's
      // dust content exactly offsets the fee (dApp connector contract calls).
      const ttl = new Date(60_000);
      const intent = Intent.new(ttl);
      const tx = Transaction.fromPartsRandomized(NETWORK, undefined, undefined, intent);
      const fee = 5n;

      const imbalance = Transacting.TransactingCapabilityImplementation.feeImbalance(tx, fee);
      expect(imbalance).toBe(-fee);
    });

    it('balanceTransactions handles serialization round-trip transaction', async () => {
      return Effect.gen(function* () {
        const { dustSecretKey, nightVerifyingKey, currentTime, ttl, nightTokens } = yield* setupDustCoins();

        const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
        const bobAddress = bobKeyStore.getAddress();
        const sendToken = nightTokens[0];

        const intent = Intent.new(ttl);
        intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(
          [{ ...sendToken, owner: nightVerifyingKey }],
          [{ type: NIGHT_TOKEN_TYPE, owner: bobAddress, value: sendToken.value }],
          [],
        );
        const originalTx = Transaction.fromPartsRandomized(NETWORK, undefined, undefined, intent);

        const serialized = originalTx.serialize();
        // Cast required: TS can't infer generics back from string literal markers.
        const deserializedTx = Transaction.deserialize(
          'signature',
          'pre-proof',
          'pre-binding',
          serialized,
        ) as UnprovenTransaction;

        const balancingTx = yield* wallet.balanceTransactions(dustSecretKey, [deserializedTx], ttl, currentTime);
        const merged = deserializedTx.merge(balancingTx);
        expect(merged).toBeTruthy();
      }).pipe(Effect.runPromise);
    });

    it('convergence loop hangs when initialFees is 0 (fee sign bug)', async () => {
      // When initialFees = 0, the convergence loop's first iteration selects 0
      // coins. dryRunFee returns a positive fee that feeds back without negation,
      // causing getBalanceRecipe to interpret it as surplus — infinite loop.
      // Stub returns 0 for the initial calculateFee, real fees for dry runs.
      class ZeroInitialFeeTransacting extends Transacting.TransactingCapabilityImplementation<ProofErasedTransaction> {
        #initialCallDone = false;

        calculateFee(transaction: AnyTransaction, ledgerParams: LedgerParameters): bigint {
          if (!this.#initialCallDone) {
            this.#initialCallDone = true;
            return 0n;
          }
          return super.calculateFee(transaction, ledgerParams);
        }
      }

      const makeZeroInitialFeeTransacting = (
        config: Transacting.DefaultTransactingConfiguration,
        getContext: () => Transacting.DefaultTransactingContext,
      ): Transacting.TransactingCapability<DustSecretKey, CoreWallet, ProofErasedTransaction> =>
        new ZeroInitialFeeTransacting(
          config.networkId,
          config.costParameters,
          () => getContext().coinSelection,
          () => getContext().coinsAndBalancesCapability,
          () => getContext().keysCapability,
        );

      return Effect.gen(function* () {
        const scope = yield* Scope.make();

        // Build a wallet variant with zero-fee transacting capability
        const zeroFeeVariant = new V1Builder()
          .withTransactionType<ProofErasedTransaction>()
          .withCoinSelectionDefaults()
          .withTransacting(makeZeroInitialFeeTransacting)
          .withSync(makeSimulatorSyncService, makeSimulatorSyncCapability)
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withSerializationDefaults()
          .build({ simulator, networkId: NETWORK, costParameters });

        const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
        const zeroFeeStateRef = yield* SubscriptionRef.make(
          CoreWallet.initEmpty(LedgerParameters.initialParameters().dust, dustSecretKey, NETWORK),
        );
        const zeroFeeWallet = yield* zeroFeeVariant
          .start({ stateRef: zeroFeeStateRef })
          .pipe(Effect.provideService(Scope.Scope, scope));
        yield* zeroFeeWallet.startSyncInBackground(dustSecretKey);

        // Set up dust coins using the shared simulator
        const nightVerifyingKey = keyStore.getPublicKey();
        const walletAddress = keyStore.getAddress();

        yield* simulator.rewardNight(walletAddress, 150_000_000_000n, nightVerifyingKey);
        yield* waitForTx(zeroFeeStateRef, 1);

        const simulatorState = yield* simulator.getLatestState();
        const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
        yield* registerNightTokens(zeroFeeWallet, nightTokensWithMeta, nightVerifyingKey);
        yield* waitForTx(zeroFeeStateRef, 2);

        yield* simulator.fastForward(10n);

        const latestSimState = yield* simulator.getLatestState();
        const currentTime = getCurrentTime(latestSimState);
        const ttl = DateOps.addSeconds(currentTime, 1);
        const nightTokens = getNightTokens(latestSimState, walletAddress);
        const sendToken = nightTokens[0];

        const bobKeyStore = createUnshieldedKeystore(getDustSeed(SEED_BOB));
        const bobAddress = bobKeyStore.getAddress();

        const intent = Intent.new(ttl);
        intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(
          [{ ...sendToken, owner: nightVerifyingKey }],
          [{ type: NIGHT_TOKEN_TYPE, owner: bobAddress, value: sendToken.value }],
          [],
        );
        const tx = Transaction.fromPartsRandomized(NETWORK, undefined, undefined, intent);

        // With calculateFee returning 0, initialFees = 0, triggering the sign bug
        const balancingTx = yield* zeroFeeWallet.balanceTransactions(dustSecretKey, [tx], ttl, currentTime);
        expect(balancingTx).toBeTruthy();
      }).pipe(Effect.scoped, Effect.runPromise);
    }, 15_000);
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

      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoins(
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
