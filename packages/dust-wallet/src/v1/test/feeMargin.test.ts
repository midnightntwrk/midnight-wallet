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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { BigInt as BigIntOps, Effect, Either, Array as EArray, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { chooseCoin, makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { TransactingCapabilityImplementation } from '../Transacting.js';
import { COST_PARAMETERS, NETWORK, NIGHT, walletWithOneGeneratingDustCoin } from './generatingDustWallet.js';

// Long enough after registration for the one Dust coin to cover any of these fees on its own.
const SECONDS_OF_GENERATION = 3000;

// Enough balances of one transaction that a balancing intent priced in one size and returned in another shows up.
const REPEATED_BALANCES = 100;

// How many seconds of generation to search for a moment when spending the fee encodes longer than spending the whole
// coin; it happens about once in every 150 seconds.
const SECONDS_TO_SEARCH = 3000;

// The sizes of real proofs for the built-in circuits, as the ledger's own mock prover writes them.
const PROOF_SIZES: Readonly<Record<string, number>> = {
  'midnight/dust/spend': 2_912,
  'midnight/zswap/spend': 4_832,
  'midnight/zswap/output': 4_832,
};

/**
 * A proving provider that writes proofs of the real size, so that proving yields an unbound transaction to price. A
 * circuit with no known proof size is refused, so the priced transaction never carries a guessed proof.
 */
const sizedProofProvider: ledger.ProvingProvider = {
  check: () => Promise.resolve([]),
  prove: (_preimage, keyLocation) => {
    const size = PROOF_SIZES[keyLocation];
    return size === undefined
      ? Promise.reject(new Error(`No proof size is known for the circuit at ${keyLocation}`))
      : Promise.resolve(new Uint8Array(size));
  },
};

/** Every form a transaction reaches the wallet in to be balanced. */
type Balanceable =
  | ledger.UnprovenTransaction
  | ledger.FinalizedTransaction
  | ledger.ProofErasedTransaction
  | ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

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
  /** A transfer in `segment`; transactions balanced together sit in different segments, or they cannot merge. */
  const transfer = (segment: number = 1): ledger.UnprovenTransaction => {
    const intent = ledger.Intent.new(ttl);
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
      [],
      [{ type: NIGHT, owner: recipient, value: 1n }],
      [],
    );
    return ledger.Transaction.fromParts(NETWORK).addIntent({ tag: 'specific', value: segment }, intent);
  };
  const asInputs = (
    transactions: ReadonlyArray<Balanceable>,
  ): ReadonlyArray<ledger.FinalizedTransaction | ledger.UnprovenTransaction> =>
    // Type cast required because: the capability declares finalized or unproven inputs, while it also receives
    // proof-erased and unbound transactions at run time, which is what these tests exercise.
    transactions as ReadonlyArray<ledger.FinalizedTransaction | ledger.UnprovenTransaction>;
  const balance = (...transactions: ReadonlyArray<Balanceable>): ledger.UnprovenTransaction => {
    const [balancing] = Either.getOrThrow(
      transacting.balanceTransactions(dustSecretKey, state, asInputs(transactions), ttl, at, ledgerParameters),
    );
    return balancing;
  };
  const margin = (transaction: ledger.FinalizedTransaction | ledger.ProofErasedTransaction): bigint =>
    transaction.feesWithMargin(ledgerParameters, COST_PARAMETERS.feeBlocksMargin);
  /**
   * A fee priced on another binding than `proven`'s: each fresh intent, and each binding of a transaction, draws its
   * own, whose proven size can differ by a byte, so the fee lies within one block of the configured margin rather than
   * on it.
   */
  const expectWithinOneMarginBlock = (fee: bigint, proven: ledger.FinalizedTransaction): void => {
    expect(fee).toBeGreaterThan(proven.feesWithMargin(ledgerParameters, COST_PARAMETERS.feeBlocksMargin - 1));
    expect(fee).toBeLessThan(proven.feesWithMargin(ledgerParameters, COST_PARAMETERS.feeBlocksMargin + 1));
  };
  /**
   * The balancing intent covers the configured margin of `proven`, the merged transaction as the node prices it, and
   * stays below one block more of margin, so the margin is applied once; the fee the wallet quotes for the same inputs
   * prices its own intent, so it is held within one block of that margin.
   */
  const expectPaysProvenMargin = (
    inputs: ReadonlyArray<Balanceable>,
    balancing: ledger.UnprovenTransaction,
    proven: ledger.FinalizedTransaction,
  ): void => {
    const paid = dustPaid(balancing);
    const quoted = Either.getOrThrow(
      transacting.estimateFee(dustSecretKey, state, asInputs(inputs), ttl, at, ledgerParameters),
    );
    expect(paid).toBeGreaterThanOrEqual(margin(proven));
    expect(paid).toBeLessThan(proven.feesWithMargin(ledgerParameters, COST_PARAMETERS.feeBlocksMargin + 1));
    expectWithinOneMarginBlock(quoted, proven);
  };
  /**
   * The balancing intent and the quote for the same inputs both lie within one block of the configured margin of
   * `proven`, for inputs the wallet binds itself to price and that are bound again, with their own binding, before
   * submission.
   */
  const expectPaysWithinOneMarginBlock = (
    inputs: ReadonlyArray<Balanceable>,
    balancing: ledger.UnprovenTransaction,
    proven: ledger.FinalizedTransaction,
  ): void => {
    const quoted = Either.getOrThrow(
      transacting.estimateFee(dustSecretKey, state, asInputs(inputs), ttl, at, ledgerParameters),
    );
    expectWithinOneMarginBlock(dustPaid(balancing), proven);
    expectWithinOneMarginBlock(quoted, proven);
  };
  return {
    transacting,
    dustSecretKey,
    state,
    ledgerParameters,
    coinsCapability,
    at,
    ttl,
    transfer,
    balance,
    margin,
    expectPaysProvenMargin,
    expectPaysWithinOneMarginBlock,
    now,
    recipient,
  };
});

