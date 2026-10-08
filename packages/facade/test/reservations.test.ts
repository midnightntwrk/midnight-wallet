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
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  type FinalizedTx,
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
import { type PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { Simulator, immediateBlockProducer, type GenesisMint } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, Either } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState, type WalletEntry, type WalletFacade } from '../src/index.js';
import type { V9UnboundTransaction, VersionedProvingService } from '@midnightntwrk/wallet-sdk-capabilities/proving';
import {
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  SilentPendingTransactions,
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

/**
 * The pending set as the facade's pending-transactions service holds it. Reservations live there and nowhere in
 * {@link FacadeState}, whose `pending` is the application's projection of tracked transactions only.
 */
const pendingSet = (facade: WalletFacade): Effect.Effect<PendingTransactions.PendingTransactions<FinalizedTx>> =>
  Effect.promise(() => rx.firstValueFrom(facade.pendingTransactionsService.state()));

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

      // Every coin that left the available side is named by a reservation.
      const pending = yield* pendingSet(facade);
      const reserved = new Set(pending.reservations.flatMap((r) => r.inputs.unshielded));
      expect(booked.filter((id) => !reserved.has(id))).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('gives the reservation an expiry matching the transaction it was taken for', () =>
    Effect.gen(function* () {
      const { facade, transfer } = yield* fundedFacade();
      const ttl = new Date(Date.now() + 60 * 60 * 1000);

      yield* Effect.promise(() => facade.transferTransaction(transfer(tokenValue(1n)), { ttl, payFees: false }));

      const pending = yield* pendingSet(facade);

      expect(pending.reservations).toHaveLength(1);
      // The ledger truncates an intent's TTL to whole seconds, so compare at that resolution.
      expect(Math.floor(pending.reservations[0].ttl.getTime() / 1000)).toEqual(Math.floor(ttl.getTime() / 1000));
      expect(pending.reservations[0].expired).toBe(false);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('drops the reservation once the transaction itself is being tracked', () =>
    // From submission onwards the transaction carries its own expiry and its own release paths, so a second record
    // of the same spend would only be another thing to keep in step.
    Effect.gen(function* () {
      const { facade, transfer } = yield* fundedFacade();

      const recipe = yield* Effect.promise(() =>
        facade.transferTransaction(transfer(tokenValue(1n)), {
          ttl: new Date(Date.now() + 60 * 60 * 1000),
          payFees: false,
        }),
      );

      const reservedWhileBalancing = yield* pendingSet(facade);
      expect(reservedWhileBalancing.reservations).toHaveLength(1);

      // Tracking begins when the finalized transaction is registered, which is what makes the reservation redundant.
      yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      const afterFinalizing = yield* pendingSet(facade);
      expect(afterFinalizing.reservations).toEqual([]);
      expect(afterFinalizing.all).toHaveLength(1);
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
  const failingProver: VersionedProvingService<V9UnboundTransaction> = {
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
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );

      const booked = yield* pendingSet(facade);
      expect(booked.reservations).toHaveLength(1);

      const outcome = yield* Effect.either(Effect.tryPromise(() => facade.finalizeRecipe(recipe)));
      expect(outcome._tag).toEqual('Left');

      const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const pendingAfter = yield* pendingSet(facade);

      expect(pendingAfter.reservations).toEqual([]);
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
      // Two coins: one the caller's first transaction books, one left for the wallet to book when it balances the
      // caller's second. With a single coin there would be nothing to book and the comparison below would hold for
      // an empty record.
      const simulator = yield* Simulator.init({
        genesisMints: [
          nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress),
          nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress),
        ],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));

      yield* waitForUnshieldedBalance(facade, NIGHT, tokenValue(200_000n));
      yield* simulator.fastForward(10_000n);
      const address = yield* Effect.promise(() => facade.unshielded.getAddress());
      const ttl = new Date(Date.now() + 60 * 60 * 1000);

      // A transaction of the caller's own, built through the wallet: the coin it spends is booked and recorded under
      // this transaction's reservation, which is the state a caller's coin is in when the caller reuses it.
      yield* Effect.promise(() =>
        facade.transferTransaction(
          [
            {
              type: 'unshielded' as const,
              outputs: [{ type: NIGHT, receiverAddress: address, amount: tokenValue(1n) }],
            },
          ],
          { ttl, payFees: false },
        ),
      );

      const beforeBalancing: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const reservationsBefore = (yield* pendingSet(facade)).reservations;
      expect(beforeBalancing.unshielded.pendingCoins).toHaveLength(1);
      expect(reservationsBefore).toHaveLength(1);
      const callersCoin = beforeBalancing.unshielded.pendingCoins[0];
      const pendingBefore = new Set(beforeBalancing.unshielded.pendingCoins.map(utxoKey));

      // The caller's second transaction spends that same coin and pays out more than it holds, so balancing it has to
      // book a coin of the wallet's own: the balanced result names coins from both sources.
      const intent = ledger.Intent.new(ttl);
      intent.fallibleUnshieldedOffer = ledger.UnshieldedOffer.new(
        [{ ...callersCoin.utxo, owner: keys.signatureVerifyingKey }],
        [{ owner: keys.userAddress, type: NIGHT, value: callersCoin.utxo.value + tokenValue(1n) }],
        [],
      );
      const callersTransaction = WalletTransaction.adopt(
        'Unproven',
        ledger.Transaction.fromParts(NETWORK_ID, undefined, undefined, intent),
        ProtocolVersion.MinSupportedVersion,
      );

      yield* Effect.promise(() =>
        facade.balanceUnprovenTransaction(callersTransaction, { ttl, tokenKindsToBalance: ['unshielded'] }),
      );

      const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const newlyBooked = after.unshielded.pendingCoins.map(utxoKey).filter((id) => !pendingBefore.has(id));
      const sameSpend = (left: readonly string[], right: readonly string[]): boolean =>
        left.length === right.length && left.every((id, index) => id === right[index]);
      const added = (yield* pendingSet(facade)).reservations.filter(
        (reservation) => !reservationsBefore.some((before) => sameSpend(before.identifiers, reservation.identifiers)),
      );
      expect(added).toHaveLength(1);
      const recorded = added[0].inputs.unshielded;

      // Balancing had to book something, or the comparison below would hold for an empty record.
      expect(newlyBooked.length).toBeGreaterThan(0);
      expect(recorded.toSorted()).toEqual(newlyBooked.toSorted());
      // The caller's coin was booked for its first transaction, not by this balancing, so this record leaves it alone.
      expect(recorded).not.toContain(utxoKey(callersCoin));
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('Bookings restored from a snapshot', () => {
  // A snapshot carries the coins a previous process had booked, and nothing in it says whether their transactions are
  // still out there. Once sync reaches the tip, a booked coin no transaction spent is free again, except where the
  // pending set still accounts for it: a transaction being tracked is what says its coins are spoken for from
  // submission onwards, so a coin it spends has to stay booked.
  it('keeps a restored booking a tracked transaction spends, and frees the one nothing accounts for', () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      // Two coins, so the previous process can book one for each of two transfers.
      const simulator = yield* Simulator.init({
        genesisMints: [
          nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress),
          nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress),
        ],
        blockProducer: immediateBlockProducer(),
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

      // The first transfer is finalized, so the pending set tracks it and it alone accounts for its coin.
      const tracked = yield* Effect.promise(() => transfer());
      const [trackedCoin] = (yield* pendingCoinsReach(previous, 1)).unshielded.pendingCoins.map(utxoKey);
      yield* Effect.promise(() => previous.finalizeRecipe(tracked));

      // The second is abandoned after balancing; its coin stays booked with nothing in the restored pending set for it.
      yield* Effect.promise(() => transfer());
      const bookedByPrevious = (yield* pendingCoinsReach(previous, 2)).unshielded.pendingCoins.map(utxoKey);
      const [abandonedCoin] = bookedByPrevious.filter((id) => id !== trackedCoin);

      const snapshot = yield* Effect.promise(() => previous.unshielded.serializeState());
      const { all } = yield* pendingSet(previous);
      expect(all).toHaveLength(1);
      expect(abandonedCoin).toBeDefined();

      // The restored pending set holds the tracked transaction and no reservation, so the tracked transaction is the only
      // thing that can account for either booking.
      const restoredPending = new SilentPendingTransactions();
      restoredPending.states.next({ all, reservations: [] });
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
        pendingTransactionsService: () => restoredPending,
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
