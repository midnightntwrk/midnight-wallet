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
// Cross-version pending-transactions compatibility. `PendingTransactionsServiceImpl.restore` is a
// public restore-from-string API (capabilities package, present since the T2 train), so apps can
// persist pending transactions across restarts. The wire schema is versioned and has been stable
// since introduction ({version:'v1', transactions:[{tx: hex, creationTime}]}) — but the `tx` field
// holds serialized ledger Transactions written by the era's ledger, so the payload crosses the
// ledger v7→v8 boundary on upgrade. Fixture transactions are mock-proven (proof-typed bytes), the
// closest offline stand-in for the real proven transactions apps persist.
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { DateTime, Either } from 'effect';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities';
import { loadFixture, PENDING_TX_TRAINS } from './fixtures.js';

// Functionally the facade's (internal) finalizedTransactionTrait: the deserialize call is the same
// `Transaction.deserialize('signature', 'proof', 'binding', bytes)` the production restore path
// makes; the identifier helpers mirror its behaviour for the assertions used here.
const txTrait: PendingTransactions.TransactionTrait<ledger.FinalizedTransaction> = {
  isTx: (tx): tx is ledger.FinalizedTransaction => tx instanceof ledger.Transaction,
  serialize: (tx) => tx.serialize(),
  deserialize: (bytes) => ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes),
  ids: (tx) => [...tx.identifiers()],
  firstId: (tx) => tx.identifiers()[0],
  areAllTxIdsIncluded: (tx, txIds) => tx.identifiers().every((id) => txIds.includes(id)),
  isOneIncludedInOther: (tx, otherTx) => tx.identifiers().some((id) => otherTx.identifiers().includes(id)),
  hasTTLExpired: () => false,
};

describe('pending-transactions compatibility', () => {
  // Positive control: current code reads what current code writes.
  it('restores pending transactions written by the current workspace code (control)', () => {
    const keys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(7));
    const coin = ledger.createShieldedCoinInfo('11'.repeat(32), 42n);
    const output = ledger.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
    const offer = ledger.ZswapOffer.fromOutput(output, coin.type, coin.value);
    const tx = ledger.Transaction.fromParts('undeployed', offer).mockProve();

    const serialized = PendingTransactions.serialize<ledger.FinalizedTransaction>(
      PendingTransactions.addPendingTransaction<ledger.FinalizedTransaction>(
        PendingTransactions.empty<ledger.FinalizedTransaction>(),
        tx,
        DateTime.unsafeMake(new Date('2026-03-01T12:00:00.000Z').getTime()),
        txTrait,
      ),
      txTrait,
    );
    const restored = PendingTransactions.deserialize<ledger.FinalizedTransaction>(serialized, txTrait);

    expect(Either.isRight(restored)).toBe(true);
    expect(Either.getOrThrow(restored).all).toHaveLength(1);
  });

  describe.each(PENDING_TX_TRAINS)('%s', (train) => {
    const fixture = loadFixture(train, 'pending-transactions');

    it(`restores pending transactions written by ${fixture.name}@${fixture.version} (embedded ledger txs survive)`, () => {
      const restored = PendingTransactions.deserialize<ledger.FinalizedTransaction>(fixture.serialized, txTrait);

      const state = Either.getOrThrow(restored); // throws with the ParseError if the era's payload is rejected
      expect(state.all).toHaveLength(fixture.expected['txCount'] as number);
      expect(state.all.map((item) => [...item.tx.identifiers()])).toEqual(fixture.expected['identifiers']);
    });
  });
});
