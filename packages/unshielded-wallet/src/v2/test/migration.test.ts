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
// The migration seam. Unshielded's cross-ledger migration is a STRUCTURAL CARRY, field for field rather than the
// byte-level round trip shielded uses or the fresh-state-and-replay dust uses: unshielded state is public UTXO data,
// so there is nothing to decrypt and no reason to drop it and wait for a replay. Every UTXO crosses, and every one of
// them crosses as AVAILABLE — a booking made for a transaction of the previous ledger version outlives its own reason
// at the boundary. The other transformation is the key, which goes from ledger-v8's bare hex string to ledger-v9's
// `{tag, value}` record.
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, HashMap } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import {
  makeCarryOverMigration,
  makeCrossLedgerMigration,
  makeEmptyWalletMigration,
  type PreviousLedgerWallet,
} from '../Migration.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { fixtureOwner, fixtureUtxo } from './syncFixtures.js';

const owner = fixtureOwner();

/**
 * A previous-ledger (v8) wallet, described structurally. Its verifying key is a bare hex string — that is exactly what
 * ledger-v8 hands out, and the difference this migration has to reconcile.
 */
const previousWallet = (params: {
  readonly available: readonly ReturnType<typeof fixtureUtxo>[];
  readonly pending?: readonly ReturnType<typeof fixtureUtxo>[];
  readonly appliedId: bigint;
  readonly protocolVersion: bigint;
}): PreviousLedgerWallet => ({
  // Built through the real `UnshieldedState`, not from plain arrays: the previous variant hands over a state whose
  // UTXOs live in Effect `HashMap`s, and a fixture that passed arrays would let a migration that iterated entries
  // instead of values pass here and fail only against a real wallet.
  state: UnshieldedState.restore(params.available, params.pending ?? []),
  publicKey: {
    publicKey: owner.publicKey.value,
    addressHex: owner.addressHex,
    address: owner.address,
  },
  networkId: NetworkId.NetworkId.Undeployed,
  protocolVersion: params.protocolVersion,
  progress: { appliedId: params.appliedId, highestTransactionId: params.appliedId, isConnected: true },
});

