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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import type { Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either, HashMap, Option, Stream, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultSyncCapability, makeSimulatorSyncCapability, type DefaultSyncContext } from '../Sync.js';
import {
  Simulator,
  immediateBlockProducer,
  type SimulatorState,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { UnshieldedState, UtxoWithMeta } from '../UnshieldedState.js';
import { generateMockUtxoWithMeta, utxoHash } from './testUtils.js';

const getOrThrow = <E, A>(either: Either.Either<A, E>): A =>
  pipe(
    either,
    Either.getOrThrowWith((e) => new Error(`Unexpected error: ${JSON.stringify(e)}`)),
  );

const publicKey = PublicKey.fromKeyStore(
  createKeystore(Buffer.from(ledger.sampleSigningKey(), 'hex'), NetworkId.NetworkId.Undeployed),
);

/** Records nothing — the sync capability forks history writes and this test asserts only on wallet state. */
const context: DefaultSyncContext = {
  transactionHistoryService: { put: () => Effect.void },
};

const fixedClock = (now: Date): Clock.Clock => ({ now: () => now });

const walletWith = (state: UnshieldedState): CoreWallet =>
  CoreWallet.restore(
    state,
    publicKey,
    { appliedId: 0n, highestTransactionId: 0n },
    ProtocolVersion.ProtocolVersion(1n),
    NetworkId.NetworkId.Undeployed,
  );

describe('Unshielded wallet sync capability', () => {
  // Expiry only helps if something calls it. Sync is the wallet's own heartbeat — it is the one thing that keeps
  // running after a booking is abandoned — so every applied update sweeps the bookings first.
  describe('booking expiry on sync', () => {
    const booking = {
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    };
    const afterExpiry = new Date('2026-01-01T02:00:00.000Z');
    const beforeExpiry = new Date('2026-01-01T00:30:00.000Z');

    const bookedWallet = (u: ReturnType<typeof generateMockUtxoWithMeta>): CoreWallet =>
      walletWith(getOrThrow(UnshieldedState.spend(UnshieldedState.restore([u], []), u, booking)));

    const progressUpdate = { type: 'UnshieldedTransactionsProgress' as const, highestTransactionId: 12 };

    it('releases an expired booking when a progress update arrives', () => {
      // Progress updates are the most frequent thing the subscription delivers, so they are the tick that matters when
      // a wallet is idle — which is exactly the state a leaked booking leaves it in.
      const u = generateMockUtxoWithMeta({ intentHash: 'h-sync-progress', outputNo: 0 });
      const capability = makeDefaultSyncCapability(
        { indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088' }, clock: fixedClock(afterExpiry) },
        () => context,
      );

      const after = getOrThrow(capability.applyUpdate(bookedWallet(u), progressUpdate));

      expect(HashMap.has(UnshieldedState.availableUtxos(after.state), utxoHash(u))).toBe(true);
      expect(HashMap.has(UnshieldedState.pendingUtxos(after.state), utxoHash(u))).toBe(false);
    });

    it('leaves a booking that has not expired', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-sync-live', outputNo: 0 });
      const capability = makeDefaultSyncCapability(
        { indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088' }, clock: fixedClock(beforeExpiry) },
        () => context,
      );

      const after = getOrThrow(capability.applyUpdate(bookedWallet(u), progressUpdate));

      expect(HashMap.has(UnshieldedState.pendingUtxos(after.state), utxoHash(u))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after.state), utxoHash(u))).toBe(false);
    });

    it('still advances sync progress while releasing a booking', () => {
      // The sweep must not swallow the update it rode in on.
      const u = generateMockUtxoWithMeta({ intentHash: 'h-sync-progress-kept', outputNo: 0 });
      const capability = makeDefaultSyncCapability(
        { indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088' }, clock: fixedClock(afterExpiry) },
        () => context,
      );

      const after = getOrThrow(capability.applyUpdate(bookedWallet(u), progressUpdate));

      expect(after.progress.highestTransactionId).toEqual(12n);
    });
  });

  // The simulator reconciles the wallet against the ledger's own UTxO set: anything the ledger holds and the wallet
  // does not is created, anything the wallet holds and the ledger does not is spent. With one map of owned coins that
  // is one membership check per side, and a coin's booking is not part of either question.
  describe('simulator sync', () => {
    const liveBooking = {
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    };

    const withSimulator = <A>(use: (simulator: Simulator, latest: SimulatorState) => A): Promise<A> =>
      Effect.gen(function* () {
        const simulator = yield* Simulator.init({
          networkId: NetworkId.NetworkId.Undeployed,
          blockProducer: immediateBlockProducer(),
          genesisMints: [
            {
              type: 'unshielded',
              tokenType: ledger.nativeToken().raw,
              // Whole NIGHT: a rewards claim of a few raw units is rejected by the ledger.
              amount: 3000n * 10n ** 6n,
              recipient: ledger.addressFromKey(publicKey.publicKey),
              verifyingKey: publicKey.publicKey,
            },
          ],
        });
        // Block production is asynchronous: wait for the state whose ledger actually holds the genesis mint.
        const hasMint = (s: SimulatorState) => Array.from(s.ledger.utxo.filter(publicKey.addressHex)).length > 0;
        const latest = yield* pipe(
          Stream.fromEffect(simulator.getLatestState()),
          Stream.concat(simulator.state$),
          Stream.filter(hasMint),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        return use(simulator, latest);
      }).pipe(Effect.scoped, Effect.runPromise);

    it('leaves a booked coin booked, and stored once, on applying the latest block', () =>
      withSimulator((_simulator, latest) => {
        const [minted] = Array.from(latest.ledger.utxo.filter(publicKey.addressHex));
        const u = new UtxoWithMeta({
          utxo: minted,
          meta: { ctime: new Date('2026-01-01T00:00:00.000Z'), registeredForDustGeneration: false },
        });
        // The wallet owns and has booked the very coin the ledger still holds — the shape that duplicated it before.
        const booked = CoreWallet.restore(
          getOrThrow(UnshieldedState.spend(UnshieldedState.restore([u], []), u, liveBooking)),
          publicKey,
          { appliedId: 7n, highestTransactionId: 7n },
          ProtocolVersion.ProtocolVersion(1n),
          NetworkId.NetworkId.Undeployed,
        );

        const after = getOrThrow(makeSimulatorSyncCapability().applyUpdate(booked, { update: latest }));

        expect(HashMap.size(after.state.utxos)).toEqual(1);
        expect(HashMap.has(UnshieldedState.pendingUtxos(after.state), utxoHash(u))).toBe(true);
        expect(HashMap.size(UnshieldedState.availableUtxos(after.state))).toEqual(0);
      }));
  });
});
