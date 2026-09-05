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

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet, PublicKeys } from '../CoreWallet.js';
import {
  type PreviousLedgerWallet,
  makeCarryOverMigration,
  makeCrossLedgerMigration,
  makeEmptyWalletMigration,
} from '../Migration.js';

const networkId = NetworkId.NetworkId.Undeployed;
const seed = Buffer.alloc(32, 7);
const keys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(seed);

/** The version that triggered the hand-over: the first one the previous variant saw outside its own range. */
const forkVersion = ProtocolVersion.ProtocolVersion(7n);

/**
 * A wallet of the previous ledger version, as plain data.
 *
 * @remarks
 *   Deliberately wider than {@link PreviousLedgerWallet}: it also carries the coins a real V1 wallet would be holding, so
 *   that "those do not cross" is something this file can actually observe rather than merely fail to mention. Its
 *   cursor is non-zero for the opposite reason — what does cross has to be seen crossing. Structural because the real
 *   thing is built on the other ledger's WASM module, and a projection that reads no ledger object out of it has no
 *   reason to load one.
 */
type PreviousWalletStandIn = PreviousLedgerWallet & {
  readonly state: {
    readonly coins: readonly Readonly<{ type: string; nonce: string; value: bigint; mt_index: bigint }>[];
  };
};

const previousWallet = (): PreviousWalletStandIn => {
  const secretKeys = keys();
  return {
    publicKeys: {
      coinPublicKey: secretKeys.coinPublicKey,
      encryptionPublicKey: secretKeys.encryptionPublicKey,
    },
    networkId,
    protocolVersion: forkVersion,
    progress: {
      appliedIndex: 4321n,
      highestRelevantWalletIndex: 4400n,
      highestIndex: 4400n,
      highestRelevantIndex: 4400n,
      isConnected: true,
    },
    state: {
      coins: [
        { type: 'aa'.repeat(32), nonce: 'bb'.repeat(32), value: 100n, mt_index: 0n },
        { type: 'aa'.repeat(32), nonce: 'cc'.repeat(32), value: 200n, mt_index: 4n },
      ],
    },
  };
};

describe('the empty-wallet migration', () => {
  it('produces a wallet with no coins on the configured network', async () => {
    const wallet = await Effect.runPromise(makeEmptyWalletMigration({ networkId }).migrate(null));

    expect(wallet.networkId).toBe(networkId);
    expect([...wallet.state.coins]).toEqual([]);
    expect(wallet.coinHashes).toEqual({});
    expect(wallet.progress.appliedIndex).toBe(0n);
    expect(wallet.protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
  });
});

describe('the carry-over migration', () => {
  it('hands the previous state through untouched', async () => {
    const previous = CoreWallet.init(new ledger.ZswapLocalState(), keys(), networkId);

    const wallet = await Effect.runPromise(makeCarryOverMigration().migrate(previous));

    expect(wallet).toBe(previous);
  });
});

describe('the cross-ledger migration', () => {
  it('carries the public keys, so the same identity owns the wallet on the far side', async () => {
    const previous = previousWallet();

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

    expect(wallet.publicKeys).toEqual(PublicKeys.fromSecretKeys(keys()));
    expect(wallet.networkId).toBe(networkId);
  });

  it('records the version that triggered the hand-over, so the new variant starts inside its own range', async () => {
    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previousWallet()));

    expect(wallet.protocolVersion).toBe(forkVersion);
  });

  it('starts from an empty local state rather than carrying the previous version coins', async () => {
    // Shape parity, not a working crossing: this is the oldest registered variant, no ledger version below it exists,
    // so nothing ever migrates into here. The byte crossing lives in the v2 twin, which is where a real fork lands,
    // and is deliberately not mirrored into a seam no chain can reach.
    const previous = previousWallet();
    expect(previous.state.coins.length).toBeGreaterThan(0);

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

    expect([...wallet.state.coins]).toEqual([]);
    expect(wallet.state.firstFree).toBe(0n);
    expect(wallet.coinHashes).toEqual({});
  });

  it('parks sync progress at the fork, because event ids continue across it rather than restarting', async () => {
    // The confirmed semantics: a hard fork does not restart the timeline. The indexer numbers events onwards from
    // whatever id it had reached when the fork happened — never from zero — so a migrated wallet resumes from where
    // its predecessor stopped. Rewinding to zero would point it at a stretch of the timeline this ledger version's
    // events do not occupy, and it would sit there waiting for ones that already went by.
    const previous = previousWallet();
    expect(previous.progress.appliedIndex).toBeGreaterThan(0n);

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

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
