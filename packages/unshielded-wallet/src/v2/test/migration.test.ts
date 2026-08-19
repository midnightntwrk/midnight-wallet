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
// The migration seam. Unshielded's cross-ledger migration is a STRUCTURAL CARRY, not the fresh-state-and-replay that
// shielded and dust use: unshielded state is public UTXO data, so there is nothing to decrypt, nothing to re-anchor,
// and no reason to drop it and wait for a replay. Every UTXO crosses; the only real transformation is the key, which
// goes from ledger-v8's bare hex string to ledger-v9's `{tag, value}` record.
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

    it('carries pending UTXOs as pending', async () => {
      const previous = previousWallet({
        available: [fixtureUtxo(owner, 100n, 0)],
        pending: [fixtureUtxo(owner, 55n, 9)],
        appliedId: 4n,
        protocolVersion: 7n,
      });

      const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

      expect(HashMap.size(wallet.state.availableUtxos)).toBe(1);
      expect(HashMap.size(wallet.state.pendingUtxos)).toBe(1);
      expect([...HashMap.values(wallet.state.pendingUtxos)][0].utxo.value).toBe(55n);
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
