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
// FORMAT-DRIFT GATE (second gate). The compat suites answer "does current code READ what old
// versions WROTE?". This one answers the opposite: "does current code WRITE the same shape the
// newest frozen train did?". If not, the current code has evolved the persisted format since the
// last train, and a NEW train must be captured so future code has a frozen sample to stay
// compatible with. Historical trains never change; this gate only tells you a new one is due.
//
// How: for each persisted kind, drive the newest train's payload through the current public
// restore -> serialize round trip and compare the STRUCTURAL SHAPE (see formatShape.ts) of what
// current code re-emits against the frozen bytes. Values, lengths, nonces and map keys are ignored;
// added/removed/renamed fields and type changes are not.
import { firstValueFrom } from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Either } from 'effect';
import { NetworkId, InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities';
import { TRAINS, loadFixture, type FixtureName } from './fixtures.js';
import { formatShape } from './formatShape.js';

// ── formatShape self-check (the one runnable check for the shape reducer) ────────────────────────
describe('formatShape', () => {
  it('ignores values, lengths and map keys but captures fields, nesting and types', () => {
    expect(formatShape({ a: 1, b: 'x' })).toBe('{a:number,b:string}');
    expect(formatShape({ b: 'x', a: 1 })).toBe('{a:number,b:string}'); // key order irrelevant
    expect(formatShape([1, 2, 3])).toBe(formatShape([9])); // array length irrelevant
    // dynamic-key map: different 64-hex keys, same value shape -> identical shape
    const map1 = { ['ab'.repeat(32)]: { v: 1n.toString() } };
    const map2 = { ['cd'.repeat(32)]: { v: 2n.toString() }, ['ef'.repeat(32)]: { v: 3n.toString() } };
    expect(formatShape(map1)).toBe(formatShape(map2));
  });

  it('detects an added field and a changed leaf type', () => {
    expect(formatShape({ a: 1 })).not.toBe(formatShape({ a: 1, lifecycle: {} }));
    expect(formatShape({ v: '5000' })).not.toBe(formatShape({ v: 5000 }));
  });
});

// ── the drift gate ───────────────────────────────────────────────────────────────────────────────
const NEWEST_TRAIN = TRAINS[TRAINS.length - 1]!;

// Endpoints are never dialled — restore() decodes eagerly and start() is never called.
const dummyConnections = {
  indexerClientConnection: {
    indexerHttpUrl: 'http://localhost:1/api/v4/graphql',
    indexerWsUrl: 'ws://localhost:1/api/v4/graphql/ws',
  },
};
const txHistoryStorage = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
const shieldedWallet = () =>
  ShieldedWallet({
    ...dummyConnections,
    networkId: NetworkId.NetworkId.Undeployed,
    txHistoryStorage: txHistoryStorage(),
  });
const unshieldedWallet = () =>
  UnshieldedWallet({
    ...dummyConnections,
    networkId: NetworkId.NetworkId.Undeployed,
    txHistoryStorage: txHistoryStorage(),
  });
const dustWallet = () =>
  DustWallet({
    ...dummyConnections,
    networkId: NetworkId.NetworkId.Undeployed,
    costParameters: { feeBlocksMargin: 5 },
    txHistoryStorage: txHistoryStorage(),
  });

// Mirrors the facade's finalizedTransactionTrait — the same deserialize the production restore uses.
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

/** A persisted kind and how the CURRENT code restores then re-serializes it (round trip). */
type Kind = { fixture: FixtureName; reserialize: (serialized: string) => Promise<string> };

const KINDS: readonly Kind[] = [
  {
    fixture: 'shielded',
    reserialize: async (s) => (await firstValueFrom(shieldedWallet().restore(s).state)).serialize(),
  },
  {
    fixture: 'unshielded',
    reserialize: async (s) => (await firstValueFrom(unshieldedWallet().restore(s).state)).serialize(),
  },
  { fixture: 'dust', reserialize: async (s) => (await firstValueFrom(dustWallet().restore(s).state)).serialize() },
  {
    fixture: 'tx-history',
    reserialize: async (s) => InMemoryTransactionHistoryStorage.restore(s, WalletEntrySchema).serialize(),
  },
  {
    fixture: 'pending-transactions',
    reserialize: async (s) =>
      PendingTransactions.serialize(Either.getOrThrow(PendingTransactions.deserialize(s, txTrait)), txTrait),
  },
];

const driftMessage = (kind: string): string =>
  `Format drift: current code serializes '${kind}' with a DIFFERENT shape than the newest train (${NEWEST_TRAIN}).\n` +
  `The persisted format has evolved since the last train, so a NEW train is due. Capture what the current code\n` +
  `writes and commit it as a new fixture train (never edit an existing train). See README "Creating a new train".`;

describe(`format-drift detection (baseline: ${NEWEST_TRAIN})`, () => {
  describe.each(KINDS)('$fixture', (kind) => {
    it(`current code writes the same '${kind.fixture}' shape the newest train froze`, async () => {
      const fixture = loadFixture(NEWEST_TRAIN, kind.fixture);

      const currentSerialized = await kind.reserialize(fixture.serialized).catch((cause: unknown) => {
        throw new Error(
          `Cannot assess drift for '${kind.fixture}': current code failed to RESTORE the newest train (${NEWEST_TRAIN}).\n` +
            `That is a read-compat break the compat suite reports separately — fix that first.\nCause: ${String(cause)}`,
        );
      });

      const frozenShape = formatShape(JSON.parse(fixture.serialized));
      const currentShape = formatShape(JSON.parse(currentSerialized));

      expect(currentShape, driftMessage(kind.fixture)).toBe(frozenShape);
    });
  });
});
