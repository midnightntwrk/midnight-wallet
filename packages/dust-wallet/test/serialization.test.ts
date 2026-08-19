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
import { type DustLocalState } from '@midnight-ntwrk/ledger-v8';
import { DateOps, EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Array as Arr, pipe, Schema } from 'effect';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CoreWallet } from '../src/v1/CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../src/v1/Serialization.js';
import { makeFundedDustWallet, NETWORK } from './fundedWallet.js';

// The dust snapshot embeds `DustLocalState` as opaque ledger bytes, so a round trip over an empty wallet proves only
// that an empty state encodes. What has to hold for a wallet crossing an SDK upgrade is that a state holding earned
// Dust — generation entries, commitments, UTxOs — comes back with the same spendable content.

vi.setConfig({ testTimeout: 30_000 });

const capability = makeDefaultV1SerializationCapability();

/** Field-by-field, so the assertion names what it carries instead of leaning on reference equality. */
const utxosOf = (state: DustLocalState) =>
  pipe(
    Arr.fromIterable(state.utxos),
    Arr.sortBy((a, b) => (a.mtIndex < b.mtIndex ? -1 : a.mtIndex > b.mtIndex ? 1 : 0)),
    Arr.map((utxo) => ({
      initialValue: utxo.initialValue,
      owner: utxo.owner,
      nonce: utxo.nonce,
      seq: utxo.seq,
      ctime: utxo.ctime,
      backingNight: utxo.backingNight,
      mtIndex: utxo.mtIndex,
      // Generation info lives in a separate tree and is looked up by UTxO; without it a restored UTxO cannot be valued.
      generation: state.generationInfo(utxo),
    })),
  );

/** `JSON.parse` yields `any`; decoding through a schema keeps the assertions below typed without a cast. */
const fields = (value: unknown): Record<string, unknown> =>
  Schema.decodeUnknownSync(Schema.Record({ key: Schema.String, value: Schema.Unknown }))(value);

const restore = (wallet: CoreWallet): CoreWallet =>
  pipe(capability.deserialize(null, capability.serialize(wallet)), EitherOps.getOrThrowLeft);

describe('V1 dust wallet serialization over a funded wallet', () => {
  let funded: Awaited<ReturnType<typeof makeFundedDustWallet>>;

  beforeAll(async () => {
    funded = await makeFundedDustWallet('0000000000000000000000000000000000000000000000000000000000000001');
  });

  it('earns Dust before anything is asserted about carrying it', () => {
    // Guards the fixture itself: if registration stopped producing Dust, every assertion below would pass vacuously.
    expect(funded.wallet.state.utxos.length).toBeGreaterThan(0);
    expect(funded.wallet.state.generatingTreeRoot()).toBeDefined();
  });

  it('carries every Dust UTxO with its generation info', () => {
    const restored = restore(funded.wallet);

    expect(utxosOf(restored.state)).toEqual(utxosOf(funded.wallet.state));
    expect(restored.state.utxos).toHaveLength(funded.wallet.state.utxos.length);
  });

  it('carries both merkle tree roots', () => {
    const restored = restore(funded.wallet);

    expect(restored.state.generatingTreeRoot()).toBe(funded.wallet.state.generatingTreeRoot());
    expect(restored.state.commitmentTreeRoot()).toBe(funded.wallet.state.commitmentTreeRoot());
  });

  it('carries a spendable balance, valued the same at the same instant', () => {
    // Dust decays over time, so both sides are valued at one pinned instant derived from the state itself.
    const at = DateOps.addSeconds(funded.wallet.state.utxos[0].ctime, 3600);
    const restored = restore(funded.wallet);

    expect(restored.state.walletBalance(at)).toBe(funded.wallet.state.walletBalance(at));
    expect(restored.state.walletBalance(at)).toBeGreaterThan(0n);
  });

  it('carries the public key, protocol version, network and sync position', () => {
    const restored = restore(funded.wallet);

    expect(restored.publicKey.publicKey).toBe(funded.wallet.publicKey.publicKey);
    expect(restored.protocolVersion).toBe(funded.wallet.protocolVersion);
    expect(restored.networkId).toBe(NETWORK);
    expect(restored.progress.appliedIndex).toBe(funded.wallet.progress.appliedIndex);
  });

  it('re-serializes to the same snapshot', () => {
    const first = capability.serialize(funded.wallet);

    expect(capability.serialize(restore(funded.wallet))).toEqual(first);
  });

  describe('snapshot envelope', () => {
    // The envelope is a cross-release contract: a snapshot written by this SDK line has to be readable by the next one.
    // Pinning the key set makes a rename or a dropped field a failing test rather than a silent read of a default.
    it('pins the top-level field names', () => {
      const parsed: unknown = JSON.parse(capability.serialize(funded.wallet));
      const envelope = fields(parsed);

      expect(Object.keys(envelope).sort()).toEqual(
        ['networkId', 'offset', 'protocolVersion', 'publicKey', 'state'].sort(),
      );
      expect(Object.keys(fields(envelope['publicKey']))).toEqual(['publicKey']);
      // The state is opaque ledger bytes, hex-encoded — the shape the next SDK line has to keep decoding.
      expect(typeof envelope['state']).toBe('string');
    });
  });

  describe('pending Dust', () => {
    const spendOne = () => {
      const at = DateOps.addSeconds(funded.wallet.state.utxos[0].ctime, 3600);
      const [, spent] = CoreWallet.spendCoins(
        funded.wallet,
        funded.secretKey,
        [{ token: funded.wallet.state.utxos[0], value: 1_000n }],
        at,
      );
      return spent;
    };

    it('is recorded when Dust is spent', () => {
      // Asserted on its own so the round-trip case below cannot be satisfied by a fixture that stopped producing a
      // pending entry at all.
      expect(spendOne().pendingDust).toHaveLength(1);
    });

    // Marked as expected-to-fail: the snapshot has no slot for pending Dust, so a wallet that has spent Dust presents
    // it as available again after any restore. Left as a live marker rather than deleted or skipped — it flips to a
    // normal failure the moment the behaviour changes, which is the signal wanted here.
    //
    // Which way it should change is an open question, not a foregone fix. Simply carrying the entry across conflicts
    // with the known defect where pending state that survives serialisation can never be cleared and blocks sync
    // recovery. Whatever lands has to carry the entry *and* give it a way to expire, or state that dropping it is
    // deliberate — so this assertion records today's behaviour, and does not prescribe the remedy.
    it.fails('is carried across serialize then deserialize', () => {
      const spent = spendOne();

      expect(restore(spent).pendingDust).toEqual(spent.pendingDust);
    });
  });
});
