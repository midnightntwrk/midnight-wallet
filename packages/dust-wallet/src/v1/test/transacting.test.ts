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
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { describe, expect, it, vi } from 'vitest';
import {
  chooseCoin,
  makeDefaultCoinsAndBalancesCapability,
  type UtxoWithFullDustDetails,
} from '../CoinsAndBalances.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
  TransactingCapabilityImplementation,
} from '../Transacting.js';
import { ProofMarker, SignatureMarker } from '../Utils.js';
import { InsufficientFundsError, TransactingError } from '../WalletError.js';
import { type CoinsAndBalancesCapability, type CoinSelection, type CoinWithValue } from '../CoinsAndBalances.js';
import { type Dust } from '../types/index.js';

const NIGHT = ledger.nativeToken().raw;

// Fixed timestamps keep the pure construction tests deterministic.
const NOW = new Date(1_700_000_000_000);
const TTL = new Date(2_000_000_000_000);

const config: DefaultTransactingConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  costParameters: { feeBlocksMargin: 5 },
};
const keysCapability = makeDefaultKeysCapability();
const context: DefaultTransactingContext = {
  coinSelection: chooseCoin,
  coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(undefined, () => ({ keysCapability })),
  keysCapability,
};
const transacting = makeDefaultTransactingCapability(config, () => context);

const makeUtxoWithDust = (
  outputNo: number,
  value: bigint,
  generatedNow: bigint,
  registeredForDustGeneration: boolean,
): UtxoWithFullDustDetails => ({
  utxo: {
    value,
    owner: ledger.sampleUserAddress(),
    type: NIGHT,
    intentHash: ledger.sampleIntentHash(),
    outputNo,
    ctime: new Date(0),
    registeredForDustGeneration,
  },
  dust: {
    dtime: undefined,
    maxCap: 1_000_000n,
    maxCapReachedAt: new Date(2_000_000_000_000),
    generatedNow,
    rate: 1n,
  },
});

const sampleVerifyingKey = (): ledger.SignatureVerifyingKey => ledger.signatureVerifyingKey(ledger.sampleSigningKey());

const sampleDustAddress = (): DustAddress => new DustAddress(ledger.sampleDustSecretKey().publicKey);

const sampleSignature = (): ledger.Signature => ledger.signData(ledger.sampleSigningKey(), new Uint8Array(32));

// Builds the kind of transaction `rotateUtxos` (unshielded wallet) produces: an intent at segment 1
// carrying a single guaranteed Night offer and NO dustActions yet.
const buildTxWithOffersOnly = (nightVerifyingKey: ledger.SignatureVerifyingKey): ledger.UnprovenTransaction => {
  const input: ledger.UtxoSpend = {
    value: 1_000n,
    type: NIGHT,
    intentHash: ledger.sampleIntentHash(),
    outputNo: 0,
    owner: nightVerifyingKey,
  };
  const output: ledger.UtxoOutput = {
    owner: ledger.addressFromKey(nightVerifyingKey),
    type: NIGHT,
    value: 1_000n,
  };
  const offer = ledger.UnshieldedOffer.new([input], [output], []);
  const intent = ledger.Intent.new(TTL);
  intent.guaranteedUnshieldedOffer = offer;
  return ledger.Transaction.fromParts(config.networkId, undefined, undefined, intent);
};

// Builds a transaction whose segment-1 intent carries `dustActions` with the supplied registrations
// (or an empty list). Used to exercise addDustRegistrationSignature's branches directly.
const buildTxWithRegistrations = (
  nightVerifyingKey: ledger.SignatureVerifyingKey,
  registrations: ReadonlyArray<ledger.DustRegistration<ledger.SignatureEnabled>>,
): ledger.UnprovenTransaction => {
  const tx = buildTxWithOffersOnly(nightVerifyingKey);
  const intent = tx.intents!.get(1)!;
  intent.dustActions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>(
    SignatureMarker.signature,
    ProofMarker.preProof,
    NOW,
    [],
    [...registrations],
  );
  return ledger.Transaction.fromParts(config.networkId, undefined, undefined, intent);
};

