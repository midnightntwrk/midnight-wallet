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
import { describe, expect, it } from 'vitest';
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
  // `dryRunFee` and `calculateFee` are the WASM-backed parts of balancing — they build and
  // erase proofs on a real ledger transaction. These tests exercise the balancing loop itself
  // (progress, termination, the fallback selector), so they replace both with a fee model
  // whose one relevant property matches the real one: the fee grows with the number of dust
  // inputs. `computeBalancingRecipe` itself, and every SDK function it calls
  // (`getBalanceRecipe`, `Imbalances`), are exercised unmodified.
  const FEE_BASE = 1_400_000_000_000_000n;
  const FEE_PER_INPUT = 3_750_000_000_000n;
  const feeFor = (inputs: number): bigint => FEE_BASE + FEE_PER_INPUT * BigInt(inputs);

  class TestableTransacting extends TransactingCapabilityImplementation<ledger.FinalizedTransaction> {
    override calculateFee(): bigint {
      return feeFor(0);
    }
    override dryRunFee(recipeInputs: ReadonlyArray<CoinWithValue<Dust>>): bigint {
      return feeFor(recipeInputs.length);
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

  // A transaction whose dust imbalance at its own fee is the ledger's usual sign: negative,
  // i.e. a deficit of `feeFor(0)`.
  const fakeTx = {
    imbalances: () => new Map([[{ tag: 'dust' }, -feeFor(0)]]),
  } as unknown as ledger.FinalizedTransaction;

  const makeTransacting = (
    coins: ReadonlyArray<CoinWithValue<Dust>>,
    coinSelection: CoinSelection,
  ): TestableTransacting => {
    const coinsAndBalancesCapability = {
      getAvailableCoinsWithGeneratedDust: () => coins,
    } as unknown as CoinsAndBalancesCapability<never>;
    return new TestableTransacting(
      config.networkId,
      config.costParameters,
      () => coinSelection,
      () => coinsAndBalancesCapability,
      () => keysCapability,
    );
  };

  const run = (transacting: TestableTransacting) =>
    transacting.computeBalancingRecipe(
      ledger.sampleDustSecretKey(),
      undefined as never,
      [fakeTx],
      TTL,
      NOW,
      ledger.LedgerParameters.initialParameters(),
    );

  it('converges once the deficit-seeded pass covers the fee, even when the first pass falls short', () => {
    // Twelve part-drained coins beside two near their generation cap — ascending selection
    // takes eight of the small ones on pass 1, which is short of the fee that spending eight
    // coins costs; a second pass, seeded with the remaining deficit, adds one more and covers it.
    const drained = Array.from({ length: 12 }, (_, i) => coin(176_250_000_000_000n, i));
    const full = [coin(50_000_000_000_000_000n, 90), coin(30_000_000_000_000_000n, 91)];
    const result = run(makeTransacting([...drained, ...full], chooseCoin)).pipe(EitherOps.getOrThrowLeft);

    expect(result.recipeInputs).toHaveLength(9);
    expect(result.fee).toBe(feeFor(9));
    expect(result.recipeInputs.reduce((sum, i) => sum + i.value, 0n)).toBe(result.fee);
  });

  it('falls back to largest-first when ascending order strands the coin that could pay alone', () => {
    // Adding a coin can only raise the fee, so the additive loop is complete only when it
    // selects from the top. `getBalanceRecipe` itself has no notion of that growth — its
    // `inputFeeOverhead` is 0n here, same as the SDK's own call site — so a single call keeps
    // taking coins, smallest first, until their raw sum covers the *seeded* deficit, with no
    // regard for what selecting them will do to the *real* fee once `dryRunFee` re-prices the
    // result. Here that means ascending order's one call to `getBalanceRecipe` takes both
    // coins (their sum clears the seeded fee(0) deficit) — but the real fee for two inputs,
    // fee(2), is still short of what was collected, and the pool is now empty: insufficient
    // funds, on a wallet where the large coin alone would have covered fee(1).
    const small = coin(1_000_000_000_000n, 0);
    const large = coin(1_404_000_000_000_000n, 1); // > fee(1) = 1_403_750_000_000_000n
    const result = run(makeTransacting([small, large], chooseCoin)).pipe(EitherOps.getOrThrowLeft);

    // Exactly the large coin was chosen, not the small one — `distributeFeeAcrossInputs`
    // reports how much of it pays the fee, which is the whole fee since one input suffices.
    expect(result.recipeInputs.map((i) => i.token.nonce)).toEqual([large.token.nonce]);
    expect(result.recipeInputs.map((i) => i.value)).toEqual([feeFor(1)]);
    expect(result.fee).toBe(feeFor(1));
  });

  it('reports InsufficientFundsError, not a hang, when no order of the pool can pay', () => {
    const coins = [coin(1n, 0), coin(2n, 1)];
    const error = run(makeTransacting(coins, chooseCoin)).pipe(EitherOps.getOrThrowRight);

    expect(error).toBeInstanceOf(InsufficientFundsError);
    expect((error as InsufficientFundsError).tokenType).toBe('dust');
  });

  it('never terminates worse than the coin count: converges on a uniformly tiny wallet too', () => {
    // The one shape neither selection order can rescue by picking a different coin: every
    // coin is far below fee size, so covering the fee needs several of them regardless of
    // order. The loop must still terminate — in at most `coins.length + 1` passes.
    const coins = Array.from({ length: 12 }, (_, i) => coin(176_250_000_000_000n, i));
    const result = run(makeTransacting(coins, chooseCoin)).pipe(EitherOps.getOrThrowLeft);

    expect(result.recipeInputs.length).toBeLessThanOrEqual(coins.length);
    expect(result.recipeInputs.reduce((sum, i) => sum + i.value, 0n)).toBeGreaterThanOrEqual(result.fee);
  });

  it('selects nothing and reports the real fee when the transaction already carries enough dust', () => {
    const positiveImbalanceTx = {
      imbalances: () => new Map([[{ tag: 'dust' }, 5n]]),
    } as unknown as ledger.FinalizedTransaction;
    const transacting = makeTransacting([coin(1_000_000n, 0)], chooseCoin);

    const result = transacting
      .computeBalancingRecipe(
        ledger.sampleDustSecretKey(),
        undefined as never,
        [positiveImbalanceTx],
        TTL,
        NOW,
        ledger.LedgerParameters.initialParameters(),
      )
      .pipe(EitherOps.getOrThrowLeft);

    expect(result.recipeInputs).toEqual([]);
    expect(result.fee).toBe(feeFor(0));
  });
});
