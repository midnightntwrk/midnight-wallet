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
 * the caller or the facade has to do, across a restart too. Until then the booking is visible, both in the wallet's
 * state and as a reservation the facade records, so a stuck coin can be told from a missing one.
 *
 * The wallet counts a booking's lifetime from the first sync update that sees it, so the chain's clock is moved past a
 * lifetime twice: once for the wallet to see the booking, and once for the lifetime to pass.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { type FinalizedTx, NetworkId, NoOpTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { type PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { CustomShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import {
  Sync as ShieldedSync,
  TransactionHistory as ShieldedTransactionHistory,
  V2Builder as ShieldedV2Builder,
} from '@midnightntwrk/wallet-sdk-shielded/v2';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState, type WalletEntry, type WalletFacade } from '../src/index.js';
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

/** Mainnet's `global_ttl`, 14 days, plus a second: past it, no shielded spend built before can still be included. */
const PAST_A_LIFETIME = 14n * 24n * 60n * 60n + 1n;
const LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
/** A TTL well inside a lifetime, so a release at the TTL cannot be mistaken for a release at the lifetime. */
const TEN_MINUTES_MS = 10 * 60 * 1000;
const TEN_MINUTES_S = 10n * 60n;

const stateWhere = (facade: WalletFacade, predicate: (state: FacadeState) => boolean): Effect.Effect<FacadeState> =>
  Effect.promise(() => rx.firstValueFrom(facade.state().pipe(rx.filter(predicate), rx.timeout({ first: 5_000 }))));

const pendingSet = (facade: WalletFacade): Effect.Effect<PendingTransactions.PendingTransactions<FinalizedTx>> =>
  Effect.promise(() => rx.firstValueFrom(facade.pendingTransactionsService.state()));

/** A facade holding one shielded coin, and a transfer of part of it to itself that books that coin. */
const fundedFacade = () =>
  Effect.gen(function* () {
    const keys = deriveWalletKeys(SEED, NETWORK_ID);
    const simulator = yield* V9.Simulator.init({
      genesisMints: [
        { type: 'shielded', tokenType: SHIELDED, amount: tokenValue(1_000n), recipient: keys.shieldedKeys },
      ],
      blockProducer: V9.immediateBlockProducer(),
    });
    const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
    const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));

    yield* waitForShieldedCoins(facade);
    const before: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
    const receiverAddress = yield* Effect.promise(() => facade.shielded.getAddress());
    const transfer = (on: WalletFacade) =>
      Effect.promise(() =>
        on.transferTransaction(
          [{ type: 'shielded', outputs: [{ type: SHIELDED, receiverAddress, amount: tokenValue(1n) }] }],
          // The simulator's clock starts at the epoch, so a TTL taken from the machine clock lies far beyond the lifetime:
          // what releases these coins is the lifetime, never the TTL.
          { ttl: new Date(Date.now() + LIFETIME_MS), payFees: false },
        ),
      );

    return { keys, simulator, config, facade, before, transfer };
  });