describe('splitNightUtxosForDustRegistration', () => {
  // The real splitNightUtxos sorts by `dust.generatedNow` descending and takes the first as
  // the guaranteed slot; the rest go to fallible. The tests below pick generatedNow values
  // explicitly so the guaranteed-vs-fallible split is predictable.

  it('registration: feePayment equals generatedNow of the guaranteed UTxO when it is unregistered', () => {
    const guaranteed = makeUtxoWithDust(0, 1_000n, 200n, false); // highest dust → guaranteed
    const fallible = makeUtxoWithDust(1, 1_000n, 100n, false);

    const result = transacting.splitNightUtxosForDustRegistration([guaranteed, fallible], true);

    expect(result.feePayment).toBe(200n);
    expect(result.guaranteedUtxos).toEqual([guaranteed]);
    expect(result.fallibleUtxos).toEqual([fallible]);
  });

  it('registration: feePayment is 0n when the guaranteed UTxO is already registered', () => {
    const guaranteed = makeUtxoWithDust(0, 1_000n, 200n, true); // already registered → excluded from fee
    const fallible = makeUtxoWithDust(1, 1_000n, 100n, false);

    const result = transacting.splitNightUtxosForDustRegistration([guaranteed, fallible], true);

    expect(result.feePayment).toBe(0n);
    expect(result.guaranteedUtxos).toEqual([guaranteed]);
  });

  it('deregistration: feePayment is 0n even when the guaranteed UTxO has generated dust', () => {
    const u1 = makeUtxoWithDust(0, 1_000n, 200n, false);
    const u2 = makeUtxoWithDust(1, 1_000n, 100n, false);

    const result = transacting.splitNightUtxosForDustRegistration([u1, u2], false);

    expect(result.feePayment).toBe(0n);
  });

  it('empty input yields empty guaranteed/fallible lists and 0n feePayment', () => {
    const result = transacting.splitNightUtxosForDustRegistration([], true);

    expect(result.guaranteedUtxos).toEqual([]);
    expect(result.fallibleUtxos).toEqual([]);
    expect(result.feePayment).toBe(0n);
  });
});

describe('attachDustRegistration', () => {
  it('registration: attaches a DustActions carrying the receiver and feePayment at segment 1', () => {
    const nightVerifyingKey = sampleVerifyingKey();
    const dustReceiverAddress = sampleDustAddress();
    const tx = buildTxWithOffersOnly(nightVerifyingKey);

    const result = transacting
      .attachDustRegistration(tx, NOW, nightVerifyingKey, dustReceiverAddress, 200n)
      .pipe(EitherOps.getOrThrowLeft);

    const intent = result.intents!.get(1)!;
    expect(intent.dustActions).toBeDefined();
    expect(intent.dustActions!.registrations.length).toBe(1);
    const registration = intent.dustActions!.registrations[0];
    expect(registration.allowFeePayment).toBe(200n);
    expect(registration.dustAddress).toBe(dustReceiverAddress.data);
    // The unshielded offers built by rotateUtxos must survive the attach untouched.
    expect(intent.guaranteedUnshieldedOffer).toBeDefined();
  });

  it('deregistration: attaches a DustActions with an undefined receiver and 0n feePayment', () => {
    const nightVerifyingKey = sampleVerifyingKey();
    const tx = buildTxWithOffersOnly(nightVerifyingKey);

    const result = transacting
      .attachDustRegistration(tx, NOW, nightVerifyingKey, undefined, 0n)
      .pipe(EitherOps.getOrThrowLeft);

    const registration = result.intents!.get(1)!.dustActions!.registrations[0];
    expect(registration.dustAddress).toBeUndefined();
    expect(registration.allowFeePayment).toBe(0n);
  });

  it('fails when there is no intent at segment 1', () => {
    const nightVerifyingKey = sampleVerifyingKey();
    const emptyTx = ledger.Transaction.fromParts(config.networkId, undefined, undefined, undefined);

    const error = transacting
      .attachDustRegistration(emptyTx, NOW, nightVerifyingKey, sampleDustAddress(), 200n)
      .pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(TransactingError);
    expect((error as TransactingError).message).toContain('segment 1');
  });

  it('fails when the intent already has a dust registration attached (idempotency guard)', () => {
    const nightVerifyingKey = sampleVerifyingKey();
    const registration = new ledger.DustRegistration<ledger.SignatureEnabled>(
      SignatureMarker.signature,
      nightVerifyingKey,
      sampleDustAddress().data,
      100n,
    );
    const txWithRegistration = buildTxWithRegistrations(nightVerifyingKey, [registration]);

    const error = transacting
      .attachDustRegistration(txWithRegistration, NOW, nightVerifyingKey, sampleDustAddress(), 200n)
      .pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(TransactingError);
    expect((error as TransactingError).message).toContain('already has a dust registration');
  });
});

