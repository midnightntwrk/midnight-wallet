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
 * A transfer the caller builds and then abandons — never proves, submits or reverts — leaves its shielded coins booked.
 * The shielded wallet expires that booking itself, against the chain's time, so the coins come back without anything
 * the caller or the facade has to do.
 *
 * The wallet counts a booking's lifetime from the first sync update that sees it, so the chain's clock is moved past a
 * lifetime twice: once for the wallet to see the booking, and once for the lifetime to pass.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, immediateBlockProducer } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState } from '../src/index.js';
import {
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  tokenValue,
  waitForShieldedCoins,
  type SimulatorConfig,
} from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const SHIELDED = ledger.shieldedToken().raw;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/** The ledger's default `global_ttl`, plus a second: past it, no shielded spend built before can still be included. */
const PAST_A_LIFETIME = 60n * 60n + 1n;

describe('A shielded transfer the caller abandons', () => {
  it('should have its coins become spendable again once the chain has moved past their lifetime', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SEED, NETWORK_ID);
      const simulator = yield* Simulator.init({
        genesisMints: [
          { type: 'shielded', tokenType: SHIELDED, amount: tokenValue(1_000n), recipient: keys.shieldedKeys },
        ],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));

      yield* waitForShieldedCoins(facade);
      const before: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const coins = before.shielded.availableCoins.map((c) => c.coin.nonce);
      const receiverAddress = yield* Effect.promise(() => facade.shielded.getAddress());

      yield* Effect.promise(() =>
        facade.transferTransaction(
          [{ type: 'shielded', outputs: [{ type: SHIELDED, receiverAddress, amount: tokenValue(1n) }] }],
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );
      const booked: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      expect(booked.shielded.availableCoins).toEqual([]);

      yield* simulator.fastForward(PAST_A_LIFETIME);
      yield* simulator.fastForward(PAST_A_LIFETIME);

      const released: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(
          facade.state().pipe(
            rx.filter((s) => s.shielded.availableCoins.length > 0),
            rx.timeout({ first: 5_000 }),
          ),
        ),
      );
      expect(released.shielded.availableCoins.map((c) => c.coin.nonce)).toEqual(coins);
    }).pipe(Effect.scoped, Effect.runPromise));
});
