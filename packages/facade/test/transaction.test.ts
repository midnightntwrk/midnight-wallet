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
import * as ledgerV8 from '@midnightntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { describe, expect, it } from 'vitest';
import { txHistoryHash } from '../src/transaction.js';

const buildTransaction = () =>
  ledger.Transaction.fromParts('undeployed', undefined, undefined, ledger.Intent.new(new Date(Date.now() + 10_000)));

describe('txHistoryHash', () => {
  it('uses the ledger transaction hash for a finalized (proven + signed + bound) tx', () => {
    const tx = buildTransaction().mockProve().bind();
    expect(txHistoryHash(tx)).toBe(tx.transactionHash().toString());
  });

  it('falls back to the hex of the serialized bytes when transactionHash() is unavailable (e.g. proof-erased)', () => {
    const tx = buildTransaction().eraseProofs();
    expect(() => tx.transactionHash()).toThrow();
    expect(txHistoryHash(tx)).toBe(Buffer.from(tx.serialize()).toString('hex'));
  });

  it('is deterministic for a given tx, so the submit (pending) and revert (rejected) sides agree on the key', () => {
    const finalized = buildTransaction().mockProve().bind();
    const proofErased = buildTransaction().eraseProofs();
    expect(txHistoryHash(finalized)).toBe(txHistoryHash(finalized));
    expect(txHistoryHash(proofErased)).toBe(txHistoryHash(proofErased));
  });

  /*
   * An unproven transaction's bytes carry the preimages its proofs are made from, which can hold key material. The
   * history key is stored and shown, so for a transaction with no transaction hash it is taken from the bytes with the
   * proofs erased, never from the unproven bytes themselves.
   */
  it('should key a ledger-v9 unproven transaction by its proof-erased bytes, because its own bytes hold proof preimages', () => {
    const coin = ledger.createShieldedCoinInfo(ledger.shieldedToken().raw, 1n);
    const tx = ledger.Transaction.fromParts(
      'undeployed',
      ledger.ZswapOffer.fromOutput(
        ledger.ZswapOutput.new(coin, 0, ledger.sampleCoinPublicKey(), ledger.sampleEncryptionPublicKey()),
        coin.type,
        coin.value,
      ),
      undefined,
      ledger.Intent.new(new Date(Date.now() + 10_000)),
    );
    const unprovenHex = Buffer.from(tx.serialize()).toString('hex');
    const erasedHex = Buffer.from(tx.eraseProofs().serialize()).toString('hex');
    expect(() => tx.transactionHash()).toThrow();
    expect(erasedHex).not.toBe(unprovenHex);

    expect(txHistoryHash(tx)).toBe(erasedHex);
    expect(txHistoryHash(tx)).not.toBe(unprovenHex);
  });

  it('should key a ledger-v8 unproven transaction by its proof-erased bytes, because its own bytes hold proof preimages', () => {
    const coin = ledgerV8.createShieldedCoinInfo(ledgerV8.shieldedToken().raw, 1n);
    const tx = ledgerV8.Transaction.fromParts(
      'undeployed',
      ledgerV8.ZswapOffer.fromOutput(
        ledgerV8.ZswapOutput.new(coin, 0, ledgerV8.sampleCoinPublicKey(), ledgerV8.sampleEncryptionPublicKey()),
        coin.type,
        coin.value,
      ),
      undefined,
      ledgerV8.Intent.new(new Date(Date.now() + 10_000)),
    );
    const unprovenHex = Buffer.from(tx.serialize()).toString('hex');
    const erasedHex = Buffer.from(tx.eraseProofs().serialize()).toString('hex');
    expect(() => tx.transactionHash()).toThrow();
    expect(erasedHex).not.toBe(unprovenHex);

    expect(txHistoryHash(tx)).toBe(erasedHex);
    expect(txHistoryHash(tx)).not.toBe(unprovenHex);
  });
});
