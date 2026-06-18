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
// Integration: the signing path rejects a wrong-scheme signature BEFORE it is
// attached (#402 AC #4 — ECDSA-MM-03/04/05/07/08). A transaction whose inputs
// are owned by an ECDSA key cannot be signed with a Schnorr segment, and the
// failure surfaces as a typed SchemeMismatchError with no partially-signed
// transaction escaping toward the network.
import * as ledger from '@midnight-ntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { Array as Arr, Either, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey, type UnshieldedKeystore } from '../../KeyStore.js';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
} from '../Transacting.js';
import { UnshieldedState, UtxoWithMeta } from '../UnshieldedState.js';
import { SchemeMismatchError } from '../WalletError.js';

const NIGHT = ledger.nativeToken().raw;
const networkId = NetworkId.NetworkId.Undeployed;
const ttl = DateOps.addSeconds(new Date(), 1800);

const config: DefaultTransactingConfiguration = { networkId };
const context: DefaultTransactingContext = {
  coinSelection: chooseCoin,
  coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(),
  keysCapability: makeDefaultKeysCapability(),
};
const transacting = makeDefaultTransactingCapability(config, () => context);

// Two keystores from the same scalar so their schemes differ but both are valid.
const secret = Buffer.alloc(32, 9);
const ecdsaKeystore = createKeystore({ kind: 'ecdsa', secret }, networkId);
const schnorrKeystore = createKeystore({ kind: 'schnorr', secret }, networkId);

const walletOwnedBy = (keystore: UnshieldedKeystore): { wallet: CoreWallet; utxos: readonly UtxoWithMeta[] } => {
  const ownerPK = PublicKey.fromKeyStore(keystore);
  const utxos = pipe(
    Arr.range(0, 1),
    Arr.map(
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
    ),
  );
  const wallet = CoreWallet.restore(
    UnshieldedState.restore(utxos, []),
    ownerPK,
    { appliedId: 0n, highestTransactionId: 0n },
    ProtocolVersion.ProtocolVersion(1n),
    networkId,
  );
  return { wallet, utxos };
};

// An unproven transaction whose inputs are owned by the ECDSA verifying key.
const ecdsaOwnedTransaction = (): ledger.UnprovenTransaction => {
  const { wallet, utxos } = walletOwnedBy(ecdsaKeystore);
  return transacting.rotateUtxos(wallet, utxos, [], wallet.publicKey.publicKey, ttl).pipe(Either.getOrThrow)
    .transaction;
};

describe('signing rejects a scheme mismatch (ECDSA-MM-03/04/05/07/08)', () => {
  it('rejects a Schnorr signature for an ECDSA-owned transaction, before submission', () => {
    const transaction = ecdsaOwnedTransaction();

    const result = transacting.signUnprovenTransaction(transaction, (data) => schnorrKeystore.signData(data));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SchemeMismatchError);
      if (result.left instanceof SchemeMismatchError) {
        expect(result.left.at).toBe('signature-provision');
        expect(result.left.expected).toBe('ecdsa'); // the input owner's scheme
        expect(result.left.supplied).toBe('schnorr'); // the supplied signature's scheme
      }
    }

    // ECDSA-MM-07: the mismatch is caught before the signature is attached, so the
    // transaction carries no partial signature (nothing is left in a submittable state).
    const attachedSignatures = Array.from(transaction.intents?.values() ?? []).flatMap((intent) => [
      ...(intent.guaranteedUnshieldedOffer?.signatures ?? []),
      ...(intent.fallibleUnshieldedOffer?.signatures ?? []),
    ]);
    expect(attachedSignatures).toHaveLength(0);
  });

  it('rejects a Schnorr signature for an ECDSA-owned UNBOUND transaction too', async () => {
    // Exercise the signUnboundTransaction path explicitly (shares the internal
    // signer, but the public entry point is distinct from signUnprovenTransaction).
    const unbound = await ecdsaOwnedTransaction().prove(
      { prove: () => Promise.resolve(Buffer.from([42])), check: () => Promise.resolve([]) },
      ledger.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel,
    );

    const result = transacting.signUnboundTransaction(unbound, (data) => schnorrKeystore.signData(data));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SchemeMismatchError);
    }
  });

  it('accepts the matching ECDSA signature for the same transaction (positive control)', () => {
    const transaction = ecdsaOwnedTransaction();

    const result = transacting.signUnprovenTransaction(transaction, (data) => ecdsaKeystore.signData(data));

    expect(Either.isRight(result)).toBe(true);
  });
});
