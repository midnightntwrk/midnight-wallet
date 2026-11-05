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
 * Whether the fee the wallet pays carries the full `feeBlocksMargin` of the transaction the node will see.
 *
 * @remarks
 *   The node prices a transaction with its proofs, and the ledger's `fees` and `feesWithMargin` are accurate only for
 *   proven transactions. Each test balances a transaction against real Dust in the in-memory simulator and compares the
 *   Dust the balancing intent spends with `feesWithMargin(params, feeBlocksMargin)` of the merged transaction in its
 *   proven form. `mockProve()` is the ledger's own stand-in for that form: proofs of the real size, accurate for fees.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { BigInt as BigIntOps, Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { chooseCoin, makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { TransactingCapabilityImplementation } from '../Transacting.js';
import { COST_PARAMETERS, NETWORK, NIGHT, walletWithOneGeneratingDustCoin } from './generatingDustWallet.js';

// Long enough after registration for the one Dust coin to cover any of these fees on its own.
const SECONDS_OF_GENERATION = 3000;

// The sizes of real proofs for the built-in circuits, as the ledger's own mock prover writes them.
const PROOF_SIZES: Readonly<Record<string, number>> = {
  'midnight/dust/spend': 2_912,
  'midnight/zswap/spend': 4_832,
  'midnight/zswap/output': 4_832,
};

/** A proving provider that writes proofs of the real size, so that proving yields an unbound transaction to price. */
const sizedProofProvider: ledger.ProvingProvider = {
  check: () => Promise.resolve([]),
  prove: (_preimage, keyLocation) => Promise.resolve(new Uint8Array(PROOF_SIZES[keyLocation] ?? 4_832)),
  lookupKey: () => Promise.resolve(undefined),
};

/** The Dust the balancing transaction's spends pay towards the fee. */
const dustPaid = (balancing: ledger.UnprovenTransaction): bigint =>
  BigIntOps.sumAll(
    [...(balancing.intents?.values() ?? [])].flatMap((intent) =>
      (intent.dustActions?.spends ?? []).map((spend) => spend.vFee),
    ),
  );

const setUp = Effect.gen(function* () {
  const { dustSecretKey, state, ledgerParameters, now, recipient } = yield* walletWithOneGeneratingDustCoin;
  const keysCapability = makeDefaultKeysCapability();
  const coinsCapability = makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability }));
  const transacting = new TransactingCapabilityImplementation<ledger.FinalizedTransaction>(
    NETWORK,
    COST_PARAMETERS,
    () => chooseCoin,
    () => coinsCapability,
    () => keysCapability,
  );
  const at = DateOps.addSeconds(now, SECONDS_OF_GENERATION);
  const ttl = DateOps.addSeconds(at, 3600);
  const transfer = (): ledger.UnprovenTransaction => {
    const intent = ledger.Intent.new(ttl);
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
      [],
      [{ type: NIGHT, owner: recipient, value: 1n }],
      [],
    );
    return ledger.Transaction.fromParts(NETWORK, undefined, undefined, intent);
  };
  const balance = (
    transaction: ledger.UnprovenTransaction | ledger.FinalizedTransaction | ledger.ProofErasedTransaction,
  ): ledger.UnprovenTransaction => {
    // Type cast required because: `balanceTransactions` declares finalized or unproven inputs, while the capability
    // also receives proof-erased and unbound transactions at run time, which is what these tests exercise.
    const inputs = [transaction] as ReadonlyArray<ledger.FinalizedTransaction | ledger.UnprovenTransaction>;
    const [balancing] = Either.getOrThrow(
      transacting.balanceTransactions(dustSecretKey, state, inputs, ttl, at, ledgerParameters),
    );
    return balancing;
  };
  const margin = (transaction: ledger.FinalizedTransaction | ledger.ProofErasedTransaction): bigint =>
    transaction.feesWithMargin(ledgerParameters, COST_PARAMETERS.feeBlocksMargin);
  const coins = coinsCapability.getAvailableCoinsWithGeneratedDust(state, at);
  const dryRunAlone = (): bigint => transacting.dryRunFee(coins, [], dustSecretKey, state, ttl, at, ledgerParameters);
  /** The intent `dryRunFee` prices when there is nothing else: the wallet's coins spent in segment 1. */
  const spendingIntentAlone = (): ledger.UnprovenTransaction => {
    const [spends] = CoreWallet.spendCoins(state, dustSecretKey, coins, at);
    const intent = ledger.Intent.new(ttl);
    intent.dustActions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>(
      'signature',
      'pre-proof',
      at,
      [...spends],
      [],
    );
    return ledger.Transaction.fromParts(NETWORK).addIntent({ tag: 'specific', value: 1 }, intent);
  };
  return { transacting, ledgerParameters, transfer, balance, margin, dryRunAlone, spendingIntentAlone };
});

describe('the fee margin the wallet pays', () => {
  it('should cover the margin of an unproven transaction once proven, because the node prices it with its proofs', () =>
    Effect.gen(function* () {
      const { transfer, balance, margin } = yield* setUp;
      const transaction = transfer();

      const balancing = balance(transaction);

      expect(dustPaid(balancing)).toBeGreaterThanOrEqual(margin(transaction.merge(balancing).mockProve()));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should cover the margin of a finalized transaction with its proven balancing intent, so a DApp transaction keeps the configured headroom', () =>
    Effect.gen(function* () {
      const { transfer, balance, margin } = yield* setUp;
      const finalized = transfer().mockProve();

      const balancing = balance(finalized);

      expect(dustPaid(balancing)).toBeGreaterThanOrEqual(margin(finalized.merge(balancing.mockProve())));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should cover the margin of an unbound transaction once bound, because binding comes before submission', () =>
    Effect.gen(function* () {
      const { transfer, balance, margin } = yield* setUp;
      const unbound = yield* Effect.promise(() =>
        transfer().prove(sizedProofProvider, ledger.CostModel.initialCostModel()),
      );

      // Type cast required because: `balance` takes the inputs `balanceTransactions` declares, and an unbound
      // transaction is not among them although the wallet receives it.
      const balancing = balance(unbound as unknown as ledger.FinalizedTransaction);

      expect(dustPaid(balancing)).toBeGreaterThanOrEqual(margin(unbound.bind().merge(balancing.mockProve())));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should price an unproven transaction alone at its proven margin, so a fee quoted before proving is not short', () =>
    Effect.gen(function* () {
      const { transacting, ledgerParameters, transfer, balance, margin } = yield* setUp;
      const balancing = balance(transfer());

      expect(transacting.calculateFee(balancing, ledgerParameters)).toBeGreaterThanOrEqual(
        margin(balancing.mockProve()),
      );
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should price a dust spend with nothing to balance at its proven margin, so a standalone dry run is not short', () =>
    Effect.gen(function* () {
      const { margin, dryRunAlone, spendingIntentAlone } = yield* setUp;

      expect(dryRunAlone()).toBeGreaterThanOrEqual(margin(spendingIntentAlone().mockProve()));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should still balance a proof-erased transaction at its erased margin, because it is submitted without proofs', () =>
    Effect.gen(function* () {
      const { transfer, balance, margin } = yield* setUp;
      const erased = transfer().eraseProofs();

      const balancing = balance(erased);

      expect(dustPaid(balancing)).toBeGreaterThanOrEqual(margin(erased.merge(balancing.eraseProofs())));
    }).pipe(Effect.scoped, Effect.runPromise));
});
