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
import { type SimulatorState, Simulator } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, Either, HashMap, Option, pipe, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { type CoreWallet as CoreWalletType, CoreWallet } from '../CoreWallet.js';
import { makeDefaultSyncCapability, makeSimulatorSyncCapability } from '../Sync.js';
import { type PendingUtxo, UnshieldedState, UtxoWithMeta } from '../UnshieldedState.js';
import { type UnshieldedTransaction, type WalletSyncUpdate } from '../SyncSchema.js';
import { generateMockUtxoWithMeta, utxoHash } from './testUtils.js';

/** Simulator time in the simulator tests, which set it either side of this instant. */
const SIM_TTL = new Date('2026-01-01T01:00:00.000Z');

/** An expiry every real clock has passed, so the indexer path always treats a booking dated here as stale. */
const LONG_EXPIRED = new Date(0);

/** An expiry no real clock has reached, so a booking dated here is always still live. */
const FAR_FUTURE = new Date('2999-01-01T00:00:00.000Z');

const keystore = createKeystore(Buffer.from(ledger.sampleSigningKey(), 'hex'), NetworkId.NetworkId.Undeployed);
const ownerPublicKey = PublicKey.fromKeyStore(keystore);

const walletHolding = (available: readonly UtxoWithMeta[], pending: readonly PendingUtxo[]): CoreWalletType =>
  CoreWallet.restore(
    UnshieldedState.restore(available, pending),
    ownerPublicKey,
    { appliedId: 1n, highestTransactionId: 1n },
    ProtocolVersion.ProtocolVersion(1n),
    NetworkId.NetworkId.Undeployed,
  );

/** Records nothing: these tests are about wallet state, and history is written on a forked fibre regardless. */
const historyContext = { transactionHistoryService: { put: () => Effect.void } };

const transaction = (id: number): UnshieldedTransaction =>
  ({
    id,
    hash: `hash-${id}`,
    type: 'RegularTransaction',
    protocolVersion: 1,
    block: { hash: `block-${id}`, height: id, timestamp: new Date('2026-01-01T00:00:00.000Z') },
    transactionResult: { status: 'SUCCESS', segments: null },
    // Type cast required because: `UnshieldedTransaction` is a Schema.Data class, and these tests need a plain
    // decoded value rather than a wire payload to decode.
  }) as unknown as UnshieldedTransaction;

const transactionUpdate = (
  id: number,
  created: readonly UtxoWithMeta[],
  spent: readonly UtxoWithMeta[],
): WalletSyncUpdate => ({
  type: 'UnshieldedTransaction',
  transaction: transaction(id),
  createdUtxos: created,
  spentUtxos: spent,
  status: 'SUCCESS',
});

const progressUpdate = (highestTransactionId: number): WalletSyncUpdate => ({
  type: 'UnshieldedTransactionsProgress',
  highestTransactionId,
});

const getOrThrow = <E, A>(either: Either.Either<A, E>): A =>
  pipe(
    either,
    Either.getOrThrowWith((e) => new Error(`Unexpected error: ${JSON.stringify(e)}`)),
  );

