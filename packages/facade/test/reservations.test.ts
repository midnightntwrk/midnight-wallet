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
 * facade closes that window by leaving a lifecycle record as soon as it books, and moving that same record on as the
 * transaction is finalized.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  NetworkId,
  NoOpTransactionHistoryStorage,
  ProtocolVersion,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { CustomUnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  Sync as UnshieldedSync,
  V2Builder as UnshieldedV2Builder,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { Lifecycle } from '@midnightntwrk/wallet-sdk-capabilities/transactionLifecycle';
import { V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, Either } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState, type WalletEntry, type WalletFacade } from '../src/index.js';
import {
  createSimulatorWalletFactories,
  deriveWalletKeys,
  lifecycleOf,
  liveRecordsOf,
  makeSimulatorFacade,
  DrivenLifecycle,
  tokenValue,
  type AnyVersionProvingService,
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
): V9.GenesisMint => ({
  type: 'unshielded',
  tokenType: NIGHT,
  amount: tokenValue(100_000n),
  recipient: userAddress,
  verifyingKey,
});

/**
 * Opens the transaction a handle carries. The simulator facade runs ledger-v9 from the bottom of the version range, so
 * the epoch a handle belongs to is read against that boundary.
 */
const carried = <T>(handle: AnyTx): T =>
  Either.getOrThrow(
    WalletTransaction.unwrapWithin<T>(
      handle,
      ProtocolVersion.epochOf(handle.protocolVersion, ProtocolVersion.MinSupportedVersion),
    ),
  );

