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
 * One thing releases a booked coin: the wallet's own sweep, at the coin's TTL. A reservation records which coins a
 * balanced transaction took, and expires on the same instant, but expiring is not a second way to release them.
 *
 * The two are on different clocks — the wallet sweeps as sync updates arrive, the service polls once a second — and a
 * coin freed by the first can be booked again before the second fires. A release driven by the reservation would then
 * free a booking taken for a different transaction, since the ids alone say nothing about which booking holds them.
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  PendingTransactions,
  type PendingTransactionsService,
} from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { Simulator, immediateBlockProducer, type GenesisMint } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { DateTime, Effect } from 'effect';
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

vi.setConfig({ testTimeout: 30_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const NIGHT = ledger.nativeToken().raw;
const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000002';

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
 * A pending-transactions service whose state this test drives directly, so an expired reservation can be presented at a
 * chosen moment rather than waited for.
 */
const controllablePendingService = (): PendingTransactionsService<ledger.FinalizedTransaction> & {
  emit: (state: PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>) => void;
  current: () => PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>;
} => {
  const subject = new rx.BehaviorSubject<PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>>(
    PendingTransactions.empty(),
  );

  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    state: () => subject.asObservable(),
    // Nothing here submits, so tracking never starts.
    addPendingTransaction: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    addReservation: (reservation) => {
      subject.next(PendingTransactions.addReservation(subject.value, reservation));
      return Promise.resolve();
    },
    clearReservation: (identifiers) => {
      subject.next(PendingTransactions.clearReservation(subject.value, identifiers));
      return Promise.resolve();
    },
    emit: (state) => subject.next(state),
    current: () => subject.value,
  };
};

describe('A reservation reaching its expiry', () => {
  const fundedFacade = () =>
    Effect.gen(function* () {
      const keys = deriveWalletKeys(SENDER_SEED, NETWORK_ID);
      const simulator = yield* Simulator.init({
        genesisMints: [nightGenesisMint(keys.signatureVerifyingKey, keys.userAddress)],
        blockProducer: immediateBlockProducer(),
      });
      const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
      const pending = controllablePendingService();
      const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config), {
        pendingTransactionsService: () => pending,
      });

      yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
      yield* simulator.fastForward(10_000n);
      const address = yield* Effect.promise(() => facade.unshielded.getAddress());

      const transfer = (amount: bigint) => [
        {
          type: 'unshielded' as const,
          outputs: [{ type: NIGHT, receiverAddress: address, amount }],
        },
      ];

      return { facade, keys, simulator, transfer, pending };
    });

  it('leaves a booking alone, because only the wallet sweep releases a coin', () =>
    // The expired reservation below names the booked coin but stands for a different spend, which is exactly the
    // shape the two clocks produce: an abandoned transaction's record outliving the coin it once held.
    Effect.gen(function* () {
      const { facade, keys, transfer, pending } = yield* fundedFacade();

      yield* Effect.promise(() =>
        facade.transferTransaction(
          transfer(tokenValue(1n)),
          { shieldedSecretKeys: keys.shieldedKeys, dustSecretKey: keys.dustKey },
          { ttl: new Date(Date.now() + 60 * 60 * 1000), payFees: false },
        ),
      );

      const booked: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
      const bookedIds = booked.unshielded.pendingCoins.map(utxoKey);
      expect(bookedIds.length).toBeGreaterThan(0);

      // An older spend, already gone, whose record names the same coins and has just passed its TTL.
      pending.emit(
        PendingTransactions.addReservation(PendingTransactions.empty(), {
          identifiers: ['an-abandoned-spend'],
          intentHashes: [],
          inputs: { unshielded: bookedIds },
          ttl: new Date(Date.now() - 1000),
          createdAt: DateTime.unsafeNow(),
          expired: true,
        }),
      );

      yield* Effect.promise(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 200);
          }),
      );

      const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));

      expect(after.unshielded.pendingCoins.map(utxoKey).toSorted()).toEqual(bookedIds.toSorted());
      expect(after.unshielded.availableCoins.map(utxoKey)).not.toContain(bookedIds[0]);
      // The record itself is what expiry retires.
      expect(pending.current().reservations).toEqual([]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
