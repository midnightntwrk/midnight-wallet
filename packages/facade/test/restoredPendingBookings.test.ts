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
 * A booking is not persisted (ADR 0008), so after a restart nothing in wallet state says a coin is reserved. The
 * durable record of an in-flight spend is the transaction itself, held by the pending-transactions service, and the
 * facade re-reserves each restored transaction's inputs from it. Without that, coin selection would hand out a coin an
 * unconfirmed transaction is already spending.
 *
 * These tests reproduce a restart by starting a facade whose pending-transactions service already holds a transaction,
 * against wallets that have not yet seen the coins it spends.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { PendingTransactionsServiceImpl } from '@midnightntwrk/wallet-sdk-capabilities';
import { DateTime, Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { finalizedTransactionTrait } from '../src/transaction.js';
import { type WalletFacade } from '../src/index.js';
import {
  balanceNightTransfer,
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  setUpNightSimulator,
  tokenValue,
  waitForUnshieldedBalance,
  type WalletKeys,
} from './utils/index.js';

vi.setConfig({ testTimeout: 90_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const NIGHT = ledger.nativeToken().raw;
const SEED = '0000000000000000000000000000000000000000000000000000000000000002';

/** Proves a Night transfer back to this wallet, putting a transaction in flight and booking its inputs. */
const proveATransfer = (facade: WalletFacade, keys: WalletKeys) =>
  balanceNightTransfer(facade, keys).pipe(
    Effect.flatMap((recipe) => Effect.promise(() => facade.finalizeRecipe(recipe))),
  );

/** A pending-transactions service that already holds `tx`, as a restored one would. */
const serviceHolding = (tx: ledger.FinalizedTransaction) =>
  Effect.promise(() =>
    PendingTransactionsServiceImpl.init<ledger.FinalizedTransaction>({
      configuration: { indexerClientConnection: { indexerHttpUrl: 'http://unused' } },
      txTrait: finalizedTransactionTrait,
      initialState: { all: [{ tx, creationTime: DateTime.unsafeNow() }] },
    }),
  );

/** A pending-transactions service whose only item is already resolved as failed — nothing is in flight. */
const serviceHoldingFailed = (tx: ledger.FinalizedTransaction) =>
  Effect.promise(() =>
    PendingTransactionsServiceImpl.init<ledger.FinalizedTransaction>({
      configuration: { indexerClientConnection: { indexerHttpUrl: 'http://unused' } },
      txTrait: finalizedTransactionTrait,
      initialState: {
        all: [{ tx, creationTime: DateTime.unsafeNow(), result: { status: 'FAILURE', segments: [] } }],
      },
    }),
  );

const unshieldedCoinHashes = (facade: WalletFacade, pick: 'availableCoins' | 'pendingCoins') =>
  Effect.promise(async () => {
    const state = await rx.firstValueFrom(facade.state());
    return state.unshielded[pick].map(({ utxo }) => `${utxo.intentHash}#${utxo.outputNo}`);
  });

describe('Bookings restored from pending transactions', () => {
  it('books the inputs of a restored transaction once sync delivers the coins', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SEED, NETWORK_ID);
      const config = yield* setUpNightSimulator(keys, NETWORK_ID);

      // The first process: prove a transfer, so a transaction is in flight and its inputs are booked. It is never
      // submitted, so the simulator still holds those coins as unspent.
      const first = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));
      yield* waitForUnshieldedBalance(first, NIGHT, tokenValue(100_000n));
      const inFlight = yield* proveATransfer(first, keys);
      const bookedByFirst = yield* unshieldedCoinHashes(first, 'pendingCoins');
      expect(bookedByFirst.length).toBeGreaterThan(0);

      // The second process: fresh wallets that own nothing yet, and a pending set restored from the first. The coins
      // arrive by sync after init, which is the case a one-shot booking at init would miss.
      const restored = yield* makeSimulatorFacade(
        config,
        keys,
        createSimulatorWalletFactories(config),
        yield* serviceHolding(inFlight),
      );

      // Do not wait on an available balance here: the coins this wallet syncs are the ones the in-flight transaction
      // spends, so they are booked as they arrive and the available balance stays at zero. Wait on the booking itself.
      // Re-reservation follows the owned-coin set, so wait for the state that has it rather than reading once.
      const pendingAfterRestore = yield* Effect.promise(() =>
        rx.firstValueFrom(
          restored.state().pipe(
            rx.map((s) => s.unshielded.pendingCoins.map(({ utxo }) => `${utxo.intentHash}#${utxo.outputNo}`)),
            rx.filter((hashes) => hashes.length > 0),
            rx.timeout(30_000),
          ),
        ),
      );
      const availableAfterRestore = yield* unshieldedCoinHashes(restored, 'availableCoins');

      // Every coin the in-flight transaction spends is reserved again, and none of them is spendable.
      expect(pendingAfterRestore.sort()).toEqual(bookedByFirst.sort());
      expect(availableAfterRestore.filter((hash) => pendingAfterRestore.includes(hash))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('does not book the inputs of a transaction already resolved as failed', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SEED, NETWORK_ID);
      const config = yield* setUpNightSimulator(keys, NETWORK_ID);

      const first = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));
      yield* waitForUnshieldedBalance(first, NIGHT, tokenValue(100_000n));
      const inFlight = yield* proveATransfer(first, keys);

      // A restored pending set whose only transaction is already resolved as FAILURE. Nothing accounts for its inputs
      // any more, so nothing may be reserved for it: a booking taken here would have no release path left.
      const restored = yield* makeSimulatorFacade(
        config,
        keys,
        createSimulatorWalletFactories(config),
        yield* serviceHoldingFailed(inFlight),
      );

      // Coins arriving spendable is the success signal; coins arriving booked is the defect.
      const availableAfterRestore = yield* Effect.promise(() =>
        rx.firstValueFrom(
          restored.state().pipe(
            rx.map((s) => ({
              available: s.unshielded.availableCoins.length,
              pending: s.unshielded.pendingCoins.length,
            })),
            rx.filter(({ available, pending }) => available > 0 || pending > 0),
            rx.timeout(30_000),
          ),
        ),
      );

      expect(availableAfterRestore.pending).toEqual(0);
      expect(availableAfterRestore.available).toBeGreaterThan(0);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('leaves a fresh wallet with nothing booked', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SEED, NETWORK_ID);
      const config = yield* setUpNightSimulator(keys, NETWORK_ID);

      const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));
      yield* waitForUnshieldedBalance(facade, NIGHT, tokenValue(100_000n));

      expect(yield* unshieldedCoinHashes(facade, 'pendingCoins')).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
