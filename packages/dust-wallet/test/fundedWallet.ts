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
  LedgerParameters,
  nativeToken,
  type ProofErasedTransaction,
  type UserAddress,
} from '@midnight-ntwrk/ledger-v8';
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { makeSimulatorProvingServiceEffect } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import {
  Simulator,
  type SimulatorState,
  getCurrentBlockNumber,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import * as Submission from '@midnightntwrk/wallet-sdk-capabilities/submission';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Scope, Stream, SubscriptionRef } from 'effect';
import { CoreWallet, Transacting, type UtxoWithMeta, V1Builder } from '../src/v1/index.js';
import { makeSimulatorSyncCapability, makeSimulatorSyncService } from '../src/v1/Sync.js';
import {
  DustTransactionHistoryEntrySchema,
  makeSimulatorTransactionHistoryService,
} from '../src/v1/TransactionHistory.js';
import { createUnshieldedKeystore } from './UnshieldedKeyStore.js';
import { getDustSeed } from './utils.js';

/**
 * Drives a simulator-backed dust wallet until it holds real Dust, and hands back the resulting state.
 *
 * @remarks
 *   Snapshot tests need a wallet whose `DustLocalState` carries generation info, commitments and UTxOs, and the only
 *   honest way to get one is to let the wallet earn it: reward Night, register the Night UTxOs for Dust generation, and
 *   let the sync capability apply the resulting events. Hand-built states would pin whatever shape the test author
 *   imagined rather than the shape the wallet actually produces.
 *
 *   The setup mirrors `DustWallet.test.ts` — including its deliberately un-closed scope, which is what keeps the
 *   background sync alive after the effect returns.
 */
export const NETWORK = 'undeployed';
const NIGHT_TOKEN_TYPE = nativeToken().raw;
const dustParameters = LedgerParameters.initialParameters().dust;

const nightUtxosWithMeta = (state: SimulatorState, address: UserAddress): Array<UtxoWithMeta> =>
  [...state.ledger.utxo.filter(address)]
    .filter((utxo) => utxo.type === NIGHT_TOKEN_TYPE)
    .flatMap((utxo) => {
      const meta = state.ledger.utxo.lookupMeta(utxo);
      return meta ? [{ ...utxo, ctime: meta.ctime, registeredForDustGeneration: false }] : [];
    });

export type FundedWallet = {
  readonly wallet: CoreWallet;
  readonly secretKey: DustSecretKey;
};

/**
 * @param seedHex Wallet seed, so callers that need two distinct wallets can ask for them.
 * @param nightAwards How many Night rewards to earn before registering; more awards means more generation entries.
 */
export const makeFundedDustWallet = (seedHex: string, nightAwards = 2): Promise<FundedWallet> =>
  Effect.gen(function* () {
    const dustSeed = getDustSeed(seedHex);
    const keyStore = createUnshieldedKeystore(dustSeed);
    const secretKey = DustSecretKey.fromSeed(keyStore.getSecretKey());
    const scope = yield* Scope.make();

    const simulator = yield* Simulator.init({ networkId: NETWORK }).pipe(Effect.provideService(Scope.Scope, scope));

    const variant = new V1Builder()
      .withTransactionType<ProofErasedTransaction>()
      .withCoinSelectionDefaults()
      .withTransacting(Transacting.makeSimulatorTransactingCapability)
      .withSync(makeSimulatorSyncService, makeSimulatorSyncCapability)
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withSerializationDefaults()
      .withTransactionHistory(makeSimulatorTransactionHistoryService)
      .build({
        simulator,
        networkId: NETWORK,
        costParameters: { feeBlocksMargin: 5 },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(DustTransactionHistoryEntrySchema),
        indexerClientConnection: { indexerHttpUrl: '' },
      });

    const stateRef = yield* SubscriptionRef.make(CoreWallet.initEmpty(dustParameters, secretKey, NETWORK));
    const running = yield* variant.start({ stateRef }).pipe(Effect.provideService(Scope.Scope, scope));
    yield* running.startSyncInBackground(secretKey);

    const submissionService = Submission.makeSimulatorSubmissionService<ProofErasedTransaction>('InBlock')({
      simulator,
    });
    const provingService = makeSimulatorProvingServiceEffect();

    const awaitBlock = (blockNumber: bigint) =>
      Stream.runLast(stateRef.changes.pipe(Stream.find((state) => state.progress.appliedIndex >= blockNumber + 1n)));

    const nightVerifyingKey = keyStore.getPublicKey();
    yield* Effect.repeatN(simulator.rewardNight(nightVerifyingKey, 150_000_000_000n), nightAwards - 1);
    const rewardedAt = getCurrentBlockNumber(yield* simulator.getLatestState());
    yield* awaitBlock(rewardedAt);

    const simulatorState = yield* simulator.getLatestState();
    const currentTime = DateOps.addSeconds(simulatorState.currentTime, 1);
    const nightUtxos = nightUtxosWithMeta(simulatorState, keyStore.getAddress());

    const registration = yield* running.createDustGenerationTransaction(
      currentTime,
      DateOps.addSeconds(currentTime, 1),
      nightUtxos,
      nightVerifyingKey,
      new DustAddress((yield* SubscriptionRef.get(stateRef)).publicKey.publicKey),
    );
    const signature = keyStore.signData(registration.intents!.get(1)!.signatureData(1));
    const signed = yield* running.addDustGenerationSignature(registration, signature);
    yield* submissionService.submitTransaction(yield* provingService.prove(signed), 'InBlock');
    yield* awaitBlock(rewardedAt + 1n);

    return { wallet: yield* SubscriptionRef.get(stateRef), secretKey };
  }).pipe(Effect.scoped, Effect.runPromise);