describe('the fee margin the wallet pays', () => {
  it('should cover the margin of an unproven transaction once proven, because the node prices it with its proofs', () =>
    Effect.gen(function* () {
      const { transfer, balance, expectPaysProvenMargin } = yield* setUp;
      const transaction = transfer();

      const balancing = balance(transaction);

      expectPaysProvenMargin([transaction], balancing, transaction.merge(balancing).mockProve());
    }).pipe(Effect.scoped, Effect.runPromise));

  it(
    'should price exactly the balancing transaction it returns, so the margin holds on every balance',
    () =>
      Effect.gen(function* () {
        const { transfer, balance, margin } = yield* setUp;
        const transaction = transfer();

        const shortfalls = EArray.makeBy(REPEATED_BALANCES, (iteration) => {
          const balancing = balance(transaction);
          return {
            iteration,
            shortfall: margin(transaction.merge(balancing).mockProve()) - dustPaid(balancing),
          };
        }).filter(({ shortfall }) => shortfall > 0n);

        expect(shortfalls).toEqual([]);
      }).pipe(Effect.scoped, Effect.runPromise),
    60_000,
  );

  it('should cover the margin of a finalized transaction with its proven balancing intent, so a DApp transaction keeps the configured headroom', () =>
    Effect.gen(function* () {
      const { transfer, balance, expectPaysProvenMargin } = yield* setUp;
      const finalized = transfer().mockProve();

      const balancing = balance(finalized);

      expectPaysProvenMargin([finalized], balancing, finalized.merge(balancing.mockProve()));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should pay within a block of the margin of an unbound transaction once bound, because its binding is drawn again before submission', () =>
    Effect.gen(function* () {
      const { transfer, balance, expectPaysWithinOneMarginBlock } = yield* setUp;
      const unbound = yield* Effect.tryPromise(() =>
        transfer().prove(sizedProofProvider, ledger.CostModel.initialCostModel()),
      );

      const balancing = balance(unbound);

      expectPaysWithinOneMarginBlock([unbound], balancing, unbound.bind().merge(balancing.mockProve()));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should cover the margin of a finalized and an unproven transaction balanced together, because the facade balances pairs', () =>
    Effect.gen(function* () {
      const { transfer, balance, margin } = yield* setUp;
      const finalized = transfer().mockProve();
      const unproven = transfer(2);

      const balancing = balance(finalized, unproven);

      expect(dustPaid(balancing)).toBeGreaterThanOrEqual(
        margin(finalized.merge(unproven.mockProve()).merge(balancing.mockProve())),
      );
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
      const { transacting, dustSecretKey, state, ledgerParameters, coinsCapability, at, ttl, margin } = yield* setUp;
      const coins = coinsCapability.getAvailableCoinsWithGeneratedDust(state, at);
      // The intent `dryRunFee` prices when there is nothing else: the wallet's coins spent in segment 1, copied from
      // the same template, so that both have the same proven size.
      const template = ledger.Intent.new(ttl).serialize();
      const [spends] = CoreWallet.spendCoins(state, dustSecretKey, coins, at);
      const intent = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>(
        'signature',
        'pre-proof',
        'pre-binding',
        template,
      );
      intent.dustActions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>(
        'signature',
        'pre-proof',
        at,
        [...spends],
        [],
      );
      const spendingIntentAlone = ledger.Transaction.fromParts(NETWORK).addIntent(
        { tag: 'specific', value: 1 },
        intent,
      );

      const dryRun = transacting.dryRunFee(
        coins,
        [],
        dustSecretKey,
        state,
        ttl,
        at,
        ledgerParameters,
        Option.none(),
        template,
      );

      const proven = spendingIntentAlone.mockProve();
      expect(dryRun).toBeGreaterThanOrEqual(margin(proven));
      expect(dryRun).toBeLessThan(proven.feesWithMargin(ledgerParameters, COST_PARAMETERS.feeBlocksMargin + 1));
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should still balance a proof-erased transaction at its erased margin, because it is submitted without proofs', () =>
    Effect.gen(function* () {
      const { transfer, balance, margin } = yield* setUp;
      const erased = transfer().eraseProofs();

      const balancing = balance(erased);

      expect(dustPaid(balancing)).toBeGreaterThanOrEqual(margin(erased.merge(balancing.eraseProofs())));
    }).pipe(Effect.scoped, Effect.runPromise));

  it(
    'should pay for the balancing intent as it returns it, so a spend of the fee that encodes longer than a spend of the whole coin is still covered',
    () =>
      Effect.gen(function* () {
        const { transacting, dustSecretKey, state, ledgerParameters, coinsCapability, now, recipient, margin } =
          yield* setUp;
        const transferAt = (at: Date): ledger.UnprovenTransaction => {
          const intent = ledger.Intent.new(DateOps.addSeconds(at, 3600));
          intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
            [],
            [{ type: NIGHT, owner: recipient, value: 1n }],
            [],
          );
          return ledger.Transaction.fromParts(NETWORK).addIntent({ tag: 'specific', value: 1 }, intent);
        };
        const balanceAt = (
          at: Date,
          transaction: ledger.FinalizedTransaction | ledger.ProofErasedTransaction,
        ): ledger.UnprovenTransaction => {
          // Type cast required because: the capability declares finalized or unproven inputs, while it also receives
          // proof-erased transactions at run time, which this test exercises.
          const inputs = [transaction] as ReadonlyArray<ledger.FinalizedTransaction>;
          const [balancing] = Either.getOrThrow(
            transacting.balanceTransactions(
              dustSecretKey,
              state,
              inputs,
              DateOps.addSeconds(at, 3600),
              at,
              ledgerParameters,
            ),
          );
          return balancing;
        };
        // The erased size of one intent spending `value` of the wallet's coin at `at`.
        const spendSize = (at: Date, value: bigint): number => {
          const [coin] = coinsCapability.getAvailableCoinsWithGeneratedDust(state, at);
          const [spends] = CoreWallet.spendCoins(state, dustSecretKey, [{ ...coin, value }], at);
          const intent = ledger.Intent.new(DateOps.addSeconds(at, 3600));
          intent.dustActions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>(
            'signature',
            'pre-proof',
            at,
            [...spends],
            [],
          );
          return intent.eraseProofs().serialize().length;
        };
        const start = DateOps.addSeconds(now, SECONDS_OF_GENERATION);
        const fee = dustPaid(balanceAt(start, transferAt(start).mockProve()));
        const coinValueAt = (at: Date): bigint =>
          coinsCapability.getAvailableCoinsWithGeneratedDust(state, at)[0].value;
        const longer = EArray.findFirst(EArray.range(0, SECONDS_TO_SEARCH), (second) => {
          const at = DateOps.addSeconds(start, second);
          return spendSize(at, fee) > spendSize(at, coinValueAt(at));
        });
        const at = DateOps.addSeconds(
          start,
          Option.getOrThrowWith(longer, () => new Error('no moment when spending the fee encodes longer was found')),
        );
        const finalized = transferAt(at).mockProve();
        const erased = transferAt(at).eraseProofs();

        const provenBalancing = balanceAt(at, finalized);
        const erasedBalancing = balanceAt(at, erased);

        expect(dustPaid(provenBalancing)).toBeGreaterThanOrEqual(margin(finalized.merge(provenBalancing.mockProve())));
        expect(dustPaid(erasedBalancing)).toBeGreaterThanOrEqual(margin(erased.merge(erasedBalancing.eraseProofs())));
      }).pipe(Effect.scoped, Effect.runPromise),
    60_000,
  );

  it('should balance a finalized transaction with a proof-erased one at the erased margin of the whole set, because one input without proofs has no proven form', () =>
    Effect.gen(function* () {
      const { transfer, balance, margin } = yield* setUp;
      const finalized = transfer().mockProve();
      const erased = transfer(2).eraseProofs();

      const balancing = balance(finalized, erased);

      expect(dustPaid(balancing)).toBeGreaterThanOrEqual(
        margin(finalized.eraseProofs().merge(erased).merge(balancing.eraseProofs())),
      );
    }).pipe(Effect.scoped, Effect.runPromise));
});
