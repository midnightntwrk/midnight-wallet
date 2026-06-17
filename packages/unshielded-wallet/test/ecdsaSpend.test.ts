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
import * as ledger from '@midnight-ntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
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
});
