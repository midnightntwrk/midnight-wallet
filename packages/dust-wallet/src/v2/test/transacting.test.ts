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
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { describe, expect, it } from 'vitest';
import {
  chooseCoin,
  makeDefaultCoinsAndBalancesCapability,
  type UtxoWithFullDustDetails,
} from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
} from '../Transacting.js';
import { type Dust } from '../types/Dust.js';
import { ProofMarker, SignatureMarker } from '../Utils.js';
import { TransactingError } from '../WalletError.js';

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

// A dust wallet's own state is what decides whether a Night UTxO still generates dust: every dust coin the wallet
// holds names the Night that backs it (`backingNight`), and a Night UTxO's own initial nonce is derivable from its
// intent hash and output number. The fixtures below build states holding, or not holding, such a coin — which is the
// only thing the ledger's `generationless_fee_availability` rule looks at.
const dustSecretKey = ledger.DustSecretKey.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256));
const dustParameters = ledger.LedgerParameters.initialParameters().dust;

const emptyDustWallet = (): CoreWallet =>
  CoreWallet.initEmpty(dustParameters, dustSecretKey, NetworkId.NetworkId.Undeployed);

/** The dust coin the ledger mints when `utxo` is registered: one whose `backingNight` is that UTxO's initial nonce. */
const dustCoinBacking = (utxo: UtxoWithFullDustDetails, nonce: bigint): Dust => ({
  initialValue: 1_000n,
  owner: dustSecretKey.publicKey,
  nonce,
  seq: 0,
  ctime: new Date(0),
  backingNight: ledger.dustInitialNonce(BigInt(utxo.utxo.outputNo), utxo.utxo.intentHash),
  mtIndex: 0n,
});

/** A wallet whose confirmed dust holdings are exactly `coins`. */
const walletHolding = (coins: readonly Dust[]): CoreWallet => {
  const base = emptyDustWallet();
  return {
    ...base,
    state: coins.reduce((state, coin) => state.addUtxo(ledger.dustNullifier(coin, dustSecretKey), coin), base.state),
  };
};