describe('unshielded state migration', () => {
  describe('empty-wallet migration', () => {
    it('produces a coinless wallet on the configured network', async () => {
      const migration = makeEmptyWalletMigration({ networkId: NetworkId.NetworkId.Undeployed });
      const wallet = await Effect.runPromise(migration.migrate(null));

      expect(HashMap.size(wallet.state.availableUtxos)).toBe(0);
      expect(HashMap.size(wallet.state.pendingUtxos)).toBe(0);
      expect(wallet.networkId).toBe(NetworkId.NetworkId.Undeployed);
    });
  });

  describe('carry-over migration', () => {
    it('hands the previous state straight back when both sides share a ledger version', async () => {
      const previous = CoreWallet.restore(
        UnshieldedState.restore([fixtureUtxo(owner, 100n, 0)], []),
        owner,
        { appliedId: 4n, highestTransactionId: 4n },
        ProtocolVersion.ProtocolVersion(3n),
        NetworkId.NetworkId.Undeployed,
      );

      const wallet = await Effect.runPromise(makeCarryOverMigration().migrate(previous));

      expect(wallet).toBe(previous);
    });
  });

  describe('cross-ledger migration', () => {
    it('carries every UTXO across, value for value', async () => {
      const utxos = [fixtureUtxo(owner, 100n, 0), fixtureUtxo(owner, 250n, 1), fixtureUtxo(owner, 7n, 2)];
      const previous = previousWallet({ available: utxos, appliedId: 4n, protocolVersion: 7n });

      const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

      expect(HashMap.size(wallet.state.availableUtxos)).toBe(3);
      expect(
        [...HashMap.values(wallet.state.availableUtxos)].map((u) => u.utxo.value).sort((a, b) => Number(a - b)),
      ).toEqual([7n, 100n, 250n]);
    });

    it('releases previously booked UTXOs into the available set', async () => {
      const booked = fixtureUtxo(owner, 55n, 9);
      const previous = previousWallet({
        available: [fixtureUtxo(owner, 100n, 0)],
        pending: [booked],
        appliedId: 4n,
        protocolVersion: 7n,
      });

      const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

      // A booking exists to stop a UTXO being spent twice while the transaction that reserved it might still land. The
      // transaction codec moved at this boundary, so a transaction of the previous ledger version can never be included
      // in a ledger-v9 block: the booking's reason expires at the boundary itself, and the UTXO crosses as available.
      expect(HashMap.size(wallet.state.availableUtxos)).toBe(2);
      expect(HashMap.size(wallet.state.pendingUtxos)).toBe(0);

      // Released, not merely counted: the freed UTXO is the one that was booked, field for field.
      const released = [...HashMap.values(wallet.state.availableUtxos)].filter(
        (held) => held.utxo.outputNo === booked.utxo.outputNo,
      );

      expect(released).toHaveLength(1);
      expect(released[0].utxo.value).toBe(booked.utxo.value);
      expect(released[0].utxo.owner).toBe(booked.utxo.owner);
      expect(released[0].utxo.type).toBe(booked.utxo.type);
      expect(released[0].utxo.intentHash).toBe(booked.utxo.intentHash);
      expect(released[0].utxo.outputNo).toBe(booked.utxo.outputNo);
      expect(released[0].meta.ctime.getTime()).toBe(booked.meta.ctime.getTime());
      expect(released[0].meta.registeredForDustGeneration).toBe(booked.meta.registeredForDustGeneration);
    });

    it('preserves each UTXO field, not merely the count', async () => {
      const utxo = fixtureUtxo(owner, 100n, 3);
      const previous = previousWallet({ available: [utxo], appliedId: 4n, protocolVersion: 7n });

      const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));
      const carried = [...HashMap.values(wallet.state.availableUtxos)][0];

      expect(carried.utxo.value).toBe(utxo.utxo.value);
      expect(carried.utxo.owner).toBe(utxo.utxo.owner);
      expect(carried.utxo.type).toBe(utxo.utxo.type);
      expect(carried.utxo.intentHash).toBe(utxo.utxo.intentHash);
      expect(carried.utxo.outputNo).toBe(utxo.utxo.outputNo);
      expect(carried.meta.ctime.getTime()).toBe(utxo.meta.ctime.getTime());
      expect(carried.meta.registeredForDustGeneration).toBe(utxo.meta.registeredForDustGeneration);
    });

    it('carries every UTXO as generating no dust, whatever the previous version reported', async () => {
      // The fork wipes the ledger's dust generation state outright. Its chain-side replay restores generation for
      // cNIGHT-backed Night only, so a wallet holding native NIGHT arrives on the other side generating nothing —
      // and the indexer, which reports this flag as a creation-time value it never revises, has no ledger-v9 event
      // with which to say so. Carrying the previous version's `true` would be carrying a statement about a ledger
      // that no longer exists. The node's own fork test says the same in the other direction: "the fork wipes dust
      // state ... the registration funds itself from the retroactive DUST" (`util/toolkit/tests/hardfork_e2e.rs`,
      // step 5c) — retroactive dust only accrues to Night the ledger considers generationless.
      //
      // Known limitation: cNIGHT-backed Night *is* restored chain-side and reads `false` here until its next
      // sync-time update says otherwise. Nothing breaks for it — the dust wallet decides fee funding from the dust
      // coins it actually holds, not from this flag, which is display metadata.
      const utxo = { ...fixtureUtxo(owner, 100n, 4) };
      const registered = { utxo: utxo.utxo, meta: { ...utxo.meta, registeredForDustGeneration: true } };
      const previous = previousWallet({ available: [registered], appliedId: 4n, protocolVersion: 7n });

      const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));
      const carried = [...HashMap.values(wallet.state.availableUtxos)][0];

      expect(carried.meta.registeredForDustGeneration).toBe(false);
      // Everything else about the UTXO is untouched — this is one field, not a re-reading of the UTXO.
      expect(carried.utxo.value).toBe(registered.utxo.value);
      expect(carried.utxo.intentHash).toBe(registered.utxo.intentHash);
      expect(carried.utxo.outputNo).toBe(registered.utxo.outputNo);
      expect(carried.meta.ctime.getTime()).toBe(registered.meta.ctime.getTime());
    });

    it('tags the previous ledger version bare-string verifying key as schnorr', async () => {
      const previous = previousWallet({ available: [], appliedId: 4n, protocolVersion: 7n });

      const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

      expect(wallet.publicKey.publicKey).toEqual({ tag: 'schnorr', value: owner.publicKey.value });
      expect(wallet.publicKey.addressHex).toBe(owner.addressHex);
      expect(wallet.publicKey.address).toBe(owner.address);
    });

    it('leaves the sync cursor exactly where the previous variant left it', async () => {
      const previous = previousWallet({ available: [], appliedId: 4n, protocolVersion: 7n });

      const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

      // Parked, not rewound and not advanced: the boundary transaction was observed but never applied, so the new
      // variant has to re-fetch it from this very cursor.
      expect(wallet.progress.appliedId).toBe(4n);
    });

    it('carries the network and the version that triggered the hand-over', async () => {
      const previous = previousWallet({ available: [], appliedId: 4n, protocolVersion: 7n });

      const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

      expect(wallet.networkId).toBe(NetworkId.NetworkId.Undeployed);
      expect(wallet.protocolVersion).toBe(7n);
    });
  });
});
