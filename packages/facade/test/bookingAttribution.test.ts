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
 * Which transaction booked a coin, and does that transaction still exist?
 *
 * `pendingCoins` shows the booked coins; `bookings` adds when each was booked and when it expires. Neither says which
 * transaction holds the booking. The facade can: the transaction that booked a coin is the in-flight transaction that
 * spends it, and the facade owns the in-flight set. A booking with no such transaction is unaccounted for -- either the
 * caller has not yet proved it, or the caller abandoned it.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, Option } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  balanceNightTransfer,
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  setUpNightSimulator,
  tokenValue,
  waitForUnshieldedBalance,
} from './utils/index.js';

vi.setConfig({ testTimeout: 60_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const NIGHT = ledger.nativeToken().raw;
const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const setUp = () =>
  Effect.gen(function* () {
    const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
    const config = yield* setUpNightSimulator(keys, NETWORK_ID);
    const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));
    yield* waitForUnshieldedBalance(facade, NIGHT, tokenValue(100_000n));
    return { facade, keys };
  });

describe('Booking attribution', () => {
  it('reports a booking with no in-flight transaction as unaccounted for', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* setUp();

      // Balanced but never proved: nothing is in flight for this booking.
      yield* balanceNightTransfer(facade, keys);
      const state = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));

      expect(state.unshieldedBookings.length).toBeGreaterThan(0);
      expect(state.unshieldedBookings.every((b) => Option.isNone(b.transaction))).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('reports the in-flight transaction that spends the booked coin', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* setUp();

      const recipe = yield* balanceNightTransfer(facade, keys);
      // Finalizing (proving) is what puts the transaction in flight; submission is not required for that.
      const finalized = yield* Effect.promise(() => facade.finalizeRecipe(recipe));
      const state = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));

      expect(state.unshieldedBookings.length).toBeGreaterThan(0);
      expect(
        state.unshieldedBookings.every(
          (b) =>
            Option.isSome(b.transaction) &&
            JSON.stringify(b.transaction.value.identifiers()) === JSON.stringify(finalized.identifiers()),
        ),
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.runPromise));
});
