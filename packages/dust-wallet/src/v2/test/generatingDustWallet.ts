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
import * as ledger from '@midnightntwrk/ledger-v9';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { InMemoryTransactionHistoryStorage, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { makeV9SimulatorProvingServiceEffect } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import * as Submission from '@midnightntwrk/wallet-sdk-capabilities/submission';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Scope, Stream, SubscriptionRef } from 'effect';
import { createUnshieldedKeystore } from '../../../test/UnshieldedKeyStore.js';
import { getDustSeed } from '../../../test/utils.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeSimulatorSyncCapability, makeSimulatorSyncService } from '../Sync.js';
import { DustTransactionHistoryEntrySchema, makeSimulatorTransactionHistoryService } from '../TransactionHistory.js';
import { makeSimulatorTransactingCapability } from '../Transacting.js';
import type { UtxoWithMeta } from '../types/index.js';
import { V2Builder } from '../V2Builder.js';

export const NETWORK = 'undeployed';
export const NIGHT = ledger.nativeToken().raw;
export const COST_PARAMETERS = { feeBlocksMargin: 5 };

// Small enough that Dust accrues a few trillion per second, so a whole-second step can land inside the window between
// a transaction's fee and that fee plus one Dust spend; a larger holding jumps straight over it.
const NIGHT_AWARD = 1_000_000_000n;
// Long enough for the Night to pay for its own registration, short enough that what is left starts below that window.
const SECONDS_BEFORE_REGISTERING = 100n;

/** What a test needs from the generating wallet: its keys and state, the chain's parameters and clock, and a payee. */
export type GeneratingDustWallet = {
  readonly dustSecretKey: ledger.DustSecretKey;
  readonly state: CoreWallet;
  readonly ledgerParameters: ledger.LedgerParameters;
  readonly now: Date;
  readonly recipient: ledger.UserAddress;
};

/** A wallet holding exactly one Dust coin, generating from a small Night holding in the in-memory simulator. */
export const walletWithOneGeneratingDustCoin: Effect.Effect<GeneratingDustWallet, unknown, Scope.Scope> = Effect.gen(
  function* () {
    const keyStore = createUnshieldedKeystore({ kind: 'schnorr', secret: getDustSeed('00'.repeat(31) + '01') });
    const dustSecretKey = ledger.DustSecretKey.fromSeed(keyStore.getSecretKey());
    const scope = yield* Scope.Scope;
    const simulator = yield* V9.Simulator.init({ networkId: NETWORK });

    const variant = new V2Builder()
      .withTransactionType<ledger.ProofErasedTransaction>()
      .withCoinSelectionDefaults()
      .withTransacting(makeSimulatorTransactingCapability)
      .withSync(makeSimulatorSyncService, makeSimulatorSyncCapability)
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withStartAuxDefaults()
      .withSerializationDefaults()
      .withTransactionHistory(makeSimulatorTransactionHistoryService)
      .build({
        simulator,
        networkId: NETWORK,
        costParameters: COST_PARAMETERS,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(DustTransactionHistoryEntrySchema),
        indexerClientConnection: { indexerHttpUrl: '' },
      });
    const stateRef = yield* SubscriptionRef.make(
      CoreWallet.initEmpty(ledger.LedgerParameters.initialParameters().dust, dustSecretKey, NETWORK),
    );
    const wallet = yield* variant
      .start({
        stateRef,
        activationRange: ProtocolVersion.makeRange(
          ProtocolVersion.MinSupportedVersion,
          ProtocolVersion.MaxSupportedVersion,
        ),
      })
      .pipe(Effect.provideService(Scope.Scope, scope));
    yield* wallet.startSyncInBackground(dustSecretKey);
    const submission = Submission.makeV9SimulatorSubmissionService<ledger.ProofErasedTransaction>('InBlock')({
      simulator,
    });
    const waitForBlock = (block: bigint) =>
      Stream.runLast(stateRef.changes.pipe(Stream.find((state) => state.progress.appliedIndex >= block + 1n)));

    yield* simulator.rewardNight(keyStore.getPublicKey(), NIGHT_AWARD);
    yield* waitForBlock(1n);
    yield* simulator.fastForward(SECONDS_BEFORE_REGISTERING);

    const rewarded = yield* simulator.getLatestState();
    const nightUtxos: ReadonlyArray<UtxoWithMeta> = [...rewarded.ledger.utxo.filter(keyStore.getAddress())]
      .filter((utxo) => utxo.type === NIGHT)
      .map((utxo) => ({
        ...utxo,
        ctime: rewarded.ledger.utxo.lookupMeta(utxo)!.ctime,
        registeredForDustGeneration: false,
      }));
    const registeredAt = DateOps.addSeconds(rewarded.currentTime, 1);
    const registration = yield* wallet.createDustGenerationTransaction(
      registeredAt,
      DateOps.addSeconds(registeredAt, 1),
      nightUtxos,
      keyStore.getPublicKey(),
      new DustAddress((yield* SubscriptionRef.get(stateRef)).publicKey.publicKey),
    );
    const signed = yield* wallet.addDustGenerationSignature(
      registration,
      keyStore.signData(registration.intents!.get(1)!.signatureData(1)),
    );
    yield* submission.submitTransaction(yield* makeV9SimulatorProvingServiceEffect().prove(signed), 'InBlock');
    yield* waitForBlock(2n);

    const registered = yield* simulator.getLatestState();
    return {
      dustSecretKey,
      state: yield* SubscriptionRef.get(stateRef),
      ledgerParameters: registered.ledger.parameters,
      now: DateOps.addSeconds(registered.currentTime, 1),
      recipient: createUnshieldedKeystore({
        kind: 'schnorr',
        secret: getDustSeed('00'.repeat(31) + '02'),
      }).getAddress(),
    };
  },
);