describe('addDustRegistrationSignature', () => {
  it('attaches the signature to the sole registration at segment 1', () => {
    const nightVerifyingKey = sampleVerifyingKey();
    const registration = new ledger.DustRegistration<ledger.SignatureEnabled>(
      SignatureMarker.signature,
      nightVerifyingKey,
      sampleDustAddress().data,
      100n,
    );
    const tx = buildTxWithRegistrations(nightVerifyingKey, [registration]);

    const result = transacting.addDustRegistrationSignature(tx, sampleSignature()).pipe(EitherOps.getOrThrowLeft);

    const registrations = result.intents!.get(1)!.dustActions!.registrations;
    expect(registrations.length).toBe(1);
    expect(registrations[0].signature).toBeDefined();
  });

  it('fails when there is no intent at segment 1', () => {
    const emptyTx = ledger.Transaction.fromParts(config.networkId, undefined, undefined, undefined);

    const error = transacting.addDustRegistrationSignature(emptyTx, sampleSignature()).pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(TransactingError);
    expect((error as TransactingError).message).toContain('segment = 1');
  });

  it('fails when the segment-1 intent has no dustActions', () => {
    const tx = buildTxWithOffersOnly(sampleVerifyingKey());

    const error = transacting.addDustRegistrationSignature(tx, sampleSignature()).pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(TransactingError);
    expect((error as TransactingError).message).toContain('No dustActions');
  });

  it('fails when dustActions has no registrations', () => {
    const tx = buildTxWithRegistrations(sampleVerifyingKey(), []);

    const error = transacting.addDustRegistrationSignature(tx, sampleSignature()).pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(TransactingError);
    expect((error as TransactingError).message).toContain('No registrations');
  });
});

