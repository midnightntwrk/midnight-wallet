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
  UnshieldedOffer,
  type UserAddress,
} from '@midnight-ntwrk/ledger-v8';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { makeSimulatorProvingServiceEffect } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { beforeEach, describe, it } from '@vitest/runner';
import { Effect, Scope, Stream, SubscriptionRef } from 'effect';
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
import {
  Simulator,
  type SimulatorState,
  getCurrentBlockNumber,
  getLastBlock,
  getLastBlockResults,
} from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
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

// Get the "current time" for transaction creation.
// This should be 1 second ahead of the last block's timestamp to represent
// the expected time of the next block (matching the old lastTxNumber + 1 behavior).
const getCurrentTime = (simulatorState: SimulatorState) => DateOps.addSeconds(simulatorState.currentTime, 1);

// Waits until the wallet has synced and processed the block at the given number.
// appliedIndex semantics: next block to process = blockNumber + 1 after processing.
const waitForBlock = (stateRef: SubscriptionRef.SubscriptionRef<CoreWallet>, blockNumber: bigint | number) => {
  const targetAppliedIndex = BigInt(blockNumber) + 1n;
  const stream = stateRef.changes.pipe(Stream.find((val) => val.progress.appliedIndex >= targetAppliedIndex));
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
      expect(result.blockHeight).toBe(getCurrentBlockNumber(latestSimulatorState));
      expect(getLastBlockResults(latestSimulatorState)[0]?.type).toBe('success');
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
      expect(result.blockHeight).toBe(getCurrentBlockNumber(latestSimulatorState));
      expect(getLastBlockResults(latestSimulatorState)[0]?.type).toBe('success');
      return result;
    });
  };

  beforeEach(async () =>
    Effect.gen(function* () {
      const dustSeed = getDustSeed(SEED);
      keyStore = createUnshieldedKeystore(dustSeed);
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const scope = yield* Scope.make();

      simulator = yield* Simulator.init({ networkId: NETWORK }).pipe(Effect.provideService(Scope.Scope, scope));

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

      yield* simulator.rewardNight(nightVerifyingKey, awardTokens);
      const simulatorState = yield* simulator.getLatestState();
      expect(getCurrentBlockNumber(simulatorState)).toBe(1n);
      expect(getLastBlockResults(simulatorState)[0]?.type).toBe('success');

      const nightTokens = getNightTokens(yield* simulator.getLatestState(), walletAddress);
      yield* waitForBlock(stateRef, 1);

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
      yield* simulator.rewardNight(nightVerifyingKey, awardTokens);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(1n);
      yield* waitForBlock(stateRef, 1n);

      let latestState = yield* SubscriptionRef.get(stateRef);
      const walletBalance = walletVariant.coinsAndBalances.getWalletBalance(latestState, toTxTime(1));
      expect(walletBalance).toEqual(0n);

      const simulatorState = yield* simulator.getLatestState();
      const nightTokens = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokens.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokens, nightVerifyingKey);
      yield* waitForBlock(stateRef, 2);

      latestState = yield* SubscriptionRef.get(stateRef);
      const newWalletBalance = walletVariant.coinsAndBalances.getWalletBalance(latestState, toTxTime(3));
      expect(newWalletBalance).toBe(2_001_445_580_863_630n);
    }).pipe(Effect.runPromise);
  });

  it('should split night utxos between fallible and guaranteed section', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const walletAddress = keyStore.getAddress();
      const singleAwardTokens = 150_000_000_000n;
      const awardUtxos = 5;

      // reward & claim Night tokens
      yield* Effect.repeatN(simulator.rewardNight(nightVerifyingKey, singleAwardTokens), awardUtxos - 1);
      const maxBlockNr = getCurrentBlockNumber(yield* simulator.getLatestState());
      yield* waitForBlock(stateRef, maxBlockNr);

      const simulatorState = yield* simulator.getLatestState();
      const initialNightTokens = getNightTokensWithMeta(simulatorState, walletAddress);

      const { transaction } = yield* registerNightTokens(wallet, initialNightTokens, nightVerifyingKey);
      yield* waitForBlock(stateRef, maxBlockNr + 1n);

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
      yield* simulator.rewardNight(nightVerifyingKey, awardTokens);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(1n);
      yield* waitForBlock(stateRef, 1);

      const simulatorState = yield* simulator.getLatestState();
      const nightTokens = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokens.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokens, nightVerifyingKey);
      yield* waitForBlock(stateRef, 2);

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
      yield* simulator.rewardNight(nightVerifyingKey, awardTokens);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(1n);
      yield* waitForBlock(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForBlock(stateRef, 2);

      // get more night tokens with a different amount
      const newNightTokenAmount = 160_000_000_000n;
      yield* simulator.rewardNight(nightVerifyingKey, newNightTokenAmount);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(3n);
      simulatorState = yield* simulator.getLatestState();
      expect(getLastBlockResults(simulatorState)[0]?.type).toBe('success');
      yield* waitForBlock(stateRef, 3);

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
      yield* waitForBlock(stateRef, 4);

      simulatorState = yield* simulator.getLatestState();
      expect(getLastBlockResults(simulatorState)[0]?.type).toBe('success');

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
      yield* simulator.rewardNight(nightVerifyingKey, awardTokens);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(1n);
      yield* waitForBlock(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      let nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // get more night tokens with a different amount
      const newNightTokenAmount = 140_000_000_000n;
      yield* simulator.rewardNight(nightVerifyingKey, newNightTokenAmount);
      simulatorState = yield* simulator.getLatestState();
      expect(getCurrentBlockNumber(simulatorState)).toBe(2n);
      expect(getLastBlockResults(simulatorState)[0]?.type).toBe('success');
      yield* waitForBlock(stateRef, 2);

      // get one more night token with a different amount
      const newNightTokenAmount2 = 160_000_000_000n;
      yield* simulator.rewardNight(nightVerifyingKey, newNightTokenAmount2);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(3n);
      simulatorState = yield* simulator.getLatestState();
      expect(getLastBlockResults(simulatorState)[0]?.type).toBe('success');
      yield* waitForBlock(stateRef, 3);

      // verify we have 3 Night tokens
      nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(3);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForBlock(stateRef, 4);
      simulatorState = yield* simulator.getLatestState();

      const walletState = yield* SubscriptionRef.get(stateRef);
      const availableCoins = walletVariant.coinsAndBalances.getAvailableCoins(
        walletState,
        toTxTime(getCurrentBlockNumber(simulatorState)),
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
      yield* simulator.rewardNight(nightVerifyingKey, awardTokens);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(1n);
      yield* waitForBlock(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForBlock(stateRef, 2);

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

      const totalFee = yield* wallet.estimateFee(dustSecretKey, [transferTransaction], ttl, currentTime);

      // Capture wallet state before transaction for comparison
      // We'll compare balances at the block timestamp for consistency
      const walletStateBeforeTx = walletState;

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
      // Block 3: after rewardNight (1), registerNightTokens (2), and this submission (3)
      // Note: fastForward only advances time, not block numbers
      yield* waitForBlock(stateRef, 3);

      walletState = yield* SubscriptionRef.get(stateRef);
      simulatorState = yield* simulator.getLatestState();
      expect(getLastBlockResults(simulatorState)[0]?.type).toBe('success');

      const lastBlock = getLastBlock(simulatorState)!;
      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoins(walletState, lastBlock.timestamp);
      expect(newAvailableCoins.length).toBe(1);
      expect(newAvailableCoins[0].dtime).toStrictEqual(lastBlock.timestamp);

      // Query both balances at the same time point (block timestamp) for consistent comparison
      // This eliminates flakiness from comparing balances at different time points
      const walletBalanceBeforeTx = walletVariant.coinsAndBalances.getWalletBalance(
        walletStateBeforeTx,
        lastBlock.timestamp,
      );
      const walletBalanceAfterTx = walletVariant.coinsAndBalances.getWalletBalance(walletState, lastBlock.timestamp);

      // validate wallet balance changed to balance_now ≈ balance_before - tx_fee (±2% margin)
      expectWithMargin(walletBalanceAfterTx, walletBalanceBeforeTx - totalFee, totalFee);

      // The balance after paying the fee should be less than balance before minus fee
      // (because old coin has more decay than new coin at the same time point)
      expect(walletBalanceAfterTx).toBeLessThanOrEqual(walletBalanceBeforeTx - totalFee);

      // The balance difference should be close to the fee (within the decay amount for the time gap)
      // The time gap is roughly 10 seconds (from fastForward), so decay difference could be significant
      const decayTolerance = newAvailableCoins[0].rate * 11n; // ~11 seconds of decay difference
      expect(walletBalanceAfterTx).toBeGreaterThanOrEqual(walletBalanceBeforeTx - totalFee - decayTolerance);

      // validate it decays properly (±2% margin)
      // Use 1 second after block timestamp for decay validation
      const oneSecondAfterBlock = new Date(lastBlock.timestamp.getTime() + 1000);
      expectWithMargin(
        walletVariant.coinsAndBalances.getWalletBalance(walletState, oneSecondAfterBlock),
        walletBalanceBeforeTx - totalFee - newAvailableCoins[0].rate,
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
      yield* simulator.rewardNight(nightVerifyingKey, awardTokens);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(1n);
      yield* waitForBlock(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // register Night tokens to gain dust coins
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForBlock(stateRef, 2);

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
      yield* Effect.repeatN(simulator.rewardNight(nightVerifyingKey, singleAwardTokens), awardCount - 1);
      const maxBlockNr = getCurrentBlockNumber(yield* simulator.getLatestState());
      yield* waitForBlock(stateRef, maxBlockNr);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(awardCount);

      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForBlock(stateRef, maxBlockNr + 1n);

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

      yield* Effect.repeatN(simulator.rewardNight(nightVerifyingKey, singleAwardTokens), awardCount - 1);
      const maxBlockNr = getCurrentBlockNumber(yield* simulator.getLatestState());
      yield* waitForBlock(stateRef, maxBlockNr);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(awardCount);

      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForBlock(stateRef, maxBlockNr + 1n);

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

      // After balancing, we expect at least 1 pending coin (change output).
      // Note: With different simulator timing, multiple dust coins may or may not be spent.
      expect(pendingAfterBalance.length).toBeGreaterThanOrEqual(1);

      yield* wallet.revertTransaction(balancingTx);

      walletState = yield* SubscriptionRef.get(stateRef);
      expect(walletVariant.coinsAndBalances.getPendingCoins(walletState).length).toBe(0);
      expect(walletVariant.coinsAndBalances.getAvailableCoins(walletState).length).toBe(dustCoinsCount);
    }).pipe(Effect.runPromise);
  });

  it('deregisters from Dust generation', async () => {
    return Effect.gen(function* () {
      const nightVerifyingKey = keyStore.getPublicKey();
      const dustSecretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
      const walletAddress = keyStore.getAddress();
      const awardTokens = 150_000_000_000_000n;

      // reward & claim Night tokens
      yield* simulator.rewardNight(nightVerifyingKey, awardTokens);
      expect(getCurrentBlockNumber(yield* simulator.getLatestState())).toBe(1n);
      yield* waitForBlock(stateRef, 1);

      let simulatorState = yield* simulator.getLatestState();
      const nightTokensWithMeta = getNightTokensWithMeta(simulatorState, walletAddress);
      expect(nightTokensWithMeta.length).toBe(1);

      // register Night tokens
      yield* registerNightTokens(wallet, nightTokensWithMeta, nightVerifyingKey);
      yield* waitForBlock(stateRef, 2);

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
      // Block 3: after rewardNight (1), registerNightTokens (2), and deregisterNightTokens (3)
      // Note: fastForward only advances time, not block numbers
      yield* waitForBlock(stateRef, 3);

      walletState = yield* SubscriptionRef.get(stateRef);
      simulatorState = yield* simulator.getLatestState();

      const lastBlock = getLastBlock(simulatorState)!;
      const newAvailableCoins = walletVariant.coinsAndBalances.getAvailableCoins(walletState, lastBlock.timestamp);
      expect(newAvailableCoins.length).toBe(1);
      expect(newAvailableCoins[0].dtime).toStrictEqual(lastBlock.timestamp);

      // address_delegation should be empty
      expect(simulatorState.ledger.dust.toString()).toMatch(/address_delegation: {},/);
    }).pipe(Effect.runPromise);
  });
});
