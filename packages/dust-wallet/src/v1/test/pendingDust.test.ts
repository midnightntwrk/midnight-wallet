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
  type ProofErasedTransaction,
  Intent,
  nativeToken,
  Transaction,
  UnshieldedOffer,
} from '@midnight-ntwrk/ledger-v8';
import { InMemoryTransactionHistoryStorage, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Option, Stream, SubscriptionRef } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeSimulatorSyncCapability, makeSimulatorSyncService } from '../Sync.js';
import { DustTransactionHistoryEntrySchema, makeSimulatorTransactionHistoryService } from '../TransactionHistory.js';
import * as Transacting from '../Transacting.js';
import { V1Builder } from '../V1Builder.js';
import { dustParameters, dustSeed, fixtureSecretKey, keystoreOf, nightWithMeta } from './dustEvents.js';

const NETWORK = 'undeployed';

describe('V1 pending Dust', () => {
  it('should stop counting a coin as pending once the chain spends it, because the transaction that spent it has landed', () =>
    Effect.gen(function* () {
      const simulator = yield* V8.Simulator.init({ networkId: NETWORK });
      const secretKey = fixtureSecretKey();
      const keystore = keystoreOf(dustSeed());
      const verifyingKey = keystore.publicKey();

      const variant = new V1Builder()
        .withTransactionType<ProofErasedTransaction>()
        .withCoinSelectionDefaults()
        .withTransacting(Transacting.makeSimulatorTransactingCapability)
        .withSync(makeSimulatorSyncService, makeSimulatorSyncCapability)
        .withCoinsAndBalancesDefaults()
        .withKeysDefaults()
        .withStartAuxDefaults()
        .withSerializationDefaults()
        .withTransactionHistory(makeSimulatorTransactionHistoryService)
        .build({
          simulator,
          networkId: NETWORK,
          costParameters: { feeBlocksMargin: 5 },
          txHistoryStorage: new InMemoryTransactionHistoryStorage(DustTransactionHistoryEntrySchema),
          indexerClientConnection: { indexerHttpUrl: '' },
        });

      const initial = CoreWallet.initEmpty(dustParameters(), secretKey, NETWORK);
      const stateRef = yield* SubscriptionRef.make(initial);
      const running = yield* variant.start({
        stateRef,
        activationRange: ProtocolVersion.makeRange(
          ProtocolVersion.MinSupportedVersion,
          ProtocolVersion.MaxSupportedVersion,
        ),
      });
      yield* running.startSyncInBackground(secretKey);

      const syncedTo = (blockNumber: bigint) =>
        Stream.runLast(
          stateRef.changes.pipe(Stream.find((wallet) => wallet.progress.appliedIndex >= blockNumber + 1n)),
        );

      yield* simulator.rewardNight(verifyingKey, 150_000_000_000_000n);
      yield* syncedTo(1n);

      const registrationTime = DateOps.addSeconds((yield* simulator.getLatestState()).currentTime, 1);
      const unsigned = yield* running.createDustGenerationTransaction(
        registrationTime,
        DateOps.addSeconds(registrationTime, 1),
        nightWithMeta(yield* simulator.getLatestState(), keystore.address()),
        verifyingKey,
        new DustAddress(initial.publicKey.publicKey),
      );
      const registration = yield* running.addDustGenerationSignature(
        unsigned,
        keystore.sign(unsigned.intents!.get(1)!.signatureData(1)),
      );
      yield* simulator.submitTransaction(registration.eraseProofs());
      yield* syncedTo(2n);

      yield* simulator.fastForward(10n);

      const transferTime = (yield* simulator.getLatestState()).currentTime;
      const ttl = DateOps.addSeconds(transferTime, 1);
      const night = nightWithMeta(yield* simulator.getLatestState(), keystore.address())[0];
      const intent = Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = UnshieldedOffer.new(
        [{ ...night, owner: verifyingKey }],
        [{ type: nativeToken().raw, owner: keystore.address(), value: night.value }],
        [],
      );
      const transfer = Transaction.fromParts(NETWORK, undefined, undefined, intent);
      const { transaction: feePayment } = yield* running.balanceTransactions(secretKey, [transfer], ttl, transferTime);

      expect((yield* SubscriptionRef.get(stateRef)).pendingDust).toHaveLength(1);

      yield* simulator.submitTransaction(transfer.merge(feePayment).eraseProofs());
      const landed = yield* syncedTo(3n);

      expect(Option.getOrThrow(landed).pendingDust).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
