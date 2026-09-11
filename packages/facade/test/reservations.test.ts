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
 * Balancing reserves coins, and nothing else records that they are spoken for until the transaction is submitted. The
 * facade closes that window by registering a reservation as soon as it books, and dropping it once the transaction
 * itself is being tracked.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, immediateBlockProducer, type GenesisMint } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState } from '../src/index.js';
import type { ProvingService, UnboundTransaction } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import {
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  tokenValue,
  waitForUnshieldedBalance,
  type SimulatorConfig,
} from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 });

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

describe('Reservations taken while balancing', () => {
  const fundedFacade = () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const simulator = yield* Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));

      yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
      yield* simulator.fastForward(10_000n);
      const address = yield* Effect.promise(() => facade.unshielded.getAddress());

      /** Pays back to this wallet's own address: the point here is the booking, not where the coins land. */
      const transfer = (amount: bigint) => [
        {
          type: 'unshielded' as const,
          outputs: [{ type: NIGHT, receiverAddress: address, amount }],
        },
      ];

      return { facade, keys, simulator, transfer };
    });

  it('records the coins a balanced transfer booked, so nothing else has to remember them', () =>
    Effect.gen(function* () {
      const { facade, keys, transfer } = yield* fundedFacade();

      const before: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const availableBefore = new Set(before.unshielded.availableCoins.map(utxoKey));

      yield* Effect.promise(() =>
        facade.transferTransaction(
          transfer(tokenValue(1n)),
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );

      const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const booked = before.unshielded.availableCoins
        .map(utxoKey)
        .filter((id) => !after.unshielded.availableCoins.map(utxoKey).includes(id));

      expect(booked.length).toBeGreaterThan(0);
      expect(availableBefore.size).toBeGreaterThan(0);

      // Every coin that left the available side is named by a reservation.
      const reserved = new Set(after.pending.reservations.flatMap((r) => r.inputs.unshielded));
      expect(booked.filter((id) => !reserved.has(id))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('gives the reservation an expiry matching the transaction it was taken for', () =>
    Effect.gen(function* () {
      const { facade, keys, transfer } = yield* fundedFacade();
      const ttl = new Date(Date.now() + 60 * 60 * 1000);

      yield* Effect.promise(() =>
        facade.transferTransaction(
          transfer(tokenValue(1n)),
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl, payFees: false },
        ),
      );

      const state: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));

      expect(state.pending.reservations).toHaveLength(1);
      // The ledger truncates an intent's TTL to whole seconds, so compare at that resolution.
      expect(Math.floor(state.pending.reservations[0].ttl.getTime() / 1000)).toEqual(Math.floor(ttl.getTime() / 1000));
      expect(state.pending.reservations[0].expired).toBe(false);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('drops the reservation once the transaction itself is being tracked', () =>
    // From submission onwards the transaction carries its own expiry and its own release paths, so a second record
    // of the same spend would only be another thing to keep in step.
    Effect.gen(function* () {
      const { facade, keys, transfer } = yield* fundedFacade();

      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(
          transfer(tokenValue(1n)),
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );

      const reservedWhileBalancing: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      expect(reservedWhileBalancing.pending.reservations).toHaveLength(1);

      // Tracking begins when the finalized transaction is registered, which is what makes the reservation redundant.
      yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      const afterFinalizing: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      expect(afterFinalizing.pending.reservations).toEqual([]);
      expect(afterFinalizing.pending.all).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('keeps a transaction identifiable across proving, which is what ties a reservation to it', () =>
    // The reservation is matched to the transaction by identifier, so proving must not change them.
    Effect.gen(function* () {
      const { facade, keys, transfer } = yield* fundedFacade();

      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(
          transfer(tokenValue(1n)),
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );
      const beforeProving = [...recipe.transaction.identifiers()].toSorted();

      const finalized = yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      expect([...finalized.identifiers()].toSorted()).toEqual(beforeProving);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('A balanced transaction that never gets proven', () => {
  // Proving is the first thing after balancing that can fail, and the caller is handed the error with the coins
  // already booked. The booking is undone there, and the record standing for it has to go with it: a record left
  // behind outlives the coins it named, and the next thing to read it is told a spend is still out there.
  const failingProver: ProvingService<UnboundTransaction> = {
    prove: () => Promise.reject(new Error('the proof server is on a different ledger version')),
  };

  it('leaves neither a booking nor the record that stood for it', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const simulator = yield* Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config), {
        provingService: () => failingProver,
      });

      yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
      yield* simulator.fastForward(10_000n);
      const address = yield* Effect.promise(() => facade.unshielded.getAddress());

      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(
          [
            {
              type: 'unshielded' as const,
              outputs: [{ type: NIGHT, receiverAddress: address, amount: tokenValue(1n) }],
            },
          ],
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );

      const booked: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      expect(booked.pending.reservations).toHaveLength(1);

      const outcome = yield* Effect.either(Effect.tryPromise(() => facade.finalizeRecipe(recipe)));
      expect(outcome._tag).toEqual('Left');

      const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));

      expect(after.pending.reservations).toEqual([]);
      expect(after.unshielded.pendingCoins).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('Balancing a transaction the caller already put its own coins into', () => {
  // In-place balancing hands back the caller's transaction with the wallet's inputs added, so the transaction names
  // coins from two sources. A reservation covers the wallet's booking, and only the coins the wallet moved out of the
  // available side are that. Naming the caller's as well would have the record hold coins it never took.
  it('records only the coins the wallet itself booked', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const simulator = yield* Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));

      yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
      yield* simulator.fastForward(10_000n);
      const address = yield* Effect.promise(() => facade.unshielded.getAddress());
      const ttl = new Date(Date.now() + 60 * 60 * 1000);

      // A transaction that already spends this wallet's coins, with the booking it was built with given back, so the
      // coins it names are available again — the state a caller's own transaction arrives in.
      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(
          [
            {
              type: 'unshielded' as const,
              outputs: [{ type: NIGHT, receiverAddress: address, amount: tokenValue(1n) }],
            },
          ],
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl, payFees: false },
        ),
      );
      yield* Effect.promise(() => facade.revert(recipe));

      const beforeBalancing: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      expect(beforeBalancing.pending.reservations).toEqual([]);
      const pendingBefore = new Set(beforeBalancing.unshielded.pendingCoins.map(utxoKey));

      yield* Effect.promise(() =>
        facade.balanceUnprovenTransaction(
          recipe.transaction,
          {
            shieldedSecretKeys: keys.shieldedKeys,
            dustSecretKey: keys.dustKey,
          },
          { ttl, tokenKindsToBalance: ['unshielded'] },
        ),
      );

      const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const newlyBooked = after.unshielded.pendingCoins.map(utxoKey).filter((id) => !pendingBefore.has(id));
      const recorded = after.pending.reservations.flatMap((r) => r.inputs.unshielded);

      expect(recorded.toSorted()).toEqual(newlyBooked.toSorted());
    }).pipe(Effect.scoped, Effect.runPromise));
});
