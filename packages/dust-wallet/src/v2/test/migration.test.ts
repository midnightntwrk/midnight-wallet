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

/**
 * How this variant builds its first state from whatever preceded it.
 *
 * @remarks
 *   The three strategies differ in exactly one thing — how much of the previous wallet is allowed to survive — so that is
 *   what these pin down: everything (same ledger version), nothing (no previous wallet at all), and, across a ledger
 *   version boundary, identity only.
 */

import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet, PublicKey } from '../CoreWallet.js';
import {
  type PreviousLedgerWallet,
  makeCarryOverMigration,
  makeCrossLedgerMigration,
  makeEmptyWalletMigration,
} from '../Migration.js';

const networkId = NetworkId.NetworkId.Undeployed;
const seed = Buffer.alloc(32, 7);
const secretKey = (): ledger.DustSecretKey => ledger.DustSecretKey.fromSeed(seed);
const dustParameters = (): ledger.DustParameters => ledger.LedgerParameters.initialParameters().dust;

/** The version that triggered the hand-over: the first one the previous variant saw outside its own range. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);

/**
 * A wallet of the previous ledger version, as plain data.
 *
 * @remarks
 *   Deliberately wider than {@link PreviousLedgerWallet}: it also carries the dust a real V1 wallet would be holding, so
 *   that "that does not cross" is something this file can actually observe rather than merely fail to mention. Its
 *   cursor is non-zero for the opposite reason — what does cross has to be seen crossing. Structural because the real
 *   thing is built on the other ledger's WASM module, and a projection that reads no ledger object out of it has no
 *   reason to load one.
 */
type PreviousWalletStandIn = PreviousLedgerWallet & {
  readonly utxos: readonly Readonly<{ nonce: string; initialValue: bigint }>[];
};

const previousWallet = (): PreviousWalletStandIn => ({
  publicKey: { publicKey: PublicKey.fromSecretKey(secretKey()).publicKey },
  networkId,
  protocolVersion: forkVersion,
  progress: {
    appliedIndex: 4321n,
    highestRelevantWalletIndex: 4400n,
    highestIndex: 4400n,
    highestRelevantIndex: 4400n,
    isConnected: true,
  },
  utxos: [
    { nonce: 'bb'.repeat(32), initialValue: 100n },
    { nonce: 'cc'.repeat(32), initialValue: 200n },
  ],
});

describe('the empty-wallet migration', () => {
  it('produces a wallet holding no dust on the configured network', async () => {
    const wallet = await Effect.runPromise(
      makeEmptyWalletMigration({ networkId, dustParameters: dustParameters() }).migrate(null),
    );

    expect(wallet.networkId).toBe(networkId);
    expect(wallet.state.utxos).toEqual([]);
    expect(wallet.pendingDust).toEqual([]);
    expect(wallet.progress.appliedIndex).toBe(0n);
    expect(wallet.protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
  });
});

describe('the carry-over migration', () => {
  it('hands the previous state through untouched', async () => {
    const previous = CoreWallet.initEmpty(dustParameters(), secretKey(), networkId);

    const wallet = await Effect.runPromise(makeCarryOverMigration().migrate(previous));

    expect(wallet).toBe(previous);
  });
});

describe('the cross-ledger migration', () => {
  const migration = () => makeCrossLedgerMigration({ dustParameters: dustParameters() });

  it('carries the dust public key, so the replayed timeline can be decrypted into the same dust', async () => {
    const previous = previousWallet();

    const wallet = await Effect.runPromise(migration().migrate(previous));

    expect(wallet.publicKey.publicKey).toBe(PublicKey.fromSecretKey(secretKey()).publicKey);
    expect(wallet.networkId).toBe(networkId);
  });

  it('records the version that triggered the hand-over, so the new variant starts inside its own range', async () => {
    const wallet = await Effect.runPromise(migration().migrate(previousWallet()));

    expect(wallet.protocolVersion).toBe(forkVersion);
  });

  it('starts from an empty local state rather than carrying the previous version dust', async () => {
    // The indexer replays the timeline after the v9 fork, so this dust is generated again by events of this ledger
    // version. Carrying it as well would double-count it, and it is backed by a Merkle tree of the other ledger's
    // making that this ledger cannot read.
    const previous = previousWallet();
    expect(previous.utxos.length).toBeGreaterThan(0);

    const wallet = await Effect.runPromise(migration().migrate(previous));

    expect(wallet.state.utxos).toEqual([]);
    expect(wallet.state.commitmentTreeFirstFree).toBe(0n);
    expect(wallet.state.generatingTreeFirstFree).toBe(0n);
    expect(wallet.pendingDust).toEqual([]);
  });

  it('builds the fresh state on this ledger version parameters, not the previous version', async () => {
    // Dust's local state is parameterised by the ledger's dust parameters, and those are a WASM object of whichever
    // ledger module produced them. The previous variant's copy therefore cannot cross; the migration is handed this
    // version's parameters instead. (No shielded analogue — `ZswapLocalState` takes no parameters.)
    const wallet = await Effect.runPromise(migration().migrate(previousWallet()));

    expect(wallet.state.params.nightDustRatio).toBe(dustParameters().nightDustRatio);
    expect(wallet.state.params.generationDecayRate).toBe(dustParameters().generationDecayRate);
    expect(wallet.state.params.dustGracePeriodSeconds).toBe(dustParameters().dustGracePeriodSeconds);
  });

  it('parks sync progress at the fork, because the replayed timeline continues the ids it left off at', async () => {
    // The confirmed semantics: after the hard fork the indexer replays the events again, numbering them onwards from
    // whatever id it had reached when the fork happened — never from zero. So the migrated wallet resumes from where
    // its predecessor stopped. Rewinding to zero would point it at a stretch of the timeline the replay does not
    // occupy, and it would sit there waiting for events that already went by under the previous ledger version.
    const previous = previousWallet();
    expect(previous.progress.appliedIndex).toBeGreaterThan(0n);

    const wallet = await Effect.runPromise(migration().migrate(previous));

    expect(wallet.progress.appliedIndex).toBe(previous.progress.appliedIndex);
    expect(wallet.progress.highestIndex).toBe(previous.progress.highestIndex);
    expect(wallet.progress.highestRelevantIndex).toBe(previous.progress.highestRelevantIndex);
    expect(wallet.progress.highestRelevantWalletIndex).toBe(previous.progress.highestRelevantWalletIndex);
    // The position crosses; being connected does not. This state has no running sync behind it yet — the restart that
    // follows the migration is what reconnects it — and claiming otherwise would report a gap that nothing is closing.
    expect(previous.progress.isConnected).toBe(true);
    expect(wallet.progress.isConnected).toBe(false);
  });
});