describe('Unshielded indexer sync capability', () => {
  // This path follows the chain, so it expires against wall time. These tests pick expiries no real clock can sit
  // between: the epoch is always past, and the year 2999 is always ahead. The boundary at the expiry itself is
  // pinned where it belongs, on `UnshieldedState.expirePending`.
  const capability = makeDefaultSyncCapability(
    { indexerClientConnection: { indexerHttpUrl: 'http://unused' } },
    () => historyContext,
  );

  describe('expiring bookings on an applied update', () => {
    it('releases a booking whose expiry has passed', () => {
      // Nothing else releases a booking taken for a transaction that was abandoned before submission, so the
      // wallet has to notice on its own that the transaction can no longer be accepted.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-stale', outputNo: 0 });

      const after = getOrThrow(
        capability.applyUpdate(walletHolding([], [{ utxo: booked, ttl: LONG_EXPIRED }]), progressUpdate(9)),
      );

      expect(HashMap.has(after.state.availableUtxos, utxoHash(booked))).toBe(true);
      expect(HashMap.size(after.state.pendingUtxos)).toEqual(0);
    });

    it('leaves a booking whose expiry has not passed', () => {
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-live', outputNo: 0 });

      const after = getOrThrow(
        capability.applyUpdate(walletHolding([], [{ utxo: booked, ttl: FAR_FUTURE }]), progressUpdate(9)),
      );

      expect(HashMap.has(after.state.availableUtxos, utxoHash(booked))).toBe(false);
      expect(Option.getOrNull(HashMap.get(after.state.pendingUtxos, utxoHash(booked)))).toEqual({
        utxo: booked,
        ttl: FAR_FUTURE,
      });
    });

    it('sweeps on a progress update, so a wallet with no transactions of its own still recovers', () => {
      // A leaked booking blocks its coin whether or not the address sees further activity.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-quiet', outputNo: 0 });

      const after = getOrThrow(
        capability.applyUpdate(walletHolding([], [{ utxo: booked, ttl: LONG_EXPIRED }]), progressUpdate(42)),
      );

      expect(HashMap.has(after.state.availableUtxos, utxoHash(booked))).toBe(true);
      expect(after.progress.highestTransactionId).toEqual(42n);
    });

    it('sweeps on a transaction update, and still applies the update', () => {
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-stale-tx', outputNo: 0 });
      const arriving = generateMockUtxoWithMeta({ intentHash: 'h-arriving', outputNo: 0 });

      const after = getOrThrow(
        capability.applyUpdate(
          walletHolding([], [{ utxo: booked, ttl: LONG_EXPIRED }]),
          transactionUpdate(5, [arriving], []),
        ),
      );

      expect(HashMap.has(after.state.availableUtxos, utxoHash(booked))).toBe(true);
      expect(HashMap.has(after.state.availableUtxos, utxoHash(arriving))).toBe(true);
      expect(HashMap.size(after.state.pendingUtxos)).toEqual(0);
      expect(after.progress.appliedId).toEqual(5n);
    });

    it('leaves an unexpired booking alone while releasing an expired one in the same sweep', () => {
      const stale = generateMockUtxoWithMeta({ intentHash: 'h-mixed-stale', outputNo: 0 });
      const live = generateMockUtxoWithMeta({ intentHash: 'h-mixed-live', outputNo: 0 });
      const wallet = walletHolding(
        [],
        [
          { utxo: stale, ttl: LONG_EXPIRED },
          { utxo: live, ttl: FAR_FUTURE },
        ],
      );

      const after = getOrThrow(capability.applyUpdate(wallet, progressUpdate(1)));

      expect([...HashMap.keys(after.state.availableUtxos)]).toEqual([utxoHash(stale)]);
      expect([...HashMap.keys(after.state.pendingUtxos)]).toEqual([utxoHash(live)]);
    });

    it('ends with one entry for a coin whose creating transaction replays after its booking expired', () => {
      // The two halves of the reported failure meet here: a stale booking and a resync that re-delivers the
      // transaction which created the booked coin.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-replayed', outputNo: 0 });

      const after = getOrThrow(
        capability.applyUpdate(
          walletHolding([], [{ utxo: booked, ttl: LONG_EXPIRED }]),
          transactionUpdate(6, [booked], []),
        ),
      );

      expect([...HashMap.keys(after.state.availableUtxos)]).toEqual([utxoHash(booked)]);
      expect(HashMap.size(after.state.pendingUtxos)).toEqual(0);
    });

    it('keeps a confirmed spend gone rather than releasing it', () => {
      // A booking cleared by its transaction confirming must not come back through the sweep.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-confirmed', outputNo: 0 });

      const after = getOrThrow(
        capability.applyUpdate(
          walletHolding([], [{ utxo: booked, ttl: LONG_EXPIRED }]),
          transactionUpdate(7, [], [booked]),
        ),
      );

      expect(HashMap.has(after.state.availableUtxos, utxoHash(booked))).toBe(false);
      expect(HashMap.size(after.state.pendingUtxos)).toEqual(0);
    });
  });
});

describe('Unshielded simulator sync capability', () => {
  /**
   * The simulator path works out created and spent coins by diffing against the simulator's own UTxO set, so a booked
   * coin has to be one the simulator actually holds — a fabricated one reads as spent and is dropped, not swept.
   */
  const simulatorHoldingOneCoin = (
    currentTime: Date,
  ): Effect.Effect<{ state: SimulatorState; coin: UtxoWithMeta }, unknown, Scope.Scope> =>
    Effect.gen(function* () {
      const simulator = yield* Simulator.init({
        genesisMints: [
          {
            type: 'unshielded',
            tokenType: ledger.nativeToken().raw,
            // Night is claimed rather than minted, and a claim below roughly 14,000 does not go through.
            amount: 1_000_000n,
            recipient: ownerPublicKey.addressHex,
            verifyingKey: ownerPublicKey.publicKey,
          },
        ],
      });
      const latest = yield* simulator.getLatestState();
      const state = { ...latest, currentTime };
      const [utxo] = Array.from(state.ledger.utxo.filter(ownerPublicKey.addressHex));

      return {
        state,
        coin: new UtxoWithMeta({ utxo, meta: { ctime: currentTime, registeredForDustGeneration: false } }),
      };
    });

  it('expires a booking against simulator time, not the system clock', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Simulator time is the wallet's clock in simulation mode, and it does not track the wall clock at all.
          const { state, coin } = yield* simulatorHoldingOneCoin(new Date(SIM_TTL.getTime() + 1));

          const after = getOrThrow(
            makeSimulatorSyncCapability().applyUpdate(walletHolding([], [{ utxo: coin, ttl: SIM_TTL }]), {
              update: state,
            }),
          );

          expect(HashMap.has(after.state.availableUtxos, utxoHash(coin))).toBe(true);
          expect(HashMap.size(after.state.availableUtxos)).toEqual(1);
          expect(HashMap.size(after.state.pendingUtxos)).toEqual(0);
        }),
      ),
    ));

  it('leaves a booking whose expiry simulator time has not yet reached', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { state, coin } = yield* simulatorHoldingOneCoin(new Date(SIM_TTL.getTime() - 1));

          const after = getOrThrow(
            makeSimulatorSyncCapability().applyUpdate(walletHolding([], [{ utxo: coin, ttl: SIM_TTL }]), {
              update: state,
            }),
          );

          expect(HashMap.size(after.state.availableUtxos)).toEqual(0);
          expect(Option.getOrNull(HashMap.get(after.state.pendingUtxos, utxoHash(coin)))).toEqual({
            utxo: coin,
            ttl: SIM_TTL,
          });
        }),
      ),
    ));
});
