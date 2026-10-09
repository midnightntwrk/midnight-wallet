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
import * as rx from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForStableState } from '../state-waiters.js';

/** The shape the settling waiters are used on: a resting condition plus a value a caller reads off the result. */
type WalletLike = { readonly pendingCoins: readonly string[]; readonly balance: number };

const settled = (pendingCoins: readonly string[], balance: number): WalletLike => ({ pendingCoins, balance });

const SETTLE_MS = 10_000;
const TIMEOUT_MS = 60_000;

describe('waitForStableState', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const waitOn = (source: rx.Observable<WalletLike>): Promise<WalletLike> =>
    waitForStableState(source, (state) => state.pendingCoins.length === 0, 'test waiter', SETTLE_MS, TIMEOUT_MS);

  it('returns the newest matching value, not the one from when the condition began to hold', async () => {
    // The condition a settling waiter is given is also the wallet's resting state, and an incoming balance need not
    // disturb it — `pendingCoins` stays empty either side of the update. A waiter that answers with the value it
    // captured when the condition first held therefore hands back exactly the stale pre-transaction state it exists to
    // avoid, and callers of `waitForFinalizedShieldedBalance` assert balances straight off that result.
    const source = new rx.Subject<WalletLike>();
    const result = waitOn(source);

    source.next(settled([], 0));
    await vi.advanceTimersByTimeAsync(5_000);
    source.next(settled([], 10));
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toEqual(settled([], 10));
  });

  it('restarts the window when the condition stops holding', async () => {
    // Guards the other direction: taking the latest value must not become taking it regardless of the window. The
    // settle timer has to begin again from the moment the condition holds afresh.
    const source = new rx.Subject<WalletLike>();
    const result = waitOn(source);

    source.next(settled([], 0));
    await vi.advanceTimersByTimeAsync(9_000);
    source.next(settled(['pending'], 0));
    await vi.advanceTimersByTimeAsync(9_000);
    source.next(settled([], 42));
    // Only 5s since the condition held again — the original window would have elapsed long ago.
    await vi.advanceTimersByTimeAsync(5_000);
    const early = await Promise.race([result, Promise.resolve('still waiting' as const)]);
    expect(early).toBe('still waiting');

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual(settled([], 42));
  });

  it('settles on a wallet that never emits again after the condition holds', async () => {
    // The starvation case the predicate-side window exists for: the value carried through the pipeline is what the
    // waiter answers with, because the source must be subscribed only once and may replay nothing to a second reader.
    const source = new rx.Subject<WalletLike>();
    const result = waitOn(source);

    source.next(settled([], 7));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    await expect(result).resolves.toEqual(settled([], 7));
  });
});
