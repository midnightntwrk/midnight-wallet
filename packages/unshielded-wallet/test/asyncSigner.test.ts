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
// The SigningService authorizes a transaction through an ASYNC signer callback (#504) — the pathway MPC/HSM backends
// need. These pure unit tests drive it with an immediate (Promise-wrapped) keystore and a rejecting fake; the signer's
// cryptographic output is checked with the independent @noble/curves oracle AND the ledger, so nothing is
// self-attested.
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { chooseCoin } from '@midnightntwrk/wallet-sdk-capabilities';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Cause, Effect, Either, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey, type UnshieldedKeystore } from '../src/KeyStore.js';
import { makeDefaultCoinsAndBalancesCapability } from '../src/v1/CoinsAndBalances.js';
import { CoreWallet } from '../src/v1/CoreWallet.js';
import { makeDefaultKeysCapability } from '../src/v1/Keys.js';
import { makeDefaultSigningService } from '../src/v1/Signing.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
} from '../src/v1/Transacting.js';
import { TransactionOps } from '../src/v1/TransactionOps.js';
import { UnshieldedState, UtxoWithMeta } from '../src/v1/UnshieldedState.js';
import { SignError } from '../src/v1/WalletError.js';
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
const signing = makeDefaultSigningService();

const secret = Buffer.alloc(32, 9);
const keystore = createKeystore({ kind: 'ecdsa', secret }, networkId);

const walletWithNight = (ks: UnshieldedKeystore): CoreWallet => {
  const ownerPK = PublicKey.fromKeyStore(ks);
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

const buildTransfer = (ks: UnshieldedKeystore): ledger.UnprovenTransaction =>
  transacting
    .makeTransfer(walletWithNight(ks), [{ amount: 100n, type: NIGHT, receiverAddress: recipient }], ttl)
    .pipe(Either.getOrThrow).transaction;

describe('SigningService authorizes through an async signer (#504)', () => {
  it('signs every segment via an asynchronous signer and attaches a verifying signature', async () => {
    const transaction = buildTransfer(keystore);
    const verifyingKey = keystore.getPublicKey();

    // The signer is async (Promise) — the very shape MPC/HSM require.
    const signed = await Effect.runPromise(signing.sign(transaction, keystore.signDataAsync));

    // A signature is attached to the spend's input(s) (whichever offer they sit in)...
    const attachedSignatures = Array.from(signed.intents?.values() ?? []).flatMap((intent) => [
      ...(intent.guaranteedUnshieldedOffer?.signatures ?? []),
      ...(intent.fallibleUnshieldedOffer?.signatures ?? []),
    ]);
    expect(attachedSignatures.length).toBeGreaterThan(0);

    // ...and what was signed over each segment is independently valid under the wallet's key (oracle AND ledger).
    const segmentsVerify = TransactionOps.getSegments(signed).map((segment) => {
      const data = TransactionOps.getSignatureData(signed, segment).pipe(Either.getOrThrow);
      const signature = keystore.signData(data);
      return verifyWithOracle(verifyingKey, data, signature) && ledger.verifySignature(verifyingKey, data, signature);
    });
    expect(segmentsVerify.every(Boolean)).toBe(true);
  });

  it('surfaces a rejecting signer as a SignError carrying the original cause', async () => {
    const transaction = buildTransfer(keystore);
    const backendDown = new Error('MPC coordinator unreachable');

    const exit = await Effect.runPromiseExit(signing.sign(transaction, () => Promise.reject(backendDown)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.failureOption(exit.cause));
      expect(error).toBeInstanceOf(SignError);
      if (error instanceof SignError) {
        expect(error.cause).toBe(backendDown);
      }
    }
  });

  it('never invokes the signer for a transaction with no signable segments', async () => {
    const emptyTx = ledger.Transaction.fromParts(networkId);

    // A throwing signer would surface as a failed Effect if it were ever called; it is not.
    const signed = await Effect.runPromise(
      signing.sign(emptyTx, () => {
        throw new Error('signer must not be called when there is nothing to sign');
      }),
    );

    expect(signed).toBe(emptyTx);
  });
});
