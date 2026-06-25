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
//
// Phase 2 — unshielded wallet instantiation + ECDSA-authorized spends
// (#402: ECDSA-W-01/02, ECDSA-SPEND-01/02/03/04).
//
// Deterministic, no network: exercises the transacting capability + CoreWallet
// directly. The full UnshieldedWallet/facade build is covered by the Docker
// E2E suite (Phase 5). Spend signatures are checked with the independent
// @noble/curves oracle AND the ledger, so nothing is self-attested.
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { chooseCoin } from '@midnightntwrk/wallet-sdk-capabilities';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey, type UnshieldedKeystore } from '../src/KeyStore.js';
import { makeDefaultCoinsAndBalancesCapability } from '../src/v1/CoinsAndBalances.js';
import { CoreWallet } from '../src/v1/CoreWallet.js';
import { makeDefaultKeysCapability } from '../src/v1/Keys.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
} from '../src/v1/Transacting.js';
import { TransactionOps } from '../src/v1/TransactionOps.js';
import { makeDefaultV1SerializationCapability } from '../src/v1/Serialization.js';
import { UnshieldedState, UtxoWithMeta } from '../src/v1/UnshieldedState.js';
import { verifyWithOracle } from './ecdsaOracle.js';

const NIGHT = ledger.nativeToken().raw;
const networkId = NetworkId.NetworkId.Undeployed;
const ttl = DateOps.addSeconds(new Date(), 1800);
const recipient = new UnshieldedAddress(Buffer.alloc(32, 5));

const config: DefaultTransactingConfiguration = { networkId };
const context: DefaultTransactingContext = {
  coinSelection: chooseCoin,
  coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(),
  keysCapability: makeDefaultKeysCapability(),
};
const transacting = makeDefaultTransactingCapability(config, () => context);

// Both schemes from the same scalar: distinct keys/addresses, both ledger-valid.
const secret = Buffer.alloc(32, 9);
const keystores: Record<'ecdsa' | 'schnorr', UnshieldedKeystore> = {
  ecdsa: createKeystore({ kind: 'ecdsa', secret }, networkId),
  schnorr: createKeystore({ kind: 'schnorr', secret }, networkId),
};

const walletWithNight = (keystore: UnshieldedKeystore): CoreWallet => {
  const ownerPK = PublicKey.fromKeyStore(keystore);
  const utxos = [
    new UtxoWithMeta({
      utxo: {
        value: 1_000n,
        owner: ownerPK.addressHex,
        type: NIGHT,
        intentHash: ledger.sampleIntentHash(),
        outputNo: 0,
      },
      meta: { ctime: new Date(0), registeredForDustGeneration: false },
    }),
  ];
  return CoreWallet.restore(
    UnshieldedState.restore(utxos, []),
    ownerPK,
    { appliedId: 0n, highestTransactionId: 0n },
    ProtocolVersion.ProtocolVersion(1n),
    networkId,
  );
};

const buildTransfer = (keystore: UnshieldedKeystore): ledger.UnprovenTransaction =>
  transacting
    .makeTransfer(walletWithNight(keystore), [{ amount: 100n, type: NIGHT, receiverAddress: recipient }], ttl)
    .pipe(Either.getOrThrow).transaction;

describe('Phase 2 — instantiation reports scheme and address (ECDSA-W-01/02)', () => {
  it('ECDSA-W-01 a wallet built from an ECDSA key reports the ecdsa scheme and an ecdsa address', () => {
    const wallet = walletWithNight(keystores.ecdsa);

    expect(wallet.publicKey.publicKey.tag).toBe('ecdsa');
    expect(wallet.publicKey.publicKey.value).toHaveLength(66); // 33-byte SEC1 compressed
    expect(wallet.publicKey.addressHex).toBe(ledger.addressFromKey(keystores.ecdsa.getPublicKey()));
    expect(wallet.publicKey.address).toMatch(/^mn_addr/);
  });

  it('ECDSA-W-02 a wallet built from a Schnorr key is unchanged (regression)', () => {
    const wallet = walletWithNight(keystores.schnorr);

    expect(wallet.publicKey.publicKey.tag).toBe('schnorr');
    expect(wallet.publicKey.publicKey.value).toHaveLength(64); // 32-byte x-only
    expect(wallet.publicKey.addressHex).toBe(ledger.addressFromKey(keystores.schnorr.getPublicKey()));
  });
});