/** A wallet whose dust holdings are exactly `coins`, all of them booked against a transaction in flight. */
const walletPending = (coins: readonly Dust[]): CoreWallet => ({
  ...emptyDustWallet(),
  pendingDust: coins.map((coin) => ({ ...coin, nullifier: ledger.dustNullifier(coin, dustSecretKey) })),
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
  //
  // What a UTxO may contribute to `feePayment` is the ledger's `generationless_fee_availability`: only Night whose
  // initial nonce the chain does NOT hold a generation for earns the retroactive dust a registration can spend on
  // its own fee. The wallet reads that off its own dust holdings, not off the indexer's `registeredForDustGeneration`
  // flag — which is a creation-time reading and, after a hard fork wipes dust state, a stale one.

  it('registration: feePayment equals generatedNow of the guaranteed UTxO when no dust coin backs it', () => {
    const guaranteed = makeUtxoWithDust(0, 1_000n, 200n, false); // highest dust → guaranteed
    const fallible = makeUtxoWithDust(1, 1_000n, 100n, false);

    const result = transacting.splitNightUtxosForDustRegistration(emptyDustWallet(), [guaranteed, fallible], true);

    expect(result.feePayment).toBe(200n);
    expect(result.guaranteedUtxos).toEqual([guaranteed]);
    expect(result.fallibleUtxos).toEqual([fallible]);
    expect(result.hasGenerationlessGuaranteed).toBe(true);
  });

  it('registration: a UTxO the indexer still flags as registered funds the fee when no dust coin backs it', () => {
    // The post-fork case. The fork wipes dust state and the chain-side replay restores cNIGHT-backed generation
    // only, so a native-NIGHT holder arrives with no dust at all — while every carried UTxO still reports the flag
    // it was created with. The registration that repairs this must pay its own fee out of retroactive dust.
    const guaranteed = makeUtxoWithDust(0, 1_000n, 200n, true);
    const fallible = makeUtxoWithDust(1, 1_000n, 100n, true);

    const result = transacting.splitNightUtxosForDustRegistration(emptyDustWallet(), [guaranteed, fallible], true);

    expect(result.feePayment).toBe(200n);
    expect(result.hasGenerationlessGuaranteed).toBe(true);
  });

  it('registration: feePayment is 0n when a dust coin in state backs the guaranteed UTxO', () => {
    // The re-registration case, decided by the wallet's own holdings rather than by the flag: this UTxO's flag says
    // unregistered, and the dust coin backing it says otherwise. The chain would reject a fee payment claimed for it.
    const guaranteed = makeUtxoWithDust(0, 1_000n, 200n, false);
    const fallible = makeUtxoWithDust(1, 1_000n, 100n, false);
    const state = walletHolding([dustCoinBacking(guaranteed, 1n)]);

    const result = transacting.splitNightUtxosForDustRegistration(state, [guaranteed, fallible], true);

    expect(result.feePayment).toBe(0n);
    expect(result.guaranteedUtxos).toEqual([guaranteed]);
    expect(result.hasGenerationlessGuaranteed).toBe(false);
  });

  it('registration: a dust coin booked against a transaction in flight backs its Night just as a confirmed one does', () => {
    const guaranteed = makeUtxoWithDust(0, 1_000n, 200n, true);
    const state = walletPending([dustCoinBacking(guaranteed, 2n)]);

    const result = transacting.splitNightUtxosForDustRegistration(state, [guaranteed], true);

    expect(result.feePayment).toBe(0n);
    expect(result.hasGenerationlessGuaranteed).toBe(false);
  });

  it('deregistration: feePayment is 0n even when the guaranteed UTxO has generated dust', () => {
    const u1 = makeUtxoWithDust(0, 1_000n, 200n, false);
    const u2 = makeUtxoWithDust(1, 1_000n, 100n, false);

    const result = transacting.splitNightUtxosForDustRegistration(emptyDustWallet(), [u1, u2], false);

    expect(result.feePayment).toBe(0n);
  });

  it('empty input yields empty guaranteed/fallible lists and 0n feePayment', () => {
    const result = transacting.splitNightUtxosForDustRegistration(emptyDustWallet(), [], true);

    expect(result.guaranteedUtxos).toEqual([]);
    expect(result.fallibleUtxos).toEqual([]);
    expect(result.feePayment).toBe(0n);
    expect(result.hasGenerationlessGuaranteed).toBe(false);
  });
});

describe('isGenerationless', () => {
  const coinsAndBalances = context.coinsAndBalancesCapability;

  it('calls a Night UTxO generationless when no dust coin in the wallet names it as its backing Night', () => {
    const utxo = makeUtxoWithDust(3, 1_000n, 0n, true);

    expect(coinsAndBalances.isGenerationless(emptyDustWallet(), utxo.utxo)).toBe(true);
  });

  it('does not, once the wallet holds a dust coin whose backingNight is that UTxO initial nonce', () => {
    const utxo = makeUtxoWithDust(3, 1_000n, 0n, false);
    const state = walletHolding([dustCoinBacking(utxo, 5n)]);

    expect(coinsAndBalances.isGenerationless(state, utxo.utxo)).toBe(false);
  });

  it('reads the backing per UTxO, not per wallet: another UTxO dust coin says nothing about this one', () => {
    const registered = makeUtxoWithDust(3, 1_000n, 0n, false);
    const other = makeUtxoWithDust(4, 1_000n, 0n, false);
    const state = walletHolding([dustCoinBacking(registered, 5n)]);

    expect(coinsAndBalances.isGenerationless(state, registered.utxo)).toBe(false);
    expect(coinsAndBalances.isGenerationless(state, other.utxo)).toBe(true);
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
