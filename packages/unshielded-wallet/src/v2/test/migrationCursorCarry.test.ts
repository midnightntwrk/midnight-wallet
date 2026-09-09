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
// What the cross-ledger migration does with the rest of the cursor.
//
// `SyncProgressData` holds three fields, and the existing migration tests assert one of them. `appliedId` is covered;
// `highestTransactionId` and `isConnected` are not, and the fixture in `migration.test.ts` sets `highestTransactionId`
// equal to `appliedId`, so a migration that derived the tip from the applied position — or dropped it and let
// `createSyncProgress` default it to zero — would pass every test there and still be wrong.
//
// The pair matters because it is what `SyncProgress.isCompleteWithin` reads. A wallet whose tip collapsed onto its
// applied position at the boundary would report a source gap of zero, and so report itself caught up, at precisely the
// moment it has the most left to do: the whole replay after the v9 fork.
//
// `highestTransactionId` is also known NOT to survive `serialize` -> `restore`; it is absent from the snapshot and
// rebuilt as `appliedId`. Pinning it here records that the two carry routes genuinely differ, rather than leaving it
// to be discovered as a contradiction later.
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeCrossLedgerMigration, type PreviousLedgerWallet } from '../Migration.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { fixtureOwner, fixtureUtxo } from './syncFixtures.js';

const owner = fixtureOwner();

/**
 * A previous-ledger wallet whose two progress indices are deliberately different.
 *
 * @remarks
 *   Distinct values are the whole point: a fixture that set them equal — as the existing one does — cannot tell a carried
 *   field from one derived off `appliedId`.
 */
const previousWallet = (params: {
  readonly appliedId: bigint;
  readonly highestTransactionId: bigint;
  readonly isConnected?: boolean;
}): PreviousLedgerWallet => ({
  state: UnshieldedState.restore([fixtureUtxo(owner, 100n, 0)], []),
  publicKey: {
    publicKey: owner.publicKey.value,
    addressHex: owner.addressHex,
    address: owner.address,
  },
  networkId: NetworkId.NetworkId.Undeployed,
  protocolVersion: 7n,
  progress: {
    appliedId: params.appliedId,
    highestTransactionId: params.highestTransactionId,
    isConnected: params.isConnected ?? true,
  },
});

describe('the cursor a cross-ledger migration hands over', () => {
  it('carries the source tip as well as the applied position', async () => {
    const previous = previousWallet({ appliedId: 42n, highestTransactionId: 99n });

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

    expect(wallet.progress.appliedId).toBe(42n);
    // The assertion the existing cursor test cannot make: 99, not 42, and not zero.
    expect(wallet.progress.highestTransactionId).toBe(99n);
  });

  it('carries a tip equal to the applied position without inflating it', async () => {
    // The converse of the case above, so neither can pass by a migration that simply hard-coded a large tip.
    const previous = previousWallet({ appliedId: 42n, highestTransactionId: 42n });

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

    expect(wallet.progress.highestTransactionId).toBe(42n);
    expect(wallet.progress.appliedId).toBe(42n);
  });

  it('reports itself disconnected, whatever the previous variant was doing', async () => {
    // Deliberate, and structural rather than incidental: `CoreWallet.restore` takes
    // `Omit<SyncProgressData, 'isConnected'>`, so connectivity cannot cross even by accident. It is a property of the
    // live subscription, and at the hand-over there is not one — the new variant's sync has yet to be restarted. A
    // migrated wallet claiming connectivity it does not have would be indistinguishable from a healthy one.
    const previous = previousWallet({ appliedId: 42n, highestTransactionId: 42n, isConnected: true });

    const wallet = await Effect.runPromise(makeCrossLedgerMigration().migrate(previous));

    expect(wallet.progress.isConnected).toBe(false);
    // And so the wallet does not answer "synced" at the boundary, even with no gap to close. Whether it should is a
    // question for the runtime that restarts sync, not for the migration; this pins today's answer.
    expect(wallet.progress.isCompleteWithin()).toBe(false);
  });
});
