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
 * Revert-on-failure tests for the facade's dust registration flow (issue #302 / PR #416).
 *
 * The race fix books Night UTxOs at _build time_ via `unshielded.rotateUtxos`. The facade's
 * `createDustActionTransaction` therefore wraps every subsequent step in a try/catch that calls
 * `unshielded.revertTransaction` to release the booking when a later step fails — otherwise a build-time failure would
 * leave the UTxOs permanently stuck in `pending`.
 *
 * These tests exercise that contract end-to-end against the in-memory Simulator (no Docker), driving two _natural_
 * failure points (no mocking of the wallet collaborators):
 *
 * - Step 4: insufficient generated dust to cover the registration's own fee (no time elapsed).
 * - Step 5: the caller-supplied signing callback throws.
 *
 * In both cases the booked Night UTxOs must return to `availableCoins`.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  Simulator,
  immediateBlockProducer,
  type GenesisMint,
} from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState } from '../src/index.js';
import {
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  tokenValue,
  waitForUnshieldedBalance,
  type SimulatorConfig,
} from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 }); // Fast tests - no real proving or network

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const NIGHT = ledger.nativeToken().raw;
const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const utxoKey = (coin: { utxo: { intentHash: string; outputNo: number } }): string =>
  `${coin.utxo.intentHash}#${coin.utxo.outputNo}`;

const nightGenesisMint = (
  verifyingKey: ledger.SignatureVerifyingKey,
  userAddress: ledger.UserAddress,
): GenesisMint => ({
  type: 'unshielded',
  tokenType: NIGHT,
  amount: tokenValue(100_000n),
  recipient: userAddress,
  verifyingKey,
});

describe('Dust registration revert-on-failure', () => {
  it('releases the booked Night UTxOs when the registration fee exceeds the generated dust (Step 4)', async () => {
    return Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);

      const simulator = yield* Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const factories = createSimulatorWalletFactories(config);
      const facade = yield* makeSimulatorFacade(config, keys, factories);

      // NOTE: deliberately no fastForward — generatedNow stays 0, so feePayment (0) < fee.
      yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
      const stateBefore: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
      );
      const nightUtxos = stateBefore.unshielded.availableCoins.filter(
        (c) => c.utxo.type === NIGHT && c.meta.registeredForDustGeneration === false,
      );
      expect(nightUtxos.length).toBeGreaterThan(0);
      const bookedKeys = new Set(nightUtxos.map(utxoKey));

      // Build-time failure: not enough generated dust to pay the registration fee.
      yield* Effect.promise(() =>
        expect(
          facade.registerNightUtxosForDustGeneration(nightUtxos, keys.signatureVerifyingKey, (payload) =>
            keys.unshieldedKeystore.signData(payload),
          ),
        ).rejects.toThrow(),
      );

      // Revert contract: every booked UTxO is back in availableCoins (none stuck in pending).
      const stateAfter: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const stillAvailable = stateAfter.unshielded.availableCoins.filter((c) => bookedKeys.has(utxoKey(c)));
      expect(stillAvailable).toHaveLength(nightUtxos.length);
    }).pipe(Effect.scoped, Effect.runPromise);
  });

  it('releases the booked Night UTxOs when the signing callback throws (Step 5)', async () => {
    return Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);

      const simulator = yield* Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const factories = createSimulatorWalletFactories(config);
      const facade = yield* makeSimulatorFacade(config, keys, factories);

      // Fast-forward so the would-be generated dust covers the registration fee and we get past Step 4
      // to the signing step.
      yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
      yield* simulator.fastForward(10_000n);

      const stateBefore: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
      );
      const nightUtxos = stateBefore.unshielded.availableCoins.filter(
        (c) => c.utxo.type === NIGHT && c.meta.registeredForDustGeneration === false,
      );
      expect(nightUtxos.length).toBeGreaterThan(0);
      const bookedKeys = new Set(nightUtxos.map(utxoKey));

      // Build-time failure: the caller's signer rejects. Signing happens after booking.
      yield* Effect.promise(() =>
        expect(
          facade.registerNightUtxosForDustGeneration(nightUtxos, keys.signatureVerifyingKey, () => {
            throw new Error('signing failed');
          }),
        ).rejects.toThrow('signing failed'),
      );

      // Revert contract: the booking is released even though we failed at the signing step.
      const stateAfter: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const stillAvailable = stateAfter.unshielded.availableCoins.filter((c) => bookedKeys.has(utxoKey(c)));
      expect(stillAvailable).toHaveLength(nightUtxos.length);
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