describe('A shielded transfer the caller abandons', () => {
  it('should have its coins become spendable again once the chain has moved past their lifetime', () =>
    Effect.gen(function* () {
      const { simulator, facade, before, transfer } = yield* fundedFacade();
      const coins = before.shielded.availableCoins.map((c) => c.coin.nonce);

      yield* transfer(facade);
      const booked: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      expect(booked.shielded.availableCoins).toEqual([]);

      yield* simulator.fastForward(PAST_A_LIFETIME);
      yield* simulator.fastForward(PAST_A_LIFETIME);

      const released = yield* stateWhere(facade, (s) => s.shielded.availableCoins.length > 0);
      expect(released.shielded.availableCoins.map((c) => c.coin.nonce)).toEqual(coins);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should have its coins become spendable again after a restart, because the booking is saved with the wallet', () =>
    Effect.gen(function* () {
      const { keys, simulator, config, facade, before, transfer } = yield* fundedFacade();
      const coins = before.shielded.availableCoins.map((c) => c.coin.nonce);

      yield* transfer(facade);
      yield* stateWhere(facade, (s) => s.shielded.availableCoins.length === 0);
      const snapshot = yield* Effect.promise(() => facade.shielded.serializeState());

      const RestoredShieldedWallet = CustomShieldedWallet(
        {
          ...config,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
          indexerClientConnection: { indexerHttpUrl: 'http://unused:0' },
        },
        new ShieldedV2Builder()
          .withDefaultTransactionType()
          .withSync(ShieldedSync.makeSimulatorSyncService, ShieldedSync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withCoinsAndBalancesDefaults()
          .withTransactionHistory(ShieldedTransactionHistory.makeSimulatorTransactionHistoryService)
          .withKeysDefaults()
          .withStartAuxDefaults()
          .withCoinSelectionDefaults(),
      );
      const restored = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config), {
        shielded: () => RestoredShieldedWallet.restore(snapshot),
      });
      const afterRestart = yield* Effect.promise(() => rx.firstValueFrom(restored.state()));
      expect(afterRestart.shielded.availableCoins).toEqual([]);

      yield* simulator.fastForward(PAST_A_LIFETIME);
      yield* simulator.fastForward(PAST_A_LIFETIME);

      const released = yield* stateWhere(restored, (s) => s.shielded.availableCoins.length > 0);
      expect(released.shielded.availableCoins.map((c) => c.coin.nonce)).toEqual(coins);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should show its coins as reserved, and from when they will be released, until they are', () =>
    Effect.gen(function* () {
      const { simulator, facade, before, transfer } = yield* fundedFacade();
      const [coin] = before.shielded.availableCoins;
      expect(before.shielded.reservedCoins).toEqual([]);

      yield* transfer(facade);
      const booked = yield* stateWhere(facade, (s) => s.shielded.reservedCoins.length > 0);
      expect(booked.shielded.reservedCoins.map((reserved) => reserved.coin.nonce)).toEqual([coin.coin.nonce]);

      // Seen by sync: the wallet now knows when the coin will be released, a lifetime after it first saw the booking.
      yield* simulator.fastForward(1n);
      const seenAt = yield* simulator.query((s) => s.currentTime);
      const dated = yield* stateWhere(facade, (s) => s.shielded.reservedCoins[0]?.releasableAfter !== undefined);
      const [reserved] = dated.shielded.reservedCoins;
      expect(reserved.reservedSince).toEqual(seenAt);
      expect(reserved.releasableAfter).toEqual(new Date(seenAt.getTime() + LIFETIME_MS));

      yield* simulator.fastForward(PAST_A_LIFETIME);
      const released = yield* stateWhere(facade, (s) => s.shielded.availableCoins.length > 0);
      expect(released.shielded.reservedCoins).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should have its coins released once the transfer’s TTL has passed, well before a lifetime, because no transaction can be included after its TTL', () =>
    Effect.gen(function* () {
      const { simulator, facade, before } = yield* fundedFacade();
      const [coin] = before.shielded.availableCoins;
      const receiverAddress = yield* Effect.promise(() => facade.shielded.getAddress());
      const builtAt = yield* simulator.query((s) => s.currentTime);
      const ttl = new Date(builtAt.getTime() + TEN_MINUTES_MS);

      yield* Effect.promise(() =>
        facade.transferTransaction(
          [{ type: 'shielded', outputs: [{ type: SHIELDED, receiverAddress, amount: tokenValue(1n) }] }],
          { ttl, payFees: false },
        ),
      );

      // Seen by sync: the wallet now knows when the coin will be released, which the TTL brings forward.
      yield* simulator.fastForward(1n);
      const seenAt = yield* simulator.query((s) => s.currentTime);
      const dated = yield* stateWhere(facade, (s) => s.shielded.reservedCoins[0]?.releasableAfter !== undefined);
      const [reserved] = dated.shielded.reservedCoins;
      expect(reserved.coin.nonce).toEqual(coin.coin.nonce);
      expect(reserved.reservedSince).toEqual(seenAt);
      expect(reserved.releasableAfter).toEqual(ttl);

      yield* simulator.fastForward(TEN_MINUTES_S);
      const releasedAt = yield* simulator.query((s) => s.currentTime);
      expect(releasedAt.getTime()).toBeGreaterThan(ttl.getTime());
      expect(releasedAt.getTime()).toBeLessThan(seenAt.getTime() + LIFETIME_MS);
      const released = yield* stateWhere(facade, (s) => s.shielded.availableCoins.length > 0);
      expect(released.shielded.availableCoins.map((c) => c.coin.nonce)).toEqual([coin.coin.nonce]);
      expect(released.shielded.reservedCoins).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should be recorded as a reservation naming the coins it booked, so they have an owner outside the wallet state', () =>
    Effect.gen(function* () {
      const { facade, before, transfer } = yield* fundedFacade();
      const [coin] = before.shielded.availableCoins;

      yield* transfer(facade);
      const { reservations } = yield* pendingSet(facade);

      expect(reservations).toHaveLength(1);
      expect(reservations[0].inputs.shielded).toEqual([coin.nullifier]);
      expect(reservations[0].inputs.unshielded).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should drop that reservation once the transaction itself is being tracked', () =>
    Effect.gen(function* () {
      const { facade, transfer } = yield* fundedFacade();

      const recipe = yield* transfer(facade);
      expect((yield* pendingSet(facade)).reservations).toHaveLength(1);
      yield* Effect.promise(() => facade.finalizeRecipe(recipe));

      expect((yield* pendingSet(facade)).reservations).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
