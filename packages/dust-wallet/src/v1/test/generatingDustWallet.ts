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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { InMemoryTransactionHistoryStorage, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Scope, Stream, SubscriptionRef } from 'effect';
import { getDustSeed } from '../../../test/utils.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeSimulatorSyncCapability, makeSimulatorSyncService } from '../Sync.js';
import { DustTransactionHistoryEntrySchema, makeSimulatorTransactionHistoryService } from '../TransactionHistory.js';
import { makeSimulatorTransactingCapability } from '../Transacting.js';
import type { UtxoWithMeta } from '../types/index.js';
import { V1Builder } from '../V1Builder.js';

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
    // Ledger-v8 keys are hex strings, derived here with ledger-v8's own functions rather than the ledger-v9 key store.
    const seed = getDustSeed('00'.repeat(31) + '01');
    const signingKey: ledger.SigningKey = Buffer.from(seed).toString('hex');
    const verifyingKey = ledger.signatureVerifyingKey(signingKey);
    const address = ledger.addressFromKey(verifyingKey);
    const dustSecretKey = ledger.DustSecretKey.fromSeed(seed);
    const scope = yield* Scope.Scope;
    const simulator = yield* V8.Simulator.init({ networkId: NETWORK });

    const variant = new V1Builder()
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
    const waitForBlock = (block: bigint) =>
      Stream.runLast(stateRef.changes.pipe(Stream.find((state) => state.progress.appliedIndex >= block + 1n)));

    yield* simulator.rewardNight(verifyingKey, NIGHT_AWARD);
    yield* waitForBlock(1n);
    yield* simulator.fastForward(SECONDS_BEFORE_REGISTERING);

    const rewarded = yield* simulator.getLatestState();
    const nightUtxos: ReadonlyArray<UtxoWithMeta> = [...rewarded.ledger.utxo.filter(address)]
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
      verifyingKey,
      new DustAddress((yield* SubscriptionRef.get(stateRef)).publicKey.publicKey),
    );
    const signed = yield* wallet.addDustGenerationSignature(
      registration,
      ledger.signData(signingKey, registration.intents!.get(1)!.signatureData(1)),
    );
    // The simulator proves by erasing proofs; it has no ledger-v8 submission service, so submit to it directly.
    yield* simulator.submitTransaction(signed.eraseProofs());
    yield* waitForBlock(2n);

    const registered = yield* simulator.getLatestState();
    return {
      dustSecretKey,
      state: yield* SubscriptionRef.get(stateRef),
      ledgerParameters: registered.ledger.parameters,
      now: DateOps.addSeconds(registered.currentTime, 1),
      recipient: ledger.addressFromKey(
        ledger.signatureVerifyingKey(Buffer.from(getDustSeed('00'.repeat(31) + '02')).toString('hex')),
      ),
    };
  },
);
