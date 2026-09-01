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
import { UnshieldedState, type UnshieldedUpdate, type UtxoWithMeta } from '../UnshieldedState.js';
import { UtxoNotFoundError } from '../WalletError.js';
import { defaultTestBooking, generateMockUpdate, generateMockUtxoWithMeta, utxoArb, utxoHash } from './testUtils.js';

const getOrThrow = <E, A>(either: Either.Either<A, E>): A =>
  pipe(
    either,
    Either.getOrThrowWith((e) => new Error(`Unexpected error: ${JSON.stringify(e)}`)),
  );

describe('UnshieldedState', () => {
  describe('applyUpdate', () => {
    it('should apply a successful update', () => {
      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, generateMockUpdate('SUCCESS', 1, 0)),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
    });

    it('should apply update with multiple created outputs', () => {
      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, generateMockUpdate('SUCCESS', 3, 0)),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(3);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
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

      expect(HashMap.has(UnshieldedState.availableUtxos(state), utxoHash(created))).toBe(true);
      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
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

      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(created))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(existing))).toBe(false);
      expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(0);
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
        (s) => UnshieldedState.spend(s, u, defaultTestBooking),
        getOrThrow,
        (s) => {
          expect(HashMap.has(UnshieldedState.pendingUtxos(s), utxoHash(u))).toBe(true);
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

      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(u))).toBe(false);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(u))).toBe(false);
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

      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(seed))).toBe(true);
      expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(0);
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

      expect(HashMap.has(UnshieldedState.availableUtxos(state), utxoHash(present))).toBe(true);
      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
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

      expect(Option.getOrNull(HashMap.get(UnshieldedState.availableUtxos(state), utxoHash(a)))).toEqual(a);
      expect(Option.getOrNull(HashMap.get(UnshieldedState.availableUtxos(state), utxoHash(b)))).toEqual(b);
      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(2);
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
        (s) => UnshieldedState.spend(s, utxoToSpend, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.applyFailedUpdate(s, failedUpdate),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
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
        (s) => UnshieldedState.spend(s, a, defaultTestBooking),
        getOrThrow,
        // sanity
        (s) => {
          expect(HashMap.has(UnshieldedState.pendingUtxos(s), utxoHash(a))).toBe(true);
          expect(HashMap.has(UnshieldedState.availableUtxos(s), utxoHash(a))).toBe(false);
          expect(HashMap.has(UnshieldedState.availableUtxos(s), utxoHash(b))).toBe(true);
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

      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(a))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(b))).toBe(true);
      expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(2);
      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(a))).toBe(false);
      expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(0);
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
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(present))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(ghost))).toBe(true);
      expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(0);
    });
  });

  describe('spend / spendByUtxo', () => {
    it('should spend a utxo', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, update.createdUtxos[0], defaultTestBooking),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(0);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(1);
    });

    it('should fail to spend a utxo that does not exist', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);

      const result = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) =>
          UnshieldedState.spend(s, generateMockUtxoWithMeta({ owner: 'owner21', type: 'type12' }), defaultTestBooking),
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
        (s) => UnshieldedState.spendByUtxo(s, update.createdUtxos[0].utxo, defaultTestBooking),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(0);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(1);
    });

    it('should fail to spendByUtxo with UtxoNotFoundError when utxo is not available', () => {
      const ghost = generateMockUtxoWithMeta({ intentHash: 'h-ghost', outputNo: 0 });

      const result = UnshieldedState.spendByUtxo(UnshieldedState.empty(), ghost.utxo, defaultTestBooking);

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
        (s) => UnshieldedState.spend(s, utxoToSpend, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpend(s, utxoToSpend),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
    });

    it('should rollback spend by utxo (ledger.Utxo)', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);
      const utxoToSpend = update.createdUtxos[0];

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, utxoToSpend, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpendByUtxo(s, utxoToSpend.utxo),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
    });

    it('should not throw when rollbackSpendByUtxo is called twice', () => {
      const update = generateMockUpdate('SUCCESS', 1, 0);
      const utxoToSpend = update.createdUtxos[0];

      const state = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, update),
        getOrThrow,
        (s) => UnshieldedState.spend(s, utxoToSpend, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpendByUtxo(s, utxoToSpend.utxo),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpendByUtxo(s, utxoToSpend.utxo),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
    });
  });

  describe('restore / toArrays', () => {
    it('should restore state from arrays', () => {
      const utxo1 = generateMockUtxoWithMeta({ owner: 'owner1', type: 'type1' });
      const utxo2 = generateMockUtxoWithMeta({ owner: 'owner2', type: 'type2' });
      const pendingUtxo = generateMockUtxoWithMeta({ owner: 'owner3', type: 'type3' });

      // Both arrays are coins the wallet owns. The split the snapshot recorded is not restored: a booking belongs to
      // the process that took it, and that process is gone (ADR 0008).
      const state = UnshieldedState.restore([utxo1, utxo2], [pendingUtxo]);

      expect(HashMap.size(UnshieldedState.availableUtxos(state))).toEqual(3);
      expect(HashMap.size(UnshieldedState.pendingUtxos(state))).toEqual(0);
    });

    it('should convert state to arrays', () => {
      const utxo1 = generateMockUtxoWithMeta({ owner: 'owner1', type: 'type1' });
      const utxo2 = generateMockUtxoWithMeta({ owner: 'owner2', type: 'type2' });
      const pendingUtxo = generateMockUtxoWithMeta({ owner: 'owner3', type: 'type3' });

      // restore takes no bookings, so every restored coin is available — including the one the snapshot had recorded as
      // pending. See ADR 0008.
      const arrays = pipe(UnshieldedState.restore([utxo1, utxo2], [pendingUtxo]), UnshieldedState.toArrays);

      expect(arrays.availableUtxos.length).toEqual(3);
      expect(arrays.pendingUtxos.length).toEqual(0);
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
        (s) => UnshieldedState.spend(s, u, defaultTestBooking),
        getOrThrow,
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [],
            spentUtxos: [u],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(0);
      expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(0);
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
        (s) => UnshieldedState.spend(s, u, defaultTestBooking),
        getOrThrow,
        (s) =>
          UnshieldedState.applyFailedUpdate(s, {
            createdUtxos: [],
            spentUtxos: [u],
            status: 'FAILURE',
          }),
        getOrThrow,
        // re-spend should succeed
        (s) => UnshieldedState.spend(s, u, defaultTestBooking),
        getOrThrow,
      );

      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(u))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(u))).toBe(false);
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
        (s) => UnshieldedState.spend(s, u, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpend(s, u),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, defaultTestBooking),
        getOrThrow,
      );

      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(u))).toBe(true);
      expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(0);
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
        UnshieldedState.spend(seeded, b, defaultTestBooking),
        getOrThrow,
        (s) =>
          UnshieldedState.applyFailedUpdate(s, {
            createdUtxos: [],
            spentUtxos: [b],
            status: 'FAILURE',
          }),
        getOrThrow,
      );

      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(a))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(b))).toBe(true);
      expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(2);
      expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(0);
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
        (s) => UnshieldedState.spend(s, a, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.spend(s, b, defaultTestBooking),
        getOrThrow,
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [],
            spentUtxos: [b, a],
            status: 'SUCCESS',
          }),
        getOrThrow,
      );

      expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(0);
      expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(0);
    });
  });

  describe('invariants (property-based)', () => {
    // Operations the property tests will randomly compose against valid state.
    type Op =
      | { tag: 'spend'; utxo: UtxoWithMeta }
      | { tag: 'rollback'; utxo: UtxoWithMeta }
      | { tag: 'confirm'; utxo: UtxoWithMeta }
      | { tag: 'fail'; utxo: UtxoWithMeta };

    // Apply an operation, ignoring failures (e.g. spending a missing utxo).
    // The point of these invariants is that *valid* operations preserve them;
    // we silently skip ops the state can't accept.
    const applyOp = (state: UnshieldedState, op: Op): UnshieldedState => {
      const result: Either.Either<UnshieldedState, unknown> = (() => {
        switch (op.tag) {
          case 'spend':
            return UnshieldedState.spend(state, op.utxo, defaultTestBooking);
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
          fc.array(fc.nat(3), { maxLength: 20 }),
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
                default:
                  return { tag: 'fail', utxo };
              }
            });

            const finalState = ops.reduce(applyOp, initial);

            const availableKeys = new Set(HashMap.keys(UnshieldedState.availableUtxos(finalState)));
            const pendingKeys = [...HashMap.keys(UnshieldedState.pendingUtxos(finalState))];
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
            UnshieldedState.spend(seeded, u, defaultTestBooking),
            getOrThrow,
            (s) => UnshieldedState.rollbackSpend(s, u),
            getOrThrow,
          );

          expect(HashMap.has(UnshieldedState.availableUtxos(roundTripped), utxoHash(u))).toBe(true);
          expect(HashMap.has(UnshieldedState.pendingUtxos(roundTripped), utxoHash(u))).toBe(false);
          expect(HashMap.size(UnshieldedState.availableUtxos(roundTripped))).toEqual(
            HashMap.size(UnshieldedState.availableUtxos(seeded)),
          );
          expect(HashMap.size(UnshieldedState.pendingUtxos(roundTripped))).toEqual(
            HashMap.size(UnshieldedState.pendingUtxos(seeded)),
          );
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
            UnshieldedState.spend(seeded, u, defaultTestBooking),
            getOrThrow,
            (s) =>
              UnshieldedState.applyFailedUpdate(s, {
                createdUtxos: [],
                spentUtxos: [u],
                status: 'FAILURE',
              }),
            getOrThrow,
          );

          expect(HashMap.has(UnshieldedState.availableUtxos(roundTripped), utxoHash(u))).toBe(true);
          expect(HashMap.has(UnshieldedState.pendingUtxos(roundTripped), utxoHash(u))).toBe(false);
          expect(HashMap.size(UnshieldedState.availableUtxos(roundTripped))).toEqual(
            HashMap.size(UnshieldedState.availableUtxos(seeded)),
          );
          expect(HashMap.size(UnshieldedState.pendingUtxos(roundTripped))).toEqual(
            HashMap.size(UnshieldedState.pendingUtxos(seeded)),
          );
        }),
        { numRuns: 50 },
      );
    });
  });

  // `availableUtxos` and `pendingUtxos` are disjoint by construction — `spend` moves a UTxO from one to the other, and
  // every balance accessor sums the two maps independently. A UTxO present in both is therefore counted twice, so the
  // wallet reports double its real balance while coin selection (which reads available only, minus bookings) still
  // finds nothing to spend.
  describe('disjointness of availableUtxos and pendingUtxos', () => {
    const isDisjoint = (state: UnshieldedState): boolean =>
      pipe(HashMap.keys(UnshieldedState.availableUtxos(state)), (keys) =>
        Array.from(keys).every((hash) => !HashMap.has(UnshieldedState.pendingUtxos(state), hash)),
      );

    it('applyUpdate does not re-add a created utxo that is currently booked', () => {
      // The indexer subscription replays whole transactions from the wallet's cursor, so the transaction that CREATED
      // a booked UTxO can arrive again after the booking. Re-adding it to available would duplicate it.
      const u = generateMockUtxoWithMeta({ intentHash: 'h-replay', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, defaultTestBooking),
        getOrThrow,
        // the replay: the same creating transaction is delivered a second time
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
      );

      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(u))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(u))).toBe(false);
      expect(isDisjoint(after)).toBe(true);
    });

    it('applyUpdate still adds created utxos that are not booked', () => {
      // The guard must reject only the booked hash — an unrelated UTxO in the same update still lands in available.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-booked', outputNo: 0 });
      const fresh = generateMockUtxoWithMeta({ intentHash: 'h-fresh', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [booked], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, booked, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [booked, fresh], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
      );

      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(fresh))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(booked))).toBe(false);
      expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(1);
      expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(1);
    });

    it('applyUpdate un-books a created utxo that the same update also reports as spent', () => {
      // A transaction that spends the booked UTxO and pays change back to us must clear the booking (spentUtxos wins)
      // and admit the change output. This pins the order of the two operations.
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-consumed', outputNo: 0 });
      const change = generateMockUtxoWithMeta({ intentHash: 'h-change', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [booked], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, booked, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [change], spentUtxos: [booked], status: 'SUCCESS' }),
        getOrThrow,
      );

      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(booked))).toBe(false);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(booked))).toBe(false);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(change))).toBe(true);
      expect(isDisjoint(after)).toBe(true);
    });

    it('restore repairs an already-persisted state holding one utxo in both maps', () => {
      // Snapshots written by a version that stored bookings carry the duplicate forever: nothing on the restore path
      // removed it, so deleting the persisted state was the only recovery. Unioning the two arrays into one map keyed
      // by hash collapses it, and with no booking restored the coin is spendable again.
      const duplicated = generateMockUtxoWithMeta({ intentHash: 'h-persisted', outputNo: 0 });
      const clean = generateMockUtxoWithMeta({ intentHash: 'h-clean', outputNo: 0 });

      const state = UnshieldedState.restore([duplicated, clean], [duplicated]);

      expect(HashMap.size(state.utxos)).toEqual(2);
      expect(HashMap.has(UnshieldedState.availableUtxos(state), utxoHash(duplicated))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(state), utxoHash(clean))).toBe(true);
      expect(isDisjoint(state)).toBe(true);
    });

    it('the reported total balance never counts a booked utxo twice', () => {
      // The user-visible symptom: 6,000 displayed against 3,000 on chain.
      const u = generateMockUtxoWithMeta({ intentHash: 'h-balance', outputNo: 0, value: 3000n, type: 'night' });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
      );

      const { availableUtxos, pendingUtxos } = UnshieldedState.toArrays(after);
      const total = [...availableUtxos, ...pendingUtxos].reduce((sum, { utxo }) => sum + utxo.value, 0n);

      expect(total).toEqual(3000n);
    });

    it('stays disjoint for any interleaving of spends and update replays', () => {
      fc.assert(
        fc.property(fc.array(utxoArb, { minLength: 1, maxLength: 8 }), (utxos) => {
          const seeded = pipe(
            UnshieldedState.empty(),
            (s) => UnshieldedState.applyUpdate(s, { createdUtxos: utxos, spentUtxos: [], status: 'SUCCESS' }),
            getOrThrow,
          );

          // book every other UTxO, then replay the creating update in full
          const booked = utxos.filter((_, i) => i % 2 === 0);
          const afterBooking = booked.reduce(
            (state, u) => getOrThrow(UnshieldedState.spend(state, u, defaultTestBooking)),
            seeded,
          );
          const afterReplay = getOrThrow(
            UnshieldedState.applyUpdate(afterBooking, { createdUtxos: utxos, spentUtxos: [], status: 'SUCCESS' }),
          );

          expect(isDisjoint(afterReplay)).toBe(true);
          expect(
            HashMap.size(UnshieldedState.availableUtxos(afterReplay)) +
              HashMap.size(UnshieldedState.pendingUtxos(afterReplay)),
          ).toEqual(utxos.length);
        }),
        { numRuns: 50 },
      );
    });
  });

  // Inputs are booked during balancing, not submission, and the only paths that release a booking are downstream of
  // submission. A failure in between — proving fails, or the process dies — leaves the booking outstanding forever:
  // the UTxO is unspendable and no resync clears it. A booking therefore carries the TTL of the transaction it was
  // taken for; one that outlives that TTL cannot still be valid, because the ledger would reject the transaction.
  describe('booking expiry', () => {
    const expiresAt = new Date('2026-01-01T01:00:00.000Z');
    const booking = { expiresAt };

    it('spend records the booking on the pending entry', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-book', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, booking),
        getOrThrow,
      );

      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(u))).toBe(true);
      expect(Option.getOrNull(HashMap.get(after.bookings, utxoHash(u)))).toEqual(booking);
    });

    it('expireBookings leaves a booking that has not yet expired', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-live', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, booking),
        getOrThrow,
        (s) => UnshieldedState.expireBookings(s, new Date('2026-01-01T00:59:59.999Z')),
      );

      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(u))).toBe(true);
      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(u))).toBe(false);
    });

    it('expireBookings releases a booking at its expiry instant', () => {
      // Expiry is inclusive: at expiresAt the transaction is no longer valid on chain, so neither is the booking.
      const u = generateMockUtxoWithMeta({ intentHash: 'h-boundary', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, booking),
        getOrThrow,
        (s) => UnshieldedState.expireBookings(s, expiresAt),
      );

      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(u))).toBe(true);
      expect(HashMap.has(UnshieldedState.pendingUtxos(after), utxoHash(u))).toBe(false);
    });

    it('expireBookings clears the booking metadata on the released utxo', () => {
      // A released UTxO is spendable again, so it must not still advertise a booking to the new bookings API.
      const u = generateMockUtxoWithMeta({ intentHash: 'h-cleared', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, booking),
        getOrThrow,
        (s) => UnshieldedState.expireBookings(s, new Date('2026-01-01T02:00:00.000Z')),
      );

      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(u))).toBe(true);
      expect(HashMap.has(after.bookings, utxoHash(u))).toBe(false);
    });

    it('rollbackSpend drops the booking', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-rollback', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) => UnshieldedState.applyUpdate(s, { createdUtxos: [u], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u, booking),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpendByUtxo(s, u.utxo),
        getOrThrow,
      );

      expect(HashMap.has(UnshieldedState.availableUtxos(after), utxoHash(u))).toBe(true);
      expect(HashMap.has(after.bookings, utxoHash(u))).toBe(false);
    });

    it('expireBookings loses no utxo and keeps the two maps disjoint', () => {
      fc.assert(
        fc.property(fc.array(utxoArb, { minLength: 1, maxLength: 8 }), (utxos) => {
          const seeded = pipe(
            UnshieldedState.empty(),
            (s) => UnshieldedState.applyUpdate(s, { createdUtxos: utxos, spentUtxos: [], status: 'SUCCESS' }),
            getOrThrow,
          );
          const booked = utxos.reduce((state, u) => getOrThrow(UnshieldedState.spend(state, u, booking)), seeded);

          const after = UnshieldedState.expireBookings(booked, new Date('2026-01-01T02:00:00.000Z'));

          expect(HashMap.size(UnshieldedState.availableUtxos(after))).toEqual(utxos.length);
          expect(HashMap.size(UnshieldedState.pendingUtxos(after))).toEqual(0);
          expect(
            Array.from(HashMap.keys(UnshieldedState.availableUtxos(after))).every(
              (h) => !HashMap.has(UnshieldedState.pendingUtxos(after), h),
            ),
          ).toBe(true);
        }),
        { numRuns: 50 },
      );
    });
  });
  // ADR 0008: a coin is stored once, and a booking is a key pointing at it. The two maps consumers read are derived,
  // so they cannot diverge and a coin cannot be in both.
  describe('single-map shape', () => {
    it('stores one entry per coin whether it is booked or not', () => {
      const utxo = generateMockUtxoWithMeta({ intentHash: 'h-single', outputNo: 0 });
      const booked = pipe(
        UnshieldedState.restore([utxo], []),
        (s) => UnshieldedState.spend(s, utxo, defaultTestBooking),
        getOrThrow,
      );

      expect(HashMap.size(booked.utxos)).toEqual(1);
      expect(HashMap.has(booked.bookings, utxoHash(utxo))).toBe(true);
    });

    it('derives the two views from the one map, disjointly', () => {
      const booked = generateMockUtxoWithMeta({ intentHash: 'h-booked', outputNo: 0 });
      const free = generateMockUtxoWithMeta({ intentHash: 'h-free', outputNo: 0 });
      const state = pipe(
        UnshieldedState.restore([booked, free], []),
        (s) => UnshieldedState.spend(s, booked, defaultTestBooking),
        getOrThrow,
      );

      expect(Array.from(HashMap.keys(UnshieldedState.availableUtxos(state)))).toEqual([utxoHash(free)]);
      expect(Array.from(HashMap.keys(UnshieldedState.pendingUtxos(state)))).toEqual([utxoHash(booked)]);
    });

    // #697 itself: the indexer replays whole transactions from the wallet's cursor, so the transaction that created a
    // booked coin can arrive again while the booking stands. Under one map this cannot duplicate the coin, with no
    // guard in applyUpdate doing the work.
    it('cannot duplicate a booked coin when its creating transaction is replayed', () => {
      const utxo = generateMockUtxoWithMeta({ intentHash: 'h-replayed', outputNo: 0 });
      const booked = pipe(
        UnshieldedState.restore([utxo], []),
        (s) => UnshieldedState.spend(s, utxo, defaultTestBooking),
        getOrThrow,
      );

      const replayed = pipe(
        UnshieldedState.applyUpdate(booked, { createdUtxos: [utxo], spentUtxos: [], status: 'SUCCESS' }),
        getOrThrow,
      );

      expect(HashMap.size(replayed.utxos)).toEqual(1);
      expect(HashMap.has(replayed.bookings, utxoHash(utxo))).toBe(true);
      expect(HashMap.size(UnshieldedState.availableUtxos(replayed))).toEqual(0);
      expect(HashMap.size(UnshieldedState.pendingUtxos(replayed))).toEqual(1);
    });

    it('leaves a coin s meta untouched across a booking and its release', () => {
      const utxo = generateMockUtxoWithMeta({ intentHash: 'h-meta', outputNo: 0, registeredForDustGeneration: true });
      const released = pipe(
        UnshieldedState.restore([utxo], []),
        (s) => UnshieldedState.spend(s, utxo, defaultTestBooking),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpend(s, utxo),
        getOrThrow,
      );

      expect(HashMap.get(released.utxos, utxoHash(utxo))).toEqual(Option.some(utxo));
      expect(HashMap.has(released.bookings, utxoHash(utxo))).toBe(false);
    });

    it('keeps the derived views disjoint under arbitrary bookings and replays', () => {
      fc.assert(
        fc.property(fc.array(utxoArb, { minLength: 1, maxLength: 8 }), (utxos) => {
          const state = utxos.reduce(
            (acc, utxo, i) => (i % 2 === 0 ? getOrThrow(UnshieldedState.spend(acc, utxo, defaultTestBooking)) : acc),
            UnshieldedState.restore(utxos, []),
          );
          const replayed = getOrThrow(
            UnshieldedState.applyUpdate(state, { createdUtxos: utxos, spentUtxos: [], status: 'SUCCESS' }),
          );

          expect(HashMap.size(replayed.utxos)).toEqual(utxos.length);
          expect(
            Array.from(HashMap.keys(UnshieldedState.availableUtxos(replayed))).every(
              (h) => !HashMap.has(UnshieldedState.pendingUtxos(replayed), h),
            ),
          ).toBe(true);
        }),
        { numRuns: 50 },
      );
    });
  });
});
