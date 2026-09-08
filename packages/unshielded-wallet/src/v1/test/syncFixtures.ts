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
// The ledger-v8 twin of the v9 fixtures. It differs only where the ledger versions genuinely differ: the keystore
// takes a bare secret rather than a `{kind, secret}` record, and the verifying key it yields is a hex string.
//
// Deterministic fixtures for the sync-boundary tests. Unshielded sync updates are plain decoded JSON — the indexer
// reports UTXOs as public data — so a fixture can build them directly and still be the real shape, unlike shielded and
// dust whose fixtures must mint real events through a simulator. What is NOT synthetic here is the identity: the owner
// address is derived through the real keystore from a fixed seed, so the UTXOs are addressed to an address the ledger
// would actually produce.
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Ref } from 'effect';
import { createKeystore, type PublicKey, PublicKey as PublicKeyOps } from '../KeyStore.js';
import { type UnshieldedUpdate, type UtxoWithMeta, type WalletSyncUpdate } from '../SyncSchema.js';
import { type TransactionHistoryService } from '../TransactionHistory.js';

/** A fixed 32-byte secret, so every fixture run addresses UTXOs to the same real address. */
export const fixtureSeed = (): Uint8Array => Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) % 256);

/** The fixture owner, derived through the real keystore. */
export const fixtureOwner = (): PublicKey =>
  PublicKeyOps.fromKeyStore(createKeystore(fixtureSeed(), NetworkId.NetworkId.Undeployed));

/** A UTXO addressed to `owner`, deterministic in `outputNo`. */
export const fixtureUtxo = (owner: PublicKey, value: bigint, outputNo: number): UtxoWithMeta => ({
  utxo: {
    value,
    owner: owner.addressHex,
    type: ledger.nativeToken().raw,
    intentHash: ledger.sampleIntentHash(),
    outputNo,
  },
  meta: {
    ctime: new Date(1_700_000_000_000 + outputNo * 1000),
    registeredForDustGeneration: false,
  },
});

/**
 * A transaction update as the indexer reports it: one event, one id, one protocol version. This is the unit the
 * unshielded boundary rule operates on — there is no batch to split.
 */
export const fixtureTransaction = (params: {
  readonly id: number;
  readonly protocolVersion: number;
  readonly createdUtxos?: readonly UtxoWithMeta[];
  readonly spentUtxos?: readonly UtxoWithMeta[];
  readonly status?: 'SUCCESS' | 'FAILURE';
}): UnshieldedUpdate => {
  const status = params.status ?? 'SUCCESS';
  return {
    type: 'UnshieldedTransaction',
    transaction: {
      id: params.id,
      hash: `hash-${params.id}`,
      type: 'RegularTransaction',
      protocolVersion: params.protocolVersion,
      identifiers: [],
      block: {
        hash: `block-${params.id}`,
        height: params.id,
        timestamp: new Date(1_700_000_000_000 + params.id * 6000),
      },
      fees: { paidFees: 0n, estimatedFees: 0n },
      transactionResult: { status, segments: [{ id: 1, success: status === 'SUCCESS' }] },
    },
    createdUtxos: params.createdUtxos ?? [],
    spentUtxos: params.spentUtxos ?? [],
    status,
  };
};

/**
 * A progress message: how far the source has got with this address, and the version at the chain's tip.
 *
 * @remarks
 *   The version is the chain's, not this timeline's, which is why the fold ignores it — only the signal the source splits
 *   off a frame may annotate, because only that one is gated on unread history.
 */
export const fixtureProgress = (highestTransactionId: number, protocolVersion: number): WalletSyncUpdate => ({
  type: 'UnshieldedTransactionsProgress',
  highestTransactionId,
  protocolVersion,
});

/**
 * A transaction-history service that records what it was asked to write instead of writing it.
 *
 * @remarks
 *   A stub, not a mock: the assertions read the recorded list, they do not interrogate a spy. This is what makes "the
 *   boundary transaction produced no tx-history put" directly observable.
 */
export const recordingHistory = (): {
  readonly service: TransactionHistoryService;
  readonly puts: () => readonly UnshieldedUpdate[];
} => {
  const recorded = Ref.unsafeMake<readonly UnshieldedUpdate[]>([]);
  return {
    service: { put: (update: UnshieldedUpdate) => Ref.update(recorded, (all) => [...all, update]) },
    puts: () => Effect.runSync(Ref.get(recorded)),
  };
};
