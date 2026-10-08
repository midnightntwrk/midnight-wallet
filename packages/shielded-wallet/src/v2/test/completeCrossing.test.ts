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

// The first sync update after a crossing is where a byte-crossed wallet gets its coin hashes and sheds its pending
// marker. That step rebuilds the wallet, and everything the wallet carried has to come through it: in particular the
// transaction history a 1.0.0 snapshot embedded, which the migration and the deserializer both preserve and which would
// otherwise be lost at the first update after the crossing, silently, for good.
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { CoreWallet, PublicKeys } from '../CoreWallet.js';

const secretKeys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(7));
const progress = {
  appliedIndex: 0n,
  highestRelevantWalletIndex: 0n,
  highestIndex: 0n,
  highestRelevantIndex: 0n,
  isConnected: true,
};
const embedded = ['00aa', '00bb'];

const crossedWith = (legacyTxHistory: readonly string[] | undefined): CoreWallet =>
  CoreWallet.restoreWithPendingCoinHashes(
    PublicKeys.fromSecretKeys(secretKeys),
    new ledger.ZswapLocalState(),
    progress,
    2_000_000n,
    NetworkId.NetworkId.Undeployed,
    legacyTxHistory,
  );

describe('completing a crossing', () => {
  it('sheds the pending marker and keeps the embedded transaction history the wallet crossed with', () => {
    const completed = CoreWallet.completeCrossing(crossedWith(embedded), secretKeys);

    expect(completed.coinHashesPending).toBeUndefined();
    expect(completed.legacyTxHistory).toEqual(embedded);
  });

  it('resolves the coin hashes without dropping the embedded transaction history', () => {
    const resolved = CoreWallet.resolveCoinHashes(crossedWith(embedded), secretKeys);

    expect(resolved.coinHashesPending).toBeUndefined();
    expect(resolved.legacyTxHistory).toEqual(embedded);
  });

  it('does not invent a transaction history for a wallet that crossed without one', () => {
    const completed = CoreWallet.completeCrossing(crossedWith(undefined), secretKeys);

    expect('legacyTxHistory' in completed).toBe(false);
  });
});
