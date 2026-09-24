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

/**
 * Whether paying a fee with Dust settles when the Dust selected first stops covering the fee once it is spent.
 *
 * @remarks
 *   Balancing is a fixed point: select coins for the fee, dry-run the fee the selection itself adds, and select again
 *   until what was selected covers what it costs. The case that exposes the loop is a coin worth more than the
 *   transaction's own fee but less than that fee plus the cost of spending the coin: the first round selects it, the
 *   second must see it is not enough. With a single such coin the only right answer is `InsufficientFundsError`.
 *
 *   The wallet state is real — Night rewarded, registered and generating Dust in the in-memory simulator — because the
 *   dry run spends the selected coins against the wallet's own Dust state. The capability is built by hand around the
 *   real coins and keys capabilities so that its coin selection can be guarded: a balancing loop that never settles is
 *   synchronous and blocks the event loop, so no test timeout could stop it. The guard turns that into a failure after
 *   a bounded number of rounds; a loop that settles never gets near it.
 *
 *   Marked `it.fails` because the defect is still present: the second round hands the balancer the fee as a positive
 *   imbalance, which it reads as a surplus, so nothing is selected and the guard stops the loop. The assertion fails
 *   for exactly that reason today. Change it back to `it` in the same change that fixes the balancing.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { InMemoryTransactionHistoryStorage, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { makeSimulatorProvingServiceEffect } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import { Simulator } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import * as Submission from '@midnightntwrk/wallet-sdk-capabilities/submission';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either, Scope, Stream, SubscriptionRef } from 'effect';
import { describe, expect, it } from 'vitest';
import { createUnshieldedKeystore } from '../../../test/UnshieldedKeyStore.js';
import { getDustSeed } from '../../../test/utils.js';
import { chooseCoin, type CoinSelection, makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { makeSimulatorSyncCapability, makeSimulatorSyncService } from '../Sync.js';
import { DustTransactionHistoryEntrySchema, makeSimulatorTransactionHistoryService } from '../TransactionHistory.js';
import { makeSimulatorTransactingCapability, TransactingCapabilityImplementation } from '../Transacting.js';
import type { UtxoWithMeta } from '../types/index.js';
import { V2Builder } from '../V2Builder.js';

const NETWORK = 'undeployed';
const NIGHT = ledger.nativeToken().raw;
const COST_PARAMETERS = { feeBlocksMargin: 5 };

// Small enough that Dust accrues a few trillion per second, so a whole-second step can land inside the window between
// a transaction's fee and that fee plus one Dust spend; a larger holding jumps straight over it.
const NIGHT_AWARD = 1_000_000_000n;
// Long enough for the Night to pay for its own registration, short enough that what is left starts below that window.
const SECONDS_BEFORE_REGISTERING = 100n;
// Far more rounds than a settling balance needs; only a loop that never settles reaches it.
const MAX_BALANCING_ROUNDS = 100;

/**
 * A coin selection that is the default one, until it has been asked for more often than a settling balance ever would.
 *
 * @remarks
 *   The capability asks for its coin selection once per balancing round, so the count is the number of rounds.
 */
const guardedCoinSelection = (): (() => CoinSelection) => {
  const rounds = { count: 0 };
  return () => {
    rounds.count += 1;
    if (rounds.count > MAX_BALANCING_ROUNDS) {
      throw new Error(`Dust balancing did not settle within ${MAX_BALANCING_ROUNDS} rounds`);
    }
    return chooseCoin;
  };
};

/** A wallet holding exactly one Dust coin, generating from a small Night holding in the in-memory simulator. */
const walletWithOneGeneratingDustCoin = Effect.gen(function* () {
  const keyStore = createUnshieldedKeystore({ kind: 'schnorr', secret: getDustSeed('00'.repeat(31) + '01') });
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keyStore.getSecretKey());
  const scope = yield* Scope.Scope;
  const simulator = yield* Simulator.init({ networkId: NETWORK });

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
  const submission = Submission.makeSimulatorSubmissionService<ledger.ProofErasedTransaction>('InBlock')({ simulator });
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
  yield* submission.submitTransaction(yield* makeSimulatorProvingServiceEffect().prove(signed), 'InBlock');
  yield* waitForBlock(2n);

  const registered = yield* simulator.getLatestState();
  return {
    dustSecretKey,
    state: yield* SubscriptionRef.get(stateRef),
    ledgerParameters: registered.ledger.parameters,
    now: DateOps.addSeconds(registered.currentTime, 1),
    recipient: createUnshieldedKeystore({ kind: 'schnorr', secret: getDustSeed('00'.repeat(31) + '02') }).getAddress(),
  };
});

describe('paying a fee with Dust', () => {
  it.fails('refuses, rather than spinning, when the coin that covers the fee cannot also cover its own spend', () =>
    Effect.gen(function* () {
      const { dustSecretKey, state, ledgerParameters, now, recipient } = yield* walletWithOneGeneratingDustCoin;

      const keysCapability = makeDefaultKeysCapability();
      const coinsCapability = makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability }));
      const transacting = new TransactingCapabilityImplementation<ledger.ProofErasedTransaction>(
        NETWORK,
        COST_PARAMETERS,
        guardedCoinSelection(),
        () => coinsCapability,
        () => keysCapability,
      );

      const ttl = DateOps.addSeconds(now, 3600);
      const intent = ledger.Intent.new(ttl);
      intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
        [],
        [{ type: NIGHT, owner: recipient, value: 1n }],
        [],
      );
      const transaction = ledger.Transaction.fromParts(NETWORK, undefined, undefined, intent);

      const coinAt = (at: Date) => coinsCapability.getAvailableCoinsWithGeneratedDust(state, at);
      const transactionFee = transacting.calculateFee(transaction, ledgerParameters);
      const feeWithOneSpend = (at: Date) =>
        transacting.dryRunFee(coinAt(at), [transaction], dustSecretKey, state, ttl, at, ledgerParameters);

      // The first whole second at which the coin is worth the midpoint between the transaction's fee and that fee plus
      // spending the coin — inside the window, with room either side for the fee's size jitter.
      const target = (transactionFee + feeWithOneSpend(now)) / 2n;
      const balancedAt = Array.from({ length: 3600 }, (_, second) => DateOps.addSeconds(now, second)).find(
        (at) => (coinAt(at)[0]?.value ?? 0n) >= target,
      )!;

      // Preconditions: one coin, inside the window. Below it the first round already fails correctly and this test
      // would pass without exercising anything; above it the first round settles.
      const coins = coinAt(balancedAt);
      expect(coins).toHaveLength(1);
      expect(coins[0].value).toBeGreaterThan(transactionFee);
      expect(coins[0].value).toBeLessThan(feeWithOneSpend(balancedAt));

      const balanced = transacting.balanceTransactions(
        dustSecretKey,
        state,
        [transaction],
        ttl,
        balancedAt,
        ledgerParameters,
      );

      const outcome = Either.match(balanced, {
        onLeft: (error) => ({ tag: error._tag, message: error.message }),
        onRight: () => ({ tag: 'balanced', message: '' }),
      });
      expect(outcome.tag, outcome.message).toBe('Wallet.InsufficientFunds');
    }).pipe(Effect.scoped, Effect.runPromise),
  );
});
