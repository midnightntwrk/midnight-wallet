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
 *   version boundary, identity plus the coins flattened to plain data for the sync layer to re-anchor.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as EArray, Effect, Order, pipe } from 'effect';
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
 *   Structural because the real thing is built on the other ledger's WASM module, and a projection that reads only plain
 *   data out of it has no reason to load one — the test at the bottom of this file hands the real module's state in to
 *   show the description fits it. Its coins are listed out of Merkle order on purpose: the projection promises sorted
 *   output, so the input had better not be. Its cursor is non-zero because what crosses has to be seen crossing.
 */
const previousWallet = (): PreviousLedgerWallet => {
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
      coins: new Set([
        { type: 'aa'.repeat(32), nonce: 'cc'.repeat(32), value: 200n, mt_index: 4n },
        { type: 'aa'.repeat(32), nonce: 'bb'.repeat(32), value: 100n, mt_index: 0n },
      ]),
      firstFree: 6n,
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
  it('carries the public keys, so the same identity owns the carried coins on the far side', async () => {
    const previous = previousWallet();

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

    expect(wallet.publicKeys).toEqual(PublicKeys.fromSecretKeys(keys()));
    expect(wallet.networkId).toBe(networkId);
  });

  it('records the version that triggered the hand-over, so the new variant starts inside its own range', async () => {
    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previousWallet()));

    expect(wallet.protocolVersion).toBe(forkVersion);
  });

  it('starts from an empty local state — the carried coins wait beside the tree, not in it', async () => {
    // The migration has no secret keys, and rebuilding the Merkle tree takes them: coins are indexed by nullifier.
    // So the coins cross as plain data in the anchor payload, and the local state stays empty until the sync layer,
    // which does hold the keys, re-anchors it.
    const previous = previousWallet();
    expect(previous.state.coins.size).toBeGreaterThan(0);

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

    expect([...wallet.state.coins]).toEqual([]);
    expect(wallet.state.firstFree).toBe(0n);
    expect(wallet.coinHashes).toEqual({});
  });

  it('carries the coins as plain data sorted by Merkle index, and the size the pre-fork tree had reached', async () => {
    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previousWallet()));

    // Exactly the previous wallet's coins — `mt_index` renamed to `mtIndex` — in ascending Merkle order even though
    // the input listed them the other way around, under the tree size the gaps will be computed against.
    expect(wallet.pendingAnchor).toEqual({
      coins: [
        { type: 'aa'.repeat(32), nonce: 'bb'.repeat(32), value: 100n, mtIndex: 0n },
        { type: 'aa'.repeat(32), nonce: 'cc'.repeat(32), value: 200n, mtIndex: 4n },
      ],
      treeSize: 6n,
    });
  });

  it('projects a real pre-fork ledger state, which satisfies the previous-wallet shape as it is', async () => {
    // The structural type is a claim about the actual v8 module, so the actual v8 module is what checks it here:
    // this assignment compiling is the test that no adapter is needed between a real pre-fork wallet and the
    // migration. The offer pays this wallet twice around another party's coin, so the tree is larger than what the
    // wallet owns and the carried indices are the real, ledger-assigned ones.
    const mySeed = Buffer.alloc(32, 3);
    const myV8Keys = v8.ZswapSecretKeys.fromSeed(mySeed);
    const otherV8Keys = v8.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 4));
    const pay = (recipient: v8.ZswapSecretKeys, value: bigint): v8.ZswapOffer<v8.PreProof> => {
      const coin = v8.createShieldedCoinInfo(v8.shieldedToken().raw, value);
      const output = v8.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
      return v8.ZswapOffer.fromOutput(output, coin.type, coin.value);
    };
    const offer = [pay(myV8Keys, 100n), pay(otherV8Keys, 999n), pay(myV8Keys, 200n)].reduce((a, b) => a.merge(b));
    const v8State: v8.ZswapLocalState = new v8.ZswapLocalState().apply(myV8Keys, offer);

    const previous: PreviousLedgerWallet = {
      publicKeys: {
        coinPublicKey: myV8Keys.coinPublicKey,
        encryptionPublicKey: myV8Keys.encryptionPublicKey,
      },
      networkId,
      protocolVersion: forkVersion,
      progress: previousWallet().progress,
      state: v8State,
    };

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

    const ownedOnChain = pipe(
      [...v8State.coins],
      EArray.sort(Order.mapInput(Order.bigint, (coin: v8.QualifiedShieldedCoinInfo) => coin.mt_index)),
    );
    expect(new Set(ownedOnChain.map((coin) => coin.value))).toEqual(new Set([100n, 200n]));
    expect(v8State.firstFree).toBe(3n);
    expect(wallet.pendingAnchor).toEqual({
      coins: ownedOnChain.map((coin) => ({
        type: coin.type,
        nonce: coin.nonce,
        value: coin.value,
        mtIndex: coin.mt_index,
      })),
      treeSize: 3n,
    });
    expect([...wallet.state.coins]).toEqual([]);
  });

  it('parks sync progress at the fork, because event ids continue across it rather than restarting', async () => {
    // The confirmed semantics: a hard fork does not restart the timeline. The indexer numbers events onwards from
    // whatever id it had reached when the fork happened — never from zero — so the migrated wallet resumes from where
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