describe('Reservations taken while balancing', () => {
  const fundedFacade = () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const simulator = yield* V9.Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: V9.immediateBlockProducer(),
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
      const { facade, transfer } = yield* fundedFacade();

      const before: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const availableBefore = new Set(before.unshielded.availableCoins.map(utxoKey));

      yield* Effect.promise(() =>
        facade.transferTransaction(transfer(tokenValue(1n)), {
          ttl: new Date(Date.now() + 60 * 60 * 1000),
          payFees: false,
        }),
      );

      const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const booked = before.unshielded.availableCoins
        .map(utxoKey)
        .filter((id) => !after.unshielded.availableCoins.map(utxoKey).includes(id));

      expect(booked.length).toBeGreaterThan(0);
      expect(availableBefore.size).toBeGreaterThan(0);

      // Every coin that left the available side is named by a live record.
      const reserved = new Set(Lifecycle.coveredUnshieldedIds(yield* lifecycleOf(facade)));
      expect(booked.filter((id) => !reserved.has(id))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('gives the record an expiry matching the transaction it was taken for', () =>
    Effect.gen(function* () {
      const { facade, transfer } = yield* fundedFacade();
      const ttl = new Date(Date.now() + 60 * 60 * 1000);

      yield* Effect.promise(() => facade.transferTransaction(transfer(tokenValue(1n)), { ttl, payFees: false }));

      const { records } = yield* lifecycleOf(facade);

      expect(records).toHaveLength(1);
      // The ledger truncates an intent's TTL to whole seconds, so compare at that resolution.
      expect(Math.floor(records[0].ttl.getTime() / 1000)).toEqual(Math.floor(ttl.getTime() / 1000));
      expect(records[0].state).toStrictEqual({ _tag: 'Balanced' });
    }).pipe(Effect.scoped, Effect.runPromise));

  it('moves the same record on once the transaction is finalized, rather than keeping a second one', () =>
    // A second record of the same spend would only be another thing to keep in step.
    Effect.gen(function* () {
      const { facade, transfer } = yield* fundedFacade();

      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(transfer(tokenValue(1n)), {
          ttl: new Date(Date.now() + 60 * 60 * 1000),
          payFees: false,
        }),
      );

      const whileBalancing = yield* lifecycleOf(facade);
      expect(whileBalancing.records.map((record) => record.state)).toStrictEqual([{ _tag: 'Balanced' }]);

      yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      const afterFinalizing = yield* lifecycleOf(facade);
      expect(afterFinalizing.records.map((record) => record.state)).toStrictEqual([{ _tag: 'Finalized' }]);
      expect(afterFinalizing.records.map((record) => record.identifiers)).toStrictEqual(
        whileBalancing.records.map((record) => record.identifiers),
      );
    }).pipe(Effect.scoped, Effect.runPromise));

  it('keeps a transaction identifiable across proving, which is what ties a reservation to it', () =>
    // The reservation is matched to the transaction by identifier, so proving must not change them.
    Effect.gen(function* () {
      const { facade, transfer } = yield* fundedFacade();

      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(transfer(tokenValue(1n)), {
          ttl: new Date(Date.now() + 60 * 60 * 1000),
          payFees: false,
        }),
      );
      const beforeProving = [...carried<ledger.UnprovenTransaction>(recipe.transaction).identifiers()].toSorted();

      const finalized = yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      expect([...carried<ledger.FinalizedTransaction>(finalized).identifiers()].toSorted()).toEqual(beforeProving);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('A balanced transaction that never gets proven', () => {
  // Proving is the first thing after balancing that can fail, and the caller is handed the error with the coins
  // already booked. The booking is undone there, and the record standing for it has to go with it: a record left
  // behind outlives the coins it named, and the next thing to read it is told a spend is still out there.
  const failingProver: AnyVersionProvingService = {
    prove: () => Promise.reject(new Error('the proof server is on a different ledger version')),
  };

  it('leaves neither a booking nor the record that stood for it', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const simulator = yield* V9.Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: V9.immediateBlockProducer(),
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
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );

      expect(yield* liveRecordsOf(facade)).toHaveLength(1);

      const outcome = yield* Effect.either(Effect.tryPromise(() => facade.finalizeRecipe(recipe)));
      expect(outcome._tag).toEqual('Left');

      const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));

      expect(yield* liveRecordsOf(facade)).toEqual([]);
      expect(after.unshielded.pendingCoins).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('Bookings restored from a snapshot', () => {
  // A snapshot carries the coins a previous process had booked, and nothing in it says whether their transactions are
  // still out there. Once sync reaches the tip, a booked coin no transaction spent is free again, except where a live
  // record still accounts for it: a transaction recorded and not yet ended says its coins are spoken for, so a coin it
  // spends has to stay booked.
  it('keeps a restored booking a tracked transaction spends, and frees the one nothing accounts for', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      // Two coins, so the previous process can book one for each of two transfers.
      const simulator = yield* V9.Simulator.init({
        genesisMints: [
          nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress),
          nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress),
        ],
        blockProducer: V9.immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const previous = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));

      yield* waitForUnshieldedBalance(previous, NIGHT, tokenValue(200_000n));
      yield* simulator.fastForward(10_000n);
      const address = yield* Effect.promise(() => previous.unshielded.getAddress());
      const ttl = new Date(Date.now() + 60 * 60 * 1000);
      const transfer = () =>
        previous.transferTransaction(
          [
            {
              type: 'unshielded' as const,
              outputs: [{ type: NIGHT, receiverAddress: address, amount: tokenValue(1n) }],
            },
          ],
          { ttl, payFees: false },
        );
      const pendingCoinsReach = (facade: WalletFacade, count: number): Effect.Effect<FacadeState> =>
        Effect.promise(() =>
          rx.firstValueFrom(facade.state().pipe(rx.filter((state) => state.unshielded.pendingCoins.length === count))),
        );

      // The first transfer is finalized, so its record alone accounts for its coin.
      const tracked = yield* Effect.promise(() => transfer());
      const [trackedCoin] = (yield* pendingCoinsReach(previous, 1)).unshielded.pendingCoins.map(utxoKey);
      yield* Effect.promise(() => previous.finalizeRecipe(tracked));

      // The second is abandoned after balancing; its coin stays booked with no restored record for it.
      yield* Effect.promise(() => transfer());
      const bookedByPrevious = (yield* pendingCoinsReach(previous, 2)).unshielded.pendingCoins.map(utxoKey);
      const [abandonedCoin] = bookedByPrevious.filter((id) => id !== trackedCoin);

      const snapshot = yield* Effect.promise(() => previous.unshielded.serializeState());
      const lifecycle = yield* Effect.promise(() => rx.firstValueFrom(previous.transactionLifecycleService.state()));
      const trackedRecords = lifecycle.records.filter((record) => record.state._tag === 'Finalized');
      expect(trackedRecords).toHaveLength(1);
      expect(abandonedCoin).toBeDefined();

      // The restored records hold the tracked transaction alone, so it is the only thing that can account for either
      // booking.
      const restoredLifecycle = new DrivenLifecycle({ records: trackedRecords });
      const RestoredUnshieldedWallet = CustomUnshieldedWallet(
        { ...config, txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>() },
        new UnshieldedV2Builder()
          .withSync(UnshieldedSync.makeSimulatorSyncService, UnshieldedSync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withSigningDefaults()
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withCoinSelectionDefaults()
          .withTransactionHistoryDefaults(),
      );
      const restored = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config), {
        unshielded: () => RestoredUnshieldedWallet.restore(snapshot),
        transactionLifecycleService: () => restoredLifecycle,
      });

      const settled = yield* Effect.promise(() =>
        rx.firstValueFrom(
          restored
            .state()
            .pipe(rx.filter((state) => state.unshielded.availableCoins.map(utxoKey).includes(abandonedCoin))),
        ),
      );

      expect(settled.unshielded.pendingCoins.map(utxoKey)).toEqual([trackedCoin]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