describe('Phase 2 — authorized spend, signatures independently verified (ECDSA-SPEND-01/02/03)', () => {
  it.each([
    { scheme: 'ecdsa' as const, id: 'ECDSA-SPEND-01/02' },
    { scheme: 'schnorr' as const, id: 'ECDSA-SPEND-03 (regression)' },
  ])('$id: a $scheme transfer is built, authorized, and its spend signatures verify', ({ scheme }) => {
    const keystore = keystores[scheme];
    const verifyingKey = keystore.getPublicKey();
    const transaction = buildTransfer(keystore);

    const segments = TransactionOps.getSegments(transaction);
    expect(segments.length).toBeGreaterThan(0); // the spend has at least one signable segment

    const allVerify = segments.map((segment) => {
      const data = TransactionOps.getSignatureData(transaction, segment).pipe(Either.getOrThrow);
      const signature = keystore.signData(data);
      expect(signature.tag).toBe(scheme);
      // independent oracle AND ledger both accept the spend signature
      return verifyWithOracle(verifyingKey, data, signature) && ledger.verifySignature(verifyingKey, data, signature);
    });
    expect(allVerify.every(Boolean)).toBe(true);

    // the wallet authorizes the spend (matching-scheme signature attaches without rejection)
    expect(Either.isRight(transacting.signUnprovenTransaction(transaction, (data) => keystore.signData(data)))).toBe(
      true,
    );
  });
});

describe('Phase 2 — mixed wallets coexist with no cross-talk (ECDSA-SPEND-04)', () => {
  it('ECDSA and Schnorr wallets have distinct identities and non-interchangeable signatures', () => {
    const ecdsaWallet = walletWithNight(keystores.ecdsa);
    const schnorrWallet = walletWithNight(keystores.schnorr);

    expect(ecdsaWallet.publicKey.publicKey.tag).toBe('ecdsa');
    expect(schnorrWallet.publicKey.publicKey.tag).toBe('schnorr');
    expect(ecdsaWallet.publicKey.addressHex).not.toBe(schnorrWallet.publicKey.addressHex);

    const data = new TextEncoder().encode('spend');
    const ecdsaSignature = keystores.ecdsa.signData(data);
    const schnorrSignature = keystores.schnorr.signData(data);

    // each verifies under its own key
    expect(verifyWithOracle(ecdsaWallet.publicKey.publicKey, data, ecdsaSignature)).toBe(true);
    expect(verifyWithOracle(schnorrWallet.publicKey.publicKey, data, schnorrSignature)).toBe(true);
    // and never under the other's
    expect(verifyWithOracle(schnorrWallet.publicKey.publicKey, data, ecdsaSignature)).toBe(false);
    expect(verifyWithOracle(ecdsaWallet.publicKey.publicKey, data, schnorrSignature)).toBe(false);
  });

  it('both wallets authorize their own real spends concurrently without interference', async () => {
    // Build a transfer for each wallet, then authorize both concurrently. The
    // capability signs synchronously and is stateless, so interleaving them must
    // not bleed scheme/state across the two sessions.
    const ecdsaTransfer = buildTransfer(keystores.ecdsa);
    const schnorrTransfer = buildTransfer(keystores.schnorr);

    const [ecdsaSigned, schnorrSigned] = await Promise.all([
      Promise.resolve(transacting.signUnprovenTransaction(ecdsaTransfer, (data) => keystores.ecdsa.signData(data))),
      Promise.resolve(transacting.signUnprovenTransaction(schnorrTransfer, (data) => keystores.schnorr.signData(data))),
    ]);

    expect(Either.isRight(ecdsaSigned)).toBe(true);
    expect(Either.isRight(schnorrSigned)).toBe(true);

    // Cross-signing must still be rejected: the ECDSA transfer cannot be authorized by Schnorr, and vice versa.
    expect(
      Either.isLeft(
        transacting.signUnprovenTransaction(buildTransfer(keystores.ecdsa), (d) => keystores.schnorr.signData(d)),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        transacting.signUnprovenTransaction(buildTransfer(keystores.schnorr), (d) => keystores.ecdsa.signData(d)),
      ),
    ).toBe(true);
  });
});

