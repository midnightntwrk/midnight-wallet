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
// What a dust snapshot carries when the wallet that wrote it is not empty.
//
// The round trip next door is `serialize -> deserialize -> serialize` over an **empty** wallet, comparing snapshot
// bytes with snapshot bytes. Two things escape that shape: a field the snapshot never writes at all, since neither
// side has it, and a change applied to both the writer and the reader, since both sides move together. It is also
// silent about value, because an empty wallet has none.
//
// These assert the restored wallet's own values instead, over a wallet that has earned real Dust from a real chain —
// so what is being checked is that the money, the trees it lives in, and the position the wallet had reached all
// survive a restart.
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { pipe } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
import { DUST_EVENT_COUNT, buildDustChain, eventAt, fixtureSecretKey, freshWallet } from './dustEvents.js';

/** The wallet under test, and the instant its dust is valued at. Both fixed for the whole file. */
let funded: CoreWallet;
let restored: CoreWallet;
let at: Date;

const capability = makeDefaultV2SerializationCapability();

const roundTrip = (wallet: CoreWallet): CoreWallet =>
  pipe(capability.deserialize(null, capability.serialize(wallet)), EitherOps.getOrThrowLeft);

beforeAll(async () => {
  // A real chain, not a hand-built state: every registration block carries one `dustInitialUtxo` event, so the
  // generation info under each UTXO is the ledger's own rather than something this file invented.
  const chain = await buildDustChain();
  const secretKey = fixtureSecretKey();
  const events = chain.eventBytes.map((_, index) => eventAt(chain.eventBytes, index));
  const [applied] = CoreWallet.applyEventsWithChanges(freshWallet(), secretKey, events, chain.syncTime);
  // Advanced deliberately, and to a value nothing else in this file could produce: a wallet left at the default would
  // make the sync-position assertion below unable to tell a carried cursor from a dropped one.
  funded = CoreWallet.updateProgress(applied, { appliedIndex: 41n, highestIndex: 57n });
  at = chain.syncTime;
  restored = roundTrip(funded);
});

describe('a V2 dust snapshot written by a wallet that holds Dust', () => {
  it('is written by a wallet that actually holds some, so nothing below can pass vacuously', () => {
    expect(funded.state.utxos.length).toBe(DUST_EVENT_COUNT);
    expect(funded.state.walletBalance(at)).toBeGreaterThan(0n);
  });

  it('carries every Dust UTxO with the generation info underneath it', () => {
    // Field by field rather than by count: a snapshot that wrote the right number of UTXOs with the wrong backing
    // Night, initial value or creation time would still be the wrong wallet.
    const shape = (wallet: CoreWallet) =>
      wallet.state.utxos.map((utxo) => ({
        nonce: utxo.nonce,
        initialValue: utxo.initialValue,
        ctime: utxo.ctime,
        backingNight: utxo.backingNight,
      }));

    expect(shape(restored)).toEqual(shape(funded));
  });

  it('carries both merkle tree roots, which is what says it is the same tree', () => {
    // The roots are the whole-tree claim. Equal UTXOs with a different root would mean the wallet had been rebuilt
    // rather than restored, and its proofs would not verify against the chain.
    expect(restored.state.commitmentTreeRoot()).toEqual(funded.state.commitmentTreeRoot());
    expect(restored.state.generatingTreeRoot()).toEqual(funded.state.generatingTreeRoot());
    expect(restored.state.commitmentTreeFirstFree).toBe(funded.state.commitmentTreeFirstFree);
    expect(restored.state.generatingTreeFirstFree).toBe(funded.state.generatingTreeFirstFree);
  });

  it('carries a balance that values the same at the same instant', () => {
    // Dust decays, so a balance is only comparable against a fixed instant. Valued at two different times these would
    // differ for reasons that have nothing to do with serialization.
    expect(restored.state.walletBalance(at)).toBe(funded.state.walletBalance(at));
  });

  it('carries the identity, the network, the protocol version and the sync position', () => {
    expect(restored.publicKey).toEqual(funded.publicKey);
    expect(restored.networkId).toBe(NetworkId.NetworkId.Undeployed);
    expect(restored.protocolVersion).toBe(funded.protocolVersion);
    // Asserted against the literal, not against `funded`, so the case still fails if both sides collapse to a default.
    expect(restored.progress.appliedIndex).toBe(41n);
  });
});

describe('the Dust a wallet has spent but not yet seen confirmed', () => {
  it('is recorded on the wallet when Dust is spent', () => {
    const [, spent] = CoreWallet.spendCoins(
      funded,
      fixtureSecretKey(),
      [{ token: funded.state.utxos[0], value: 1n }],
      at,
    );

    expect(spent.pendingDust.length).toBe(1);
  });

  // EXPECTED RED, and deliberately not skipped: `pendingDust` is absent from the snapshot schema, and the restore path
  // hands `CoreWallet.restore` an empty array outright. So a wallet that has spent Dust presents that Dust as
  // available again after any restart, which is a wallet believing it can spend what it has already spent.
  //
  // Left failing rather than fixed on purpose. Simply carrying the entry conflicts with the sync-recovery problem of
  // pending state that survives serialization and can never be cleared, so whatever lands has to carry the entry AND
  // give it a way to expire — or record that dropping it is deliberate. That is a scope decision, not a test decision.
  it.fails('is carried across serialize then deserialize', () => {
    const [, spent] = CoreWallet.spendCoins(
      funded,
      fixtureSecretKey(),
      [{ token: funded.state.utxos[0], value: 1n }],
      at,
    );

    expect(roundTrip(spent).pendingDust.length).toBe(spent.pendingDust.length);
  });
});
