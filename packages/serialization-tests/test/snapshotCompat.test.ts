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
// Cross-version wallet snapshot compatibility. Every fixture under ../fixtures was serialized by a
// real published SDK version, with wallet content produced by EVENT REPLAY through that version's
// own sync path against its own ledger (real merkle trees, real dust generation, confirmed and
// pending transfers between two wallets). See ../README.md and ../BOUNDARIES.md.
//
// Each test restores a fixture through the CURRENT workspace code's public API — the exact code
// path a production app uses — and asserts the content survives, not merely that decoding does
// not throw.
import { firstValueFrom } from 'rxjs';
import { NetworkId, InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import {
  TRAINS,
  loadFixture,
  TOKEN_A,
  TOKEN_B,
  TRANSFER_VALUE,
  SENDER_COIN_VALUES_A,
  SENDER_BALANCE_A,
  SENDER_BALANCE_B,
  NIGHT_VALUE,
  CUSTOM_UNSHIELDED,
  CUSTOM_UNSHIELDED_VALUE,
  UNSHIELDED_PENDING_VALUE,
} from './fixtures.js';

// Connections are never dialled: `restore()` deserializes eagerly and the tests never call
// `start()`, so dummy endpoints keep these tests in the unit lane.
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

const sortedBigints = (values: readonly bigint[]): readonly bigint[] => [...values].sort((a, b) => Number(a - b));

describe('shielded snapshot compatibility', () => {
  describe.each(TRAINS)('%s', (train) => {
    const sender = loadFixture(train, 'shielded');
    const receiver = loadFixture(train, 'shielded-receiver');
    const pending = loadFixture(train, 'shielded-pending');
    const deep = loadFixture(train, 'shielded-deep');

    it(`restores the sender snapshot written by ${sender.name}@${sender.version} (post-transfer coins survive)`, async () => {
      const wallet = shieldedWallet().restore(sender.serialized);
      const state = await firstValueFrom(wallet.state);

      expect(state.balances[TOKEN_A]).toBe(SENDER_BALANCE_A);
      expect(state.balances[TOKEN_B]).toBe(SENDER_BALANCE_B);
      expect(
        sortedBigints(state.availableCoins.filter((c) => c.coin.type === TOKEN_A).map((c) => c.coin.value)),
      ).toEqual([...SENDER_COIN_VALUES_A]);
    });

    it(`restores the receiver snapshot written by ${receiver.name}@${receiver.version} (incoming transfer survives)`, async () => {
      const wallet = shieldedWallet().restore(receiver.serialized);
      const state = await firstValueFrom(wallet.state);

      expect(state.balances[TOKEN_A]).toBe(TRANSFER_VALUE);
      expect(state.availableCoins).toHaveLength(1);
    });

    it(`restores the pending-spend snapshot written by ${pending.name}@${pending.version} (pending spend survives)`, async () => {
      const wallet = shieldedWallet().restore(pending.serialized);
      const state = await firstValueFrom(wallet.state);

      // The 400n coin was locally spent but unconfirmed when serialized. A surviving pending spend
      // is observable as its exclusion from the available set (pendingSpends subtract from
      // available; the pendingCoins getter reports pending OUTPUTS, which this wallet has none of).
      expect(
        sortedBigints(state.availableCoins.filter((c) => c.coin.type === TOKEN_A).map((c) => c.coin.value)),
      ).toEqual([100n, 130n]);
      expect(state.balances[TOKEN_A]).toBe(230n);
      expect(state.balances[TOKEN_B]).toBe(SENDER_BALANCE_B);
    });

    it(`restores the deep-tree snapshot written by ${deep.name}@${deep.version} (aged tree survives)`, async () => {
      const wallet = shieldedWallet().restore(deep.serialized);
      const state = await firstValueFrom(wallet.state);

      expect(state.availableCoins).toHaveLength(deep.expected['coinCount'] as number);
    });
  });

  // T1 (wallet-sdk-shielded@1.0.0) embedded the tx history inside the snapshot itself. The current
  // schema no longer has that field, and Effect Schema silently ignores unknown keys — so the
  // restore SUCCEEDS but the user's transaction history is silently destroyed. This test asserts
  // the behaviour a persistence layer should have (history survives a restore→serialize round
  // trip); `it.fails` documents that today it does not. Remove `.fails` when a migration lands.
  it.fails('preserves the embedded tx history of a t1-2026-01-28 snapshot (KNOWN SILENT DATA LOSS)', async () => {
    // Type cast required because: JSON.parse is untyped; the raw snapshot shape is exactly what this test inspects
    type RawShieldedSnapshot = { txHistory?: readonly string[] };
    const fixture = loadFixture('t1-2026-01-28', 'shielded');
    const rawFixture = JSON.parse(fixture.serialized) as RawShieldedSnapshot;
    expect(rawFixture.txHistory).toHaveLength(2); // the fixture really carries history

    const wallet = shieldedWallet().restore(fixture.serialized);
    const state = await firstValueFrom(wallet.state);
    const reserialized = JSON.parse(state.serialize()) as RawShieldedSnapshot;

    expect(reserialized.txHistory).toHaveLength(2);
  });
});

describe('unshielded snapshot compatibility', () => {
  describe.each(TRAINS)('%s', (train) => {
    const fixture = loadFixture(train, 'unshielded');
    const minimal = loadFixture(train, 'unshielded-minimal');

    it(`restores the snapshot written by ${fixture.name}@${fixture.version} (UTXOs and dust-registration flags survive)`, async () => {
      const wallet = unshieldedWallet().restore(fixture.serialized);
      const state = await firstValueFrom(wallet.state);

      expect(sortedBigints(state.availableCoins.map((u) => u.utxo.value))).toEqual(
        sortedBigints([NIGHT_VALUE, CUSTOM_UNSHIELDED_VALUE]),
      );
      expect(state.pendingCoins.map((u) => u.utxo.value)).toEqual([UNSHIELDED_PENDING_VALUE]);

      const nightUtxo = state.availableCoins.find((u) => u.utxo.value === NIGHT_VALUE);
      const customUtxo = state.availableCoins.find((u) => u.utxo.value === CUSTOM_UNSHIELDED_VALUE);
      expect(nightUtxo?.meta.registeredForDustGeneration).toBe(true);
      expect(customUtxo?.meta.registeredForDustGeneration).toBe(false);
      expect(customUtxo?.utxo.type).toBe(CUSTOM_UNSHIELDED);
      expect(nightUtxo?.utxo.owner).toBe(fixture.expected['address']);
    });

    it(`restores the minimal snapshot written by ${minimal.name}@${minimal.version} (absent optional fields tolerated)`, async () => {
      const wallet = unshieldedWallet().restore(minimal.serialized);
      const state = await firstValueFrom(wallet.state);

      expect(state.availableCoins.map((u) => u.utxo.value)).toEqual([CUSTOM_UNSHIELDED_VALUE]);
      expect(state.pendingCoins).toHaveLength(0);
    });
  });
});

describe('dust snapshot compatibility', () => {
  describe.each(TRAINS)('%s', (train) => {
    const fixture = loadFixture(train, 'dust');

    it(`restores the snapshot written by ${fixture.name}@${fixture.version} (generated dust UTXO survives)`, async () => {
      const wallet = dustWallet().restore(fixture.serialized);
      const state = await firstValueFrom(wallet.state);

      expect(state.publicKey).toBe(BigInt(fixture.expected['publicKey'] as string));
      expect(state.totalCoins).toHaveLength(fixture.expected['dustUtxoCount'] as number);

      // Type cast required because: JSON.parse is untyped; the raw snapshot shape is exactly what this test inspects
      type RawDustSnapshot = { publicKey: { publicKey: string }; networkId: string };
      const reserialized = JSON.parse(state.serialize()) as RawDustSnapshot;
      expect(reserialized.publicKey.publicKey).toBe(fixture.expected['publicKey']);
      expect(reserialized.networkId).toBe('undeployed');
    });
  });
});
