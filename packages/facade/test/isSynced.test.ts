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
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities';
import { type DustWalletState } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { type ShieldedWalletState } from '@midnightntwrk/wallet-sdk-shielded';
import { type UnshieldedWalletState } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { describe, expect, it } from 'vitest';
import { FacadeState } from '../src/index.js';

/**
 * A wallet state reduced to the one answer `isSynced` reads from it.
 *
 * @remarks
 *   What makes each wallet complete is that wallet's own business and is tested there — the unshielded wallet's
 *   `isStrictlyComplete()` refusing while the indexer is `Behind`, on a different chain, or not yet checked, among it.
 *   What belongs to the facade is only that it asks all three.
 */
const progressing = (complete: boolean) => ({ progress: { isStrictlyComplete: () => complete } });

const facadeState = (complete: { shielded: boolean; unshielded: boolean; dust: boolean }): FacadeState =>
  new FacadeState(
    // Type casts required because: `isSynced` reads nothing else from these states, and a real one needs a running
    // wallet and the ledger WASM runtime.
    { state: progressing(complete.shielded) } as unknown as ShieldedWalletState,
    progressing(complete.unshielded) as unknown as UnshieldedWalletState,
    { state: progressing(complete.dust) } as unknown as DustWalletState,
    PendingTransactions.empty(),
  );

describe('FacadeState.isSynced', () => {
  it('should be false while the unshielded wallet is held back, even with the other two synced', () => {
    // The case the indexer liveness check exists for: shielded and Dust are caught up, and the unshielded wallet has
    // applied everything its indexer reported, but that indexer trails the chain. An application reading `isSynced`
    // before showing a balance must not get `true` over that stale view.
    expect(facadeState({ shielded: true, unshielded: false, dust: true }).isSynced).toBe(false);
  });

  it.each([
    ['shielded', { shielded: false, unshielded: true, dust: true }],
    ['Dust', { shielded: true, unshielded: true, dust: false }],
  ])('should be false while the %s wallet is not synced', (_wallet, complete) => {
    expect(facadeState(complete).isSynced).toBe(false);
  });

  it('should be true once all three wallets are synced', () => {
    // The control: without it, an `isSynced` that always answered `false` would pass every test above.
    expect(facadeState({ shielded: true, unshielded: true, dust: true }).isSynced).toBe(true);
  });
});