describe('computeBalancingRecipe', () => {
  // `dryRunFee` and `calculateFee` are the WASM-backed parts of balancing — they build and erase proofs on a real
  // ledger transaction. These tests exercise the selection loop itself, so both are replaced by an analytic fee model
  // whose one relevant property matches the real one: the fee grows with each dust input. Everything else —
  // `computeBalancingRecipe`, `balanceTransactions`, the SDK's `getBalanceRecipe` and `Imbalances` — runs unmodified.
  const FEE_BASE = 1_400_000_000_000_000n;
  const FEE_PER_INPUT = 3_750_000_000_000n;
  const linearFee = (inputs: number): bigint => FEE_BASE + FEE_PER_INPUT * BigInt(inputs);

  class TestableTransacting extends TransactingCapabilityImplementation<ledger.FinalizedTransaction> {
    readonly #feeModel: (inputs: number) => bigint;

    constructor(
      coins: ReadonlyArray<CoinWithValue<Dust>>,
      coinSelection: CoinSelection,
      feeModel: (inputs: number) => bigint = linearFee,
    ) {
      // Type cast required because: only `getAvailableCoinsWithGeneratedDust` is reached from `computeBalancingRecipe`.
      const coinsAndBalancesCapability = {
        getAvailableCoinsWithGeneratedDust: () => coins,
      } as unknown as CoinsAndBalancesCapability<never>;
      super(
        config.networkId,
        config.costParameters,
        () => coinSelection,
        () => coinsAndBalancesCapability,
        () => keysCapability,
      );
      this.#feeModel = feeModel;
    }
    override calculateFee(): bigint {
      return this.#feeModel(0);
    }
    override dryRunFee(recipeInputs: ReadonlyArray<CoinWithValue<Dust>>): bigint {
      return this.#feeModel(recipeInputs.length);
    }
  }

  const dustToken = (n: number): Dust => ({
    initialValue: 0n,
    owner: 0n,
    nonce: BigInt(n),
    seq: 0,
    ctime: NOW,
    backingNight: String(n).padStart(64, '0'),
    mtIndex: 0n,
  });
  const coin = (value: bigint, n: number): CoinWithValue<Dust> => ({ value, token: dustToken(n) });

  // A transaction that, at its own fee, carries `carriedDust` of dust already: its dust imbalance is the ledger's
  // netted figure, `carriedDust - fee`. Proof-erasure and merging are inert here; the fee model stands in for pricing.
  const fakeTx = (carriedDust: bigint = 0n): ledger.FinalizedTransaction =>
    // Type cast required because: the fee model replaces every ledger call `computeBalancingRecipe` would make on it.
    ({
      imbalances: () => new Map([[{ tag: 'dust' }, carriedDust - linearFee(0)]]),
      eraseProofs: () => ({ merge: (other: unknown) => other, intents: undefined }),
    }) as unknown as ledger.FinalizedTransaction;

  // Type cast required because: with `dryRunFee` and `spendCoins` never reached, the state is only passed through.
  const state = { untouched: true } as unknown as never;

  const run = (transacting: TestableTransacting, tx: ledger.FinalizedTransaction = fakeTx()) =>
    transacting.computeBalancingRecipe(
      ledger.sampleDustSecretKey(),
      state,
      [tx],
      TTL,
      NOW,
      ledger.LedgerParameters.initialParameters(),
    );

  const sumOf = (inputs: ReadonlyArray<CoinWithValue<Dust>>): bigint => inputs.reduce((sum, i) => sum + i.value, 0n);

  it('converges on a second pass when the first under-covers the fee its own inputs add', () => {
    // Twelve part-drained coins beside two near their generation cap. Ascending selection takes eight small ones on
    // the first pass — enough for the base fee, short of the fee that spending eight coins costs — and the second pass,
    // seeded with that shortfall and the marginal fee measured on the first, adds one more and covers it. Two prices.
    const drained = Array.from({ length: 12 }, (_, i) => coin(176_250_000_000_000n, i));
    const full = [coin(50_000_000_000_000_000n, 90), coin(30_000_000_000_000_000n, 91)];
    const transacting = new TestableTransacting([...drained, ...full], chooseCoin);
    const dryRuns = vi.spyOn(transacting, 'dryRunFee');

    const result = run(transacting).pipe(EitherOps.getOrThrowLeft);

    expect(result.recipeInputs).toHaveLength(9);
    expect(result.fee).toBe(linearFee(9));
    expect(sumOf(result.recipeInputs)).toBe(result.fee);
    expect(dryRuns).toHaveBeenCalledTimes(2);
  });

  it('keeps selection order, so the coins chosen first are drained first and no input pays nothing', () => {
    // Pool order is ledger-state order, here the large coin first. Ascending selection takes the small coin, then
    // the large one; the fee must be split in that order, or the small coin would be nullified and re-committed for
    // a zero fee while the large one is drained instead.
    const big = coin(2_000_000_000_000_000n, 0);
    const small = coin(1_000_000_000_000n, 1);

    const result = run(new TestableTransacting([big, small], chooseCoin)).pipe(EitherOps.getOrThrowLeft);

    expect(result.recipeInputs.map((i) => i.token.nonce)).toEqual([small.token.nonce, big.token.nonce]);
    expect(result.recipeInputs.map((i) => i.value)).toEqual([small.value, linearFee(2) - small.value]);
    expect(result.recipeInputs.every((i) => i.value > 0n)).toBe(true);
  });

  it('retries largest-first when ascending order exhausts the pool but the large coin alone could pay', () => {
    // The balancer takes coins until their raw value covers the seeded deficit, with no notion that each input raises
    // the real fee. Ascending order therefore takes both coins here; the fee for two inputs is still short of them,
    // the pool is empty, and the configured order is exhausted — while the large coin alone covers the fee for one.
    const small = coin(1_000_000_000_000n, 0);
    const large = coin(1_404_000_000_000_000n, 1); // > linearFee(1) = 1_403_750_000_000_000n
    const transacting = new TestableTransacting([small, large], chooseCoin);
    const dryRuns = vi.spyOn(transacting, 'dryRunFee');

    const result = run(transacting).pipe(EitherOps.getOrThrowLeft);

    expect(result.recipeInputs.map((i) => i.token.nonce)).toEqual([large.token.nonce]);
    expect(result.recipeInputs.map((i) => i.value)).toEqual([linearFee(1)]);
    expect(result.fee).toBe(linearFee(1));
    // One price under the configured order (two coins), one under the retry (one coin).
    expect(dryRuns).toHaveBeenCalledTimes(2);
  });

  it('honours a selector that declines coins: no retry spends what the policy excluded', () => {
    // A selector that never offers coins above a cap is a policy, not an order. When the coins it allows cannot pay,
    // the answer is insufficient funds — not a largest-first retry that spends the excluded coin.
    const cap = 10_000_000_000_000n;
    const capped: CoinSelection = (coins) => chooseCoin(coins.filter((c) => c.value <= cap));
    const allowed = coin(1_000_000_000_000n, 0);
    const excluded = coin(5_000_000_000_000_000n, 1);
    const transacting = new TestableTransacting([allowed, excluded], capped);
    const dryRuns = vi.spyOn(transacting, 'dryRunFee');

    const error = run(transacting).pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(InsufficientFundsError);
    expect((error as InsufficientFundsError).message).toMatch(/declined/);
    expect(dryRuns).not.toHaveBeenCalled();
  });

  it('fails fast when the selector returns a coin that was not offered, instead of repeating identical passes', () => {
    // The balancer books whatever coin the selector returns, so a selector ignoring its argument satisfies the deficit
    // with a coin the pool never had. Nothing can be consumed from the pool, so nothing can change between passes.
    const foreign = coin(9_000_000_000_000_000n, 999);
    const ignoresItsArgument: CoinSelection = <T extends { value: bigint }>(_coins: readonly T[]): T | undefined =>
      // Type cast required because: the point of the test is a selector that returns a coin of the right shape
      // that is not one of `_coins`.
      ({ type: 'dust', value: foreign.value, token: foreign.token }) as unknown as T;
    const transacting = new TestableTransacting([coin(1_000_000_000_000n, 0)], ignoresItsArgument);
    const dryRuns = vi.spyOn(transacting, 'dryRunFee');

    const error = run(transacting).pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(TransactingError);
    expect((error as TransactingError).message).toMatch(/none of them among the 1 offered/);
    expect(dryRuns).not.toHaveBeenCalled();
  });

  it('nets off dust the transactions already carry, so new inputs pay only the shortfall', () => {
    // The transaction already carries 60% of its base fee in dust. The new input must pay the remaining 40% plus what
    // its own presence adds — not the whole fee on top — while the reported fee is the total the merged result pays.
    const carried = (linearFee(0) * 6n) / 10n;
    const only = coin(linearFee(0), 0);

    const result = run(new TestableTransacting([only], chooseCoin), fakeTx(carried)).pipe(EitherOps.getOrThrowLeft);

    expect(result.fee).toBe(linearFee(1));
    expect(result.recipeInputs.map((i) => i.value)).toEqual([linearFee(1) - carried]);
  });

  it('selects nothing when the transactions already cover their fee, and then adds no intent at all', () => {
    // An intent with empty `DustActions` is not well-formed, so a fully-covered transaction must get an empty balancing
    // transaction — the identity under merge — not an intent with nothing in it. The fee reported is the fee as it is,
    // not the price of a merged result carrying an extra empty intent.
    const covered = fakeTx(linearFee(0) + 5n);
    const transacting = new TestableTransacting([coin(1_000_000_000_000_000_000n, 0)], chooseCoin);
    const dryRuns = vi.spyOn(transacting, 'dryRunFee');

    const recipe = run(transacting, covered).pipe(EitherOps.getOrThrowLeft);
    expect(recipe.recipeInputs).toEqual([]);
    expect(recipe.fee).toBe(linearFee(0));
    expect(dryRuns).not.toHaveBeenCalled();

    const [balancing, nextState] = transacting
      .balanceTransactions(
        ledger.sampleDustSecretKey(),
        state,
        [covered],
        TTL,
        NOW,
        ledger.LedgerParameters.initialParameters(),
      )
      .pipe(EitherOps.getOrThrowLeft);
    expect(balancing.intents?.size ?? 0).toBe(0);
    expect(nextState).toBe(state);
  });

  it('reports InsufficientFundsError when no order of the pool can pay', () => {
    const error = run(new TestableTransacting([coin(1n, 0), coin(2n, 1)], chooseCoin)).pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(InsufficientFundsError);
    expect((error as InsufficientFundsError).tokenType).toBe('dust');
  });

  it('terminates on a fee model that can never be covered, pricing at most once per coin per attempt', () => {
    // Each input costs exactly its own value, so no set of inputs can ever cover the fee it produces. Every pass still
    // consumes at least one coin, so both the configured attempt and the retry run out of pool and stop.
    const value = 100_000_000_000_000n;
    const coins = Array.from({ length: 5 }, (_, i) => coin(value, i));
    const transacting = new TestableTransacting(coins, chooseCoin, (inputs) => FEE_BASE + value * BigInt(inputs));
    const dryRuns = vi.spyOn(transacting, 'dryRunFee');

    const error = run(transacting).pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(InsufficientFundsError);
    expect(dryRuns.mock.calls.length).toBeLessThanOrEqual(2 * coins.length);
  });
});
