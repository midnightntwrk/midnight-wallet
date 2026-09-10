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
import { Either, HashMap, Option, pipe } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type PendingUtxo, UnshieldedState, type UnshieldedUpdate, type UtxoWithMeta } from '../UnshieldedState.js';
import { UtxoNotFoundError } from '../WalletError.js';
import { generateMockUpdate, generateMockUtxoWithMeta, utxoArb, utxoHash } from './testUtils.js';

const getOrThrow = <E, A>(either: Either.Either<A, E>): A =>
  pipe(
    either,
    Either.getOrThrowWith((e) => new Error(`Unexpected error: ${JSON.stringify(e)}`)),
  );

/** The expiry every booking in these tests is given: the TTL of the transaction it was taken for. */
const TTL = new Date('2026-01-01T01:00:00.000Z');

/** A pending entry as `restore` expects one: the coin plus the expiry it was booked with. */
const pendingAt = (utxo: UtxoWithMeta, ttl: Date = TTL): PendingUtxo => ({ utxo, ttl });

describe('UnshieldedState', () => {
  describe('applyUpdate', () => {
    it('should apply a successful update', () => {
      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, generateMockUpdate('SUCCESS', 1, 0)),
        getOrThrow,
      );

      expect(HashMap.size(state.availableUtxos)).toEqual(1);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('should apply update with multiple created outputs', () => {
      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, generateMockUpdate('SUCCESS', 3, 0)),
        getOrThrow,
      );

      expect(HashMap.size(state.availableUtxos)).toEqual(3);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('should reject applying update with wrong status', () => {
      const result = pipe(UnshieldedState.empty(), (s) =>
        UnshieldedState.applyUpdate(s, generateMockUpdate('FAILURE', 1, 0)),
      );

      expect(Either.isLeft(result)).toBe(true);
    });

    it('should apply PARTIAL_SUCCESS update the same as SUCCESS', () => {
      const created = generateMockUtxoWithMeta({ intentHash: 'h-partial', outputNo: 0 });
      const update: UnshieldedUpdate = {
        createdUtxos: [created],
        spentUtxos: [],
        status: 'PARTIAL_SUCCESS',
      };

      const state = pipe(UnshieldedState.empty(), (s) => UnshieldedState.applyUpdate(s, update), getOrThrow);

      expect(HashMap.has(state.availableUtxos, utxoHash(created))).toBe(true);
      expect(HashMap.size(state.availableUtxos)).toEqual(1);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('should apply update that both creates and spends utxos', () => {
      const existing = generateMockUtxoWithMeta({ intentHash: 'h-existing', outputNo: 0 });
      const created = generateMockUtxoWithMeta({ intentHash: 'h-new', outputNo: 0 });

      const initial = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [existing],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      const after = pipe(
        UnshieldedState.applyUpdate(initial, {
          createdUtxos: [created],
          spentUtxos: [existing],
          status: 'SUCCESS',
        }),
        getOrThrow,
      );

      expect(HashMap.has(after.availableUtxos, utxoHash(created))).toBe(true);
      expect(HashMap.has(after.availableUtxos, utxoHash(existing))).toBe(false);
      expect(HashMap.size(after.availableUtxos)).toEqual(1);
      expect(HashMap.size(after.pendingUtxos)).toEqual(0);
    });

    it('should remove confirmed spent utxos from pendingUtxos', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-confirm', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [u],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
        (s) => {
          expect(HashMap.has(s.pendingUtxos, utxoHash(u))).toBe(true);
          return s;
        },
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [],
            spentUtxos: [u],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      expect(HashMap.has(after.pendingUtxos, utxoHash(u))).toBe(false);
      expect(HashMap.has(after.availableUtxos, utxoHash(u))).toBe(false);
    });

    it('should be a no-op for an empty SUCCESS update', () => {
      const seed = generateMockUtxoWithMeta({ intentHash: 'h-seed', outputNo: 0 });

      const before = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [seed],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      const after = pipe(
        UnshieldedState.applyUpdate(before, {
          createdUtxos: [],
          spentUtxos: [],
          status: 'SUCCESS',
        }),
        getOrThrow,
      );

      expect(HashMap.has(after.availableUtxos, utxoHash(seed))).toBe(true);
      expect(HashMap.size(after.availableUtxos)).toEqual(1);
      expect(HashMap.size(after.pendingUtxos)).toEqual(0);
    });

    it('should silently ignore spentUtxos that are not in state', () => {
      const present = generateMockUtxoWithMeta({ intentHash: 'h-present', outputNo: 0 });
      const ghost = generateMockUtxoWithMeta({ intentHash: 'h-ghost', outputNo: 0 });

      const state = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [present],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [],
            spentUtxos: [ghost],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      expect(HashMap.has(state.availableUtxos, utxoHash(present))).toBe(true);
      expect(HashMap.size(state.availableUtxos)).toEqual(1);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('should place the specific created utxo into availableUtxos by hash', () => {
      const a = generateMockUtxoWithMeta({ intentHash: 'h-a', outputNo: 0 });
      const b = generateMockUtxoWithMeta({ intentHash: 'h-b', outputNo: 1 });

      const state = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [a, b],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      expect(Option.getOrNull(HashMap.get(state.availableUtxos, utxoHash(a)))).toEqual(a);
      expect(Option.getOrNull(HashMap.get(state.availableUtxos, utxoHash(b)))).toEqual(b);
      expect(HashMap.size(state.availableUtxos)).toEqual(2);
    });

    it('does not re-admit a created utxo that is currently pending (replay of the creating tx)', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-replay', outputNo: 0 });
      const created: UnshieldedUpdate = { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' };

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, created),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
        // A resync from an earlier cursor delivers the creating transaction again while `u` is still booked.
        (s) => UnshieldedState.applyUpdate(s, created),
        getOrThrow,
      );

      expect(HashMap.has(state.availableUtxos, utxoHash(u))).toBe(false);
      expect(Option.getOrNull(HashMap.get(state.pendingUtxos, utxoHash(u)))).toEqual(pendingAt(u));
      expect(HashMap.size(state.availableUtxos)).toEqual(0);
      expect(HashMap.size(state.pendingUtxos)).toEqual(1);
    });

    it('still admits the other created utxos of an update that replays a pending one', () => {
      const pending = generateMockUtxoWithMeta({ intentHash: 'h-mixed', outputNo: 0 });
      const fresh = generateMockUtxoWithMeta({ intentHash: 'h-mixed', outputNo: 1 });

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [pending], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, pending, TTL),
        getOrThrow,
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [pending, fresh], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
      );

      expect([...HashMap.keys(state.availableUtxos)]).toEqual([utxoHash(fresh)]);
      expect([...HashMap.keys(state.pendingUtxos)]).toEqual([utxoHash(pending)]);
    });
  });

  describe('applyFailedUpdate', () => {
    it('should apply a failed update (restore spent utxos)', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);
      const utxoToSpend = update.createdUtxos[0];

      const failedUpdate: UnshieldedUpdate = {
        createdUtxos: [],
        spentUtxos: [utxoToSpend],
        status: 'FAILURE',
      };

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, utxoToSpend, TTL),
        getOrThrow,
        (s) => UnshieldedState.applyFailedUpdate(s, failedUpdate),
        getOrThrow,
      );

      expect(HashMap.size(state.availableUtxos)).toEqual(1);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('should reject applying failed update with wrong status', () => {
      const result = pipe(UnshieldedState.empty(), (s) =>
        UnshieldedState.applyFailedUpdate(s, generateMockUpdate('SUCCESS', 0, 1)),
      );

      expect(Either.isLeft(result)).toBe(true);
    });

    it('should restore spent utxo to availableUtxos AND remove it from pendingUtxos', () => {
      // Two-utxo setup: spend A, leave B available. After applyFailedUpdate(A),
      // available should contain BOTH A and B, pending should be empty.
      const a = generateMockUtxoWithMeta({ intentHash: 'h-a', outputNo: 0 });
      const b = generateMockUtxoWithMeta({ intentHash: 'h-b', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [a, b],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, a, TTL),
        getOrThrow,
        // sanity
        (s) => {
          expect(HashMap.has(s.pendingUtxos, utxoHash(a))).toBe(true);
          expect(HashMap.has(s.availableUtxos, utxoHash(a))).toBe(false);
          expect(HashMap.has(s.availableUtxos, utxoHash(b))).toBe(true);
          return s;
        },
        (s) =>
          UnshieldedState.applyFailedUpdate(s, {
            createdUtxos: [],
            spentUtxos: [a],
            status: 'FAILURE',
          }),
        getOrThrow,
      );

      expect(HashMap.has(after.availableUtxos, utxoHash(a))).toBe(true);
      expect(HashMap.has(after.availableUtxos, utxoHash(b))).toBe(true);
      expect(HashMap.size(after.availableUtxos)).toEqual(2);
      expect(HashMap.has(after.pendingUtxos, utxoHash(a))).toBe(false);
      expect(HashMap.size(after.pendingUtxos)).toEqual(0);
    });

    it('should reject PARTIAL_SUCCESS status (only FAILURE is valid)', () => {
      const result = UnshieldedState.applyFailedUpdate(UnshieldedState.empty(), {
        createdUtxos: [],
        spentUtxos: [],
        status: 'PARTIAL_SUCCESS',
      });

      expect(Either.isLeft(result)).toBe(true);
    });

    it('should be a no-op for spentUtxos not present in pendingUtxos', () => {
      const present = generateMockUtxoWithMeta({ intentHash: 'h-present', outputNo: 0 });
      const ghost = generateMockUtxoWithMeta({ intentHash: 'h-ghost', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [present],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) =>
          UnshieldedState.applyFailedUpdate(s, {
            createdUtxos: [],
            spentUtxos: [ghost],
            status: 'FAILURE',
          }),
        getOrThrow,
      );
      expect(HashMap.has(after.availableUtxos, utxoHash(present))).toBe(true);
      expect(HashMap.has(after.availableUtxos, utxoHash(ghost))).toBe(true);
      expect(HashMap.size(after.pendingUtxos)).toEqual(0);
    });
  });

  describe('spend / spendByUtxo', () => {
    it('should spend a utxo', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, update.createdUtxos[0], TTL),
        getOrThrow,
      );

      expect(HashMap.size(state.availableUtxos)).toEqual(0);
      expect(HashMap.size(state.pendingUtxos)).toEqual(1);
    });

    it('should fail to spend a utxo that does not exist', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);

      const result = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, generateMockUtxoWithMeta({ owner: 'owner21', type: 'type12' }), TTL),
      );

      expect(Either.isLeft(result)).toBe(true);
      pipe(
        result,
        Either.mapLeft((e) => expect(e).toBeInstanceOf(UtxoNotFoundError)),
      );
    });

    it('should spend by utxo (ledger.Utxo)', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spendByUtxo(s, update.createdUtxos[0].utxo, TTL),
        getOrThrow,
      );

      expect(HashMap.size(state.availableUtxos)).toEqual(0);
      expect(HashMap.size(state.pendingUtxos)).toEqual(1);
    });

    it('should fail to spendByUtxo with UtxoNotFoundError when utxo is not available', () => {
      const ghost = generateMockUtxoWithMeta({ intentHash: 'h-ghost', outputNo: 0 });

      const result = UnshieldedState.spendByUtxo(UnshieldedState.empty(), ghost.utxo, TTL);

      expect(Either.isLeft(result)).toBe(true);
      pipe(
        result,
        Either.mapLeft((e) => {
          expect(e).toBeInstanceOf(UtxoNotFoundError);
          // The error should carry the input utxo so callers can report which one was missing.
          expect(e.utxo).toEqual(ghost.utxo);
        }),
      );
    });
  });

  describe('rollbackSpend / rollbackSpendByUtxo', () => {
    it('should rollback a spend', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);
      const utxoToSpend = update.createdUtxos[0];

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, utxoToSpend, TTL),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpend(s, utxoToSpend),
        getOrThrow,
      );

      expect(HashMap.size(state.availableUtxos)).toEqual(1);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('should rollback spend by utxo (ledger.Utxo)', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);
      const utxoToSpend = update.createdUtxos[0];

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, utxoToSpend, TTL),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpendByUtxo(s, utxoToSpend.utxo),
        getOrThrow,
      );

      expect(HashMap.size(state.availableUtxos)).toEqual(1);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('should not throw when rollbackSpendByUtxo is called twice', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);
      const utxoToSpend = update.createdUtxos[0];

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, utxoToSpend, TTL),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpendByUtxo(s, utxoToSpend.utxo),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpendByUtxo(s, utxoToSpend.utxo),
        getOrThrow,
      );

      expect(HashMap.size(state.availableUtxos)).toEqual(1);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });
  });

  describe('booking expiry', () => {
    const seedAvailable = (...utxos: readonly UtxoWithMeta[]): UnshieldedState =>
      pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: utxos, spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
      );

    it('records the expiry the booking was taken with, alongside the coin', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-ttl', outputNo: 0 });

      const state = pipe(seedAvailable(u), (s) => UnshieldedState.spend(s, u, TTL), getOrThrow);

      expect(Option.getOrNull(HashMap.get(state.pendingUtxos, utxoHash(u)))).toEqual({ utxo: u, ttl: TTL });
    });

    it('records the expiry when booking by ledger utxo', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-ttl-by-utxo', outputNo: 0 });

      const state = pipe(seedAvailable(u), (s) => UnshieldedState.spendByUtxo(s, u.utxo, TTL), getOrThrow);

      expect(Option.getOrNull(HashMap.get(state.pendingUtxos, utxoHash(u)))).toEqual({ utxo: u, ttl: TTL });
    });

    it('releases a booking whose expiry has passed, coin and meta intact', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-expired', outputNo: 0 });

      const state = pipe(
        seedAvailable(u),
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
        (s) => UnshieldedState.expirePending(s, new Date(TTL.getTime() + 1)),
      );

      expect(Option.getOrNull(HashMap.get(state.availableUtxos, utxoHash(u)))).toEqual(u);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('releases a booking at exactly its expiry, since the ledger rejects the transaction from that instant', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-boundary', outputNo: 0 });

      const state = pipe(
        seedAvailable(u),
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
        (s) => UnshieldedState.expirePending(s, TTL),
      );

      expect(HashMap.has(state.availableUtxos, utxoHash(u))).toBe(true);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('keeps a booking one millisecond before its expiry', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-not-yet', outputNo: 0 });

      const state = pipe(
        seedAvailable(u),
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
        (s) => UnshieldedState.expirePending(s, new Date(TTL.getTime() - 1)),
      );

      expect(HashMap.has(state.availableUtxos, utxoHash(u))).toBe(false);
      expect(Option.getOrNull(HashMap.get(state.pendingUtxos, utxoHash(u)))).toEqual({ utxo: u, ttl: TTL });
    });

    it('releases only the bookings that have expired', () => {
      const early = generateMockUtxoWithMeta({ intentHash: 'h-early', outputNo: 0 });
      const late = generateMockUtxoWithMeta({ intentHash: 'h-late', outputNo: 0 });
      const earlyTtl = new Date('2026-01-01T00:30:00.000Z');
      const lateTtl = new Date('2026-01-01T02:00:00.000Z');

      const state = pipe(
        seedAvailable(early, late),
        (s) => UnshieldedState.spend(s, early, earlyTtl),
        getOrThrow,
        (s) => UnshieldedState.spend(s, late, lateTtl),
        getOrThrow,
        (s) => UnshieldedState.expirePending(s, new Date('2026-01-01T01:00:00.000Z')),
      );

      expect([...HashMap.keys(state.availableUtxos)]).toEqual([utxoHash(early)]);
      expect([...HashMap.keys(state.pendingUtxos)]).toEqual([utxoHash(late)]);
    });

    it('is a no-op when nothing is booked', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-none-booked', outputNo: 0 });
      const seeded = seedAvailable(u);

      const state = UnshieldedState.expirePending(seeded, new Date(TTL.getTime() + 1));

      expect([...HashMap.keys(state.availableUtxos)]).toEqual([utxoHash(u)]);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });

    it('releases a booking restored from a snapshot written before bookings carried an expiry', () => {
      // Such a snapshot decodes with an expiry at the epoch, so the first sweep releases it.
      const u = generateMockUtxoWithMeta({ intentHash: 'h-legacy', outputNo: 0 });

      const state = pipe(UnshieldedState.restore([], [pendingAt(u, new Date(0))]), (s) =>
        UnshieldedState.expirePending(s, new Date(TTL.getTime())),
      );

      expect(HashMap.has(state.availableUtxos, utxoHash(u))).toBe(true);
      expect(HashMap.size(state.pendingUtxos)).toEqual(0);
    });
  });

  describe('restore / toArrays', () => {
    it('should restore state from arrays', () => {
      const utxo1 = generateMockUtxoWithMeta({ owner: 'owner1', type: 'type1' });
      const utxo2 = generateMockUtxoWithMeta({ owner: 'owner2', type: 'type2' });
      const pendingUtxo = generateMockUtxoWithMeta({ owner: 'owner3', type: 'type3' });

      const state = UnshieldedState.restore([utxo1, utxo2], [pendingAt(pendingUtxo)]);

      expect(HashMap.size(state.availableUtxos)).toEqual(2);
      expect(HashMap.size(state.pendingUtxos)).toEqual(1);
    });

    it('should convert state to arrays', () => {
      const utxo1 = generateMockUtxoWithMeta({ owner: 'owner1', type: 'type1' });
      const utxo2 = generateMockUtxoWithMeta({ owner: 'owner2', type: 'type2' });
      const pendingUtxo = generateMockUtxoWithMeta({ owner: 'owner3', type: 'type3' });

      const arrays = pipe(UnshieldedState.restore([utxo1, utxo2], [pendingAt(pendingUtxo)]), UnshieldedState.toArrays);

      expect(arrays.availableUtxos.length).toEqual(2);
      expect(arrays.pendingUtxos.length).toEqual(1);
    });

    it('drops a utxo present in both arrays, keeping the pending side (repairs a corrupted snapshot)', () => {
      const duplicated = generateMockUtxoWithMeta({ intentHash: 'h-dup', outputNo: 0 });
      const onlyAvailable = generateMockUtxoWithMeta({ intentHash: 'h-avail', outputNo: 0 });

      const state = UnshieldedState.restore([onlyAvailable, duplicated], [pendingAt(duplicated)]);

      expect([...HashMap.keys(state.availableUtxos)]).toEqual([utxoHash(onlyAvailable)]);
      expect(Option.getOrNull(HashMap.get(state.pendingUtxos, utxoHash(duplicated)))).toEqual(pendingAt(duplicated));
      expect(HashMap.size(state.pendingUtxos)).toEqual(1);
    });

    it('restore always yields disjoint maps, whatever overlap the arrays carry', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(utxoArb, { maxLength: 6, selector: utxoHash }),
          fc.array(fc.nat(2), { maxLength: 6 }),
          (utxos, placements) => {
            // 0 = available only, 1 = pending only, 2 = both (the shape a corrupted snapshot carries).
            const available = utxos.filter((_, i) => (placements[i] ?? 0) !== 1);
            const pending = utxos.filter((_, i) => (placements[i] ?? 0) !== 0);

            const state = UnshieldedState.restore(
              available,
              pending.map((u) => pendingAt(u)),
            );

            const availableKeys = new Set(HashMap.keys(state.availableUtxos));
            const pendingKeys = [...HashMap.keys(state.pendingUtxos)];
            expect(pendingKeys.some((k) => availableKeys.has(k))).toBe(false);
            expect(HashMap.size(state.availableUtxos) + HashMap.size(state.pendingUtxos)).toEqual(utxos.length);
            expect(pendingKeys.toSorted()).toEqual(pending.map(utxoHash).toSorted());
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('lifecycle sequences', () => {
    it('happy path: create → spend → confirm leaves both collections empty', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-life', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [u],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [],
            spentUtxos: [u],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      expect(HashMap.size(after.availableUtxos)).toEqual(0);
      expect(HashMap.size(after.pendingUtxos)).toEqual(0);
    });

    it('failure path: spend → applyFailedUpdate makes utxo re-spendable', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-fail', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [u],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
        (s) =>
          UnshieldedState.applyFailedUpdate(s, {
            createdUtxos: [],
            spentUtxos: [u],
            status: 'FAILURE',
          }),
        getOrThrow,
        // re-spend should succeed
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
      );

      expect(HashMap.has(after.pendingUtxos, utxoHash(u))).toBe(true);
      expect(HashMap.has(after.availableUtxos, utxoHash(u))).toBe(false);
    });

    it('rollback path: spend → rollbackSpend makes utxo re-spendable', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-rb', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [u],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpend(s, u),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, TTL),
        getOrThrow,
      );

      expect(HashMap.has(after.pendingUtxos, utxoHash(u))).toBe(true);
      expect(HashMap.size(after.availableUtxos)).toEqual(0);
    });

    it('reorg shape: applyUpdate(A) → applyUpdate(B) → applyFailedUpdate(B) leaves A intact', () => {
      const a = generateMockUtxoWithMeta({ intentHash: 'h-A', outputNo: 0 });
      const b = generateMockUtxoWithMeta({ intentHash: 'h-B', outputNo: 0 });

      // First A is created and confirmed spent (so it's gone).
      // Then B is created, spent, and then the spend fails — B should come back.
      // A should be unaffected throughout.
      const seeded = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [a, b],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      const after = pipe(
        UnshieldedState.spend(seeded, b, TTL),
        getOrThrow,
        (s) =>
          UnshieldedState.applyFailedUpdate(s, {
            createdUtxos: [],
            spentUtxos: [b],
            status: 'FAILURE',
          }),
        getOrThrow,
      );

      expect(HashMap.has(after.availableUtxos, utxoHash(a))).toBe(true);
      expect(HashMap.has(after.availableUtxos, utxoHash(b))).toBe(true);
      expect(HashMap.size(after.availableUtxos)).toEqual(2);
      expect(HashMap.size(after.pendingUtxos)).toEqual(0);
    });

    it('pending cleanup is keyed by hash, not order', () => {
      // Spend two utxos in order [a, b]. Confirm with spentUtxos in REVERSE order [b, a].
      // Both must be removed from pending; result should not depend on input order.
      const a = generateMockUtxoWithMeta({ intentHash: 'h-pa', outputNo: 0 });
      const b = generateMockUtxoWithMeta({ intentHash: 'h-pb', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [a, b],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, a, TTL),
        getOrThrow,
        (s) => UnshieldedState.spend(s, b, TTL),
        getOrThrow,
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [],
            spentUtxos: [b, a],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      expect(HashMap.size(after.pendingUtxos)).toEqual(0);
      expect(HashMap.size(after.availableUtxos)).toEqual(0);
    });
  });

  describe('invariants (property-based)', () => {
    // Operations the property tests will randomly compose against valid state.
    type Op =
      | { tag: 'spend'; utxo: UtxoWithMeta }
      | { tag: 'rollback'; utxo: UtxoWithMeta }
      | { tag: 'confirm'; utxo: UtxoWithMeta }
      | { tag: 'fail'; utxo: UtxoWithMeta }
      | { tag: 'replay'; utxo: UtxoWithMeta }
      | { tag: 'expire'; utxo: UtxoWithMeta };

    // Apply an operation, ignoring failures (e.g. spending a missing utxo).
    // The point of these invariants is that *valid* operations preserve them;
    // we silently skip ops the state can't accept.
    const applyOp = (state: UnshieldedState, op: Op): UnshieldedState => {
      const result: Either.Either<UnshieldedState, unknown> = (() => {
        switch (op.tag) {
          case 'spend':
            return UnshieldedState.spend(state, op.utxo, TTL);
          case 'rollback':
            return UnshieldedState.rollbackSpend(state, op.utxo);
          case 'confirm':
            return UnshieldedState.applyUpdate(state, {
              createdUtxos: [],
              spentUtxos: [op.utxo],
              status: 'SUCCESS',
            });
          case 'fail':
            return UnshieldedState.applyFailedUpdate(state, {
              createdUtxos: [],
              spentUtxos: [op.utxo],
              status: 'FAILURE',
            });
          case 'replay':
            // The indexer re-delivers the transaction that created the utxo (resync from an earlier cursor).
            return UnshieldedState.applyUpdate(state, {
              createdUtxos: [op.utxo],
              spentUtxos: [],
              status: 'SUCCESS',
            });
          case 'expire':
            // A sweep past the expiry every booking here was taken with.
            return Either.right(UnshieldedState.expirePending(state, new Date(TTL.getTime() + 1)));
        }
      })();
      return Either.match(result, {
        onLeft: () => state,
        onRight: (s) => s,
      });
    };

    it('available and pending keys never intersect after any operation sequence', () => {
      fc.assert(
        fc.property(
          fc.array(utxoArb, { minLength: 1, maxLength: 5 }),
          fc.array(fc.nat(5), { maxLength: 20 }),
          (utxos, opTags) => {
            // Seed state with all utxos available.
            const initial = pipe(
              UnshieldedState.empty(),
              (s) =>
                UnshieldedState.applyUpdate(s, {
                  createdUtxos: utxos,
                  spentUtxos: [],
                  status: 'SUCCESS',
                }),
              getOrThrow,
            );

            // Build random op sequence over the seeded utxos.
            const ops: readonly Op[] = opTags.map((tagIdx, i) => {
              const utxo = utxos[i % utxos.length];
              switch (tagIdx) {
                case 0:
                  return { tag: 'spend', utxo };
                case 1:
                  return { tag: 'rollback', utxo };
                case 2:
                  return { tag: 'confirm', utxo };
                case 3:
                  return { tag: 'fail', utxo };
                case 4:
                  return { tag: 'replay', utxo };
                default:
                  return { tag: 'expire', utxo };
              }
            });

            const finalState = ops.reduce(applyOp, initial);

            const availableKeys = new Set(HashMap.keys(finalState.availableUtxos));
            const pendingKeys = [...HashMap.keys(finalState.pendingUtxos)];
            const hasOverlap = pendingKeys.some((k) => availableKeys.has(k));
            expect(hasOverlap).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rollbackSpend ∘ spend = identity when utxo is available', () => {
      fc.assert(
        fc.property(utxoArb, (u) => {
          const seeded = pipe(
            UnshieldedState.empty(),
            (s) =>
              UnshieldedState.applyUpdate(s, {
                createdUtxos: [u],
                spentUtxos: [],
                status: 'SUCCESS',
              }),
            getOrThrow,
          );

          const roundTripped = pipe(
            UnshieldedState.spend(seeded, u, TTL),
            getOrThrow,
            (s) => UnshieldedState.rollbackSpend(s, u),
            getOrThrow,
          );

          expect(HashMap.has(roundTripped.availableUtxos, utxoHash(u))).toBe(true);
          expect(HashMap.has(roundTripped.pendingUtxos, utxoHash(u))).toBe(false);
          expect(HashMap.size(roundTripped.availableUtxos)).toEqual(HashMap.size(seeded.availableUtxos));
          expect(HashMap.size(roundTripped.pendingUtxos)).toEqual(HashMap.size(seeded.pendingUtxos));
        }),
        { numRuns: 50 },
      );
    });

    it('applyFailedUpdate ∘ spend = identity for the spent utxo', () => {
      fc.assert(
        fc.property(utxoArb, (u) => {
          const seeded = pipe(
            UnshieldedState.empty(),
            (s) =>
              UnshieldedState.applyUpdate(s, {
                createdUtxos: [u],
                spentUtxos: [],
                status: 'SUCCESS',
              }),
            getOrThrow,
          );

          const roundTripped = pipe(
            UnshieldedState.spend(seeded, u, TTL),
            getOrThrow,
            (s) =>
              UnshieldedState.applyFailedUpdate(s, {
                createdUtxos: [],
                spentUtxos: [u],
                status: 'FAILURE',
              }),
            getOrThrow,
          );

          expect(HashMap.has(roundTripped.availableUtxos, utxoHash(u))).toBe(true);
          expect(HashMap.has(roundTripped.pendingUtxos, utxoHash(u))).toBe(false);
          expect(HashMap.size(roundTripped.availableUtxos)).toEqual(HashMap.size(seeded.availableUtxos));
          expect(HashMap.size(roundTripped.pendingUtxos)).toEqual(HashMap.size(seeded.pendingUtxos));
        }),
        { numRuns: 50 },
      );
    });
  });
});
