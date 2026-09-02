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
 * The facade's registration fail-fast, when the indexer's flag and the ledger disagree.
 *
 * @remarks
 *   `createDustActionTransaction` refuses to build a registration whose own fee exceeds the dust it may claim, because
 *   the node would answer such a transaction with `Malformed(BalanceCheckOverspend)` and the caller would have nothing
 *   to go on. Which registrations get that check is the question here.
 *
 *   The old answer read `meta.registeredForDustGeneration` — a creation-time value the indexer never revises. After the
 *   v8 -> v9 hard fork that value lies: the fork wipes dust generation state and the chain-side replay restores
 *   cNIGHT-backed generation only, so a native-NIGHT wallet's carried UTxOs all still say `true` while nothing they own
 *   generates a speck. Trusting the flag skipped the check, built a zero-fee registration, and let the node reject it.
 *
 *   These tests state the flag can no longer decide it. Rather than reproduce a fork here — which would prove the
 *   wallets, not the facade — they hand the facade UTxOs whose flag says `true` while the dust wallet holds nothing
 *   backing them, which is exactly the post-fork shape and exactly what the flag alone cannot tell apart.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, immediateBlockProducer, type GenesisMint } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState, type UtxoWithMeta } from '../src/index.js';
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

/**
 * The same UTxO, reported as the indexer reports one that was created while its address was registered.
 *
 * @remarks
 *   Nothing else about it changes, and nothing about the wallet's dust state changes: no dust coin backs it either way.
 *   That is the whole point — the flag is the only difference between this and a plainly unregistered UTxO, and the fee
 *   decision must not turn on it.
 */
const flaggedRegistered = (coin: UtxoWithMeta): UtxoWithMeta => ({
  utxo: coin.utxo,
  meta: { ...coin.meta, registeredForDustGeneration: true },
});

describe('Dust registration fail-fast follows the ledger, not the indexer flag', () => {
  it('fires for Night flagged as registered that no dust coin backs, and releases the booking', async () => {
    return Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);

      const simulator = yield* Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const factories = createSimulatorWalletFactories(config);
      const facade = yield* makeSimulatorFacade(config, keys, factories);

      // NOTE: deliberately no fastForward — generatedNow stays 0, so the claimable fee payment (0) < fee.
      yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
      const stateBefore: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
      );
      const nightUtxos = stateBefore.unshielded.availableCoins
        .filter((c) => c.utxo.type === NIGHT && c.meta.registeredForDustGeneration === false)
        .map(flaggedRegistered);
      expect(nightUtxos.length).toBeGreaterThan(0);
      const bookedKeys = new Set(nightUtxos.map(utxoKey));

      yield* Effect.promise(() =>
        expect(
          facade.registerNightUtxosForDustGeneration(
            nightUtxos,
            keys.signatureVerifyingKey,
            keys.unshieldedKeystore.signDataAsync,
          ),
        ).rejects.toThrow('Insufficient generated dust to cover registration fee'),
      );

      const stateAfter: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const stillAvailable = stateAfter.unshielded.availableCoins.filter((c) => bookedKeys.has(utxoKey(c)));
      expect(stillAvailable).toHaveLength(nightUtxos.length);
    }).pipe(Effect.scoped, Effect.runPromise);
  });

  it('does not fire once that same Night has accrued enough dust to cover the fee', async () => {
    return Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);

      const simulator = yield* Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const factories = createSimulatorWalletFactories(config);
      const facade = yield* makeSimulatorFacade(config, keys, factories);

      yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
      yield* simulator.fastForward(10_000n);

      const stateBefore: FacadeState = yield* Effect.promise(() =>
        rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
      );
      const nightUtxos = stateBefore.unshielded.availableCoins
        .filter((c) => c.utxo.type === NIGHT && c.meta.registeredForDustGeneration === false)
        .map(flaggedRegistered);
      expect(nightUtxos.length).toBeGreaterThan(0);

      const recipe = yield* Effect.promise(() =>
        facade.registerNightUtxosForDustGeneration(
          nightUtxos,
          keys.signatureVerifyingKey,
          keys.unshieldedKeystore.signDataAsync,
        ),
      );

      expect(recipe.type).toBe('UNPROVEN_TRANSACTION');
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