describe('Phase 2 — ECDSA signs a multi-offer transaction (guaranteed + fallible)', () => {
  it('attaches a verifying ECDSA signature to both the guaranteed and fallible offers', () => {
    const ownerPK = PublicKey.fromKeyStore(keystores.ecdsa);
    const utxos = [0, 1].map(
      (i) =>
        new UtxoWithMeta({
          utxo: {
            value: 1_000n + BigInt(i),
            owner: ownerPK.addressHex,
            type: NIGHT,
            intentHash: ledger.sampleIntentHash(),
            outputNo: i,
          },
          meta: { ctime: new Date(0), registeredForDustGeneration: false },
        }),
    );
    const wallet = CoreWallet.restore(
      UnshieldedState.restore(utxos, []),
      ownerPK,
      { appliedId: 0n, highestTransactionId: 0n },
      ProtocolVersion.ProtocolVersion(1n),
      networkId,
    );

    // A rotate transaction places one UTxO in the guaranteed offer and the rest
    // in the fallible offer of a single intent.
    const { transaction } = transacting
      .rotateUtxos(wallet, utxos.slice(0, 1), utxos.slice(1), wallet.publicKey.publicKey, ttl)
      .pipe(Either.getOrThrow);
    const intent = Array.from(transaction.intents?.values() ?? [])[0];
    expect(intent?.guaranteedUnshieldedOffer).toBeDefined();
    expect(intent?.fallibleUnshieldedOffer).toBeDefined();

    // Every signable segment's ECDSA signature verifies independently...
    const segments = TransactionOps.getSegments(transaction);
    const allVerify = segments.map((segment) => {
      const data = TransactionOps.getSignatureData(transaction, segment).pipe(Either.getOrThrow);
      return verifyWithOracle(wallet.publicKey.publicKey, data, keystores.ecdsa.signData(data));
    });
    expect(allVerify.every(Boolean)).toBe(true);

    // ...and signing attaches a signature to BOTH offers.
    const signed = transacting.signUnprovenTransaction(transaction, (data) => keystores.ecdsa.signData(data));
    expect(Either.isRight(signed)).toBe(true);
    if (Either.isRight(signed)) {
      const signedIntent = Array.from(signed.right.intents?.values() ?? [])[0];
      // Exactly one signature per offer — one input owner in each (1 guaranteed + 1 fallible UTxO).
      expect(signedIntent?.guaranteedUnshieldedOffer?.signatures.length ?? 0).toBe(1);
      expect(signedIntent?.fallibleUnshieldedOffer?.signatures.length ?? 0).toBe(1);
    }
  });
});

describe('Phase 2 — ECDSA wallet survives serialize → restore and can still authorize', () => {
  it('restores an ECDSA wallet from a snapshot and authorizes a spend with it', () => {
    const capability = makeDefaultV1SerializationCapability();
    const original = walletWithNight(keystores.ecdsa);

    const restored = capability.deserialize(capability.serialize(original)).pipe(Either.getOrThrow);
    expect(restored.publicKey.publicKey.tag).toBe('ecdsa');
    expect(restored.publicKey).toEqual(original.publicKey);

    // The restored ECDSA wallet builds and authorizes a spend with its ECDSA keystore.
    const { transaction } = transacting
      .makeTransfer(restored, [{ amount: 100n, type: NIGHT, receiverAddress: recipient }], ttl)
      .pipe(Either.getOrThrow);
    const signed = transacting.signUnprovenTransaction(transaction, (data) => keystores.ecdsa.signData(data));
    expect(Either.isRight(signed)).toBe(true);
  });
});
