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
import * as ledger from '@midnight-ntwrk/ledger-v9';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
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
} from '../Transacting.js';
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
