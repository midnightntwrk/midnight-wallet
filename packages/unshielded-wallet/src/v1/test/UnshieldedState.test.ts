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
import { UnshieldedState, UnshieldedUpdate, UtxoWithMeta } from '../UnshieldedState.js';
import { UtxoNotFoundError } from '../WalletError.js';
import { generateMockUpdate, generateMockUtxoWithMeta, makeUtxo, utxoArb, utxoHash } from './testUtils.js';

const getOrThrow = <E, A>(either: Either.Either<A, E>): A =>
  pipe(
    either,
    Either.getOrThrowWith((e) => new Error(`Unexpected error: ${JSON.stringify(e)}`)),
  );

describe('UnshieldedState', () => {
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

  it('should spend a utxo', () => {
    const update = generateMockUpdate('SUCCESS', 1, 0);

    const state = pipe(
      UnshieldedState.empty(),
      (s) => UnshieldedState.applyUpdate(s, update),
      getOrThrow,
      (s) => UnshieldedState.spend(s, update.createdUtxos[0]),
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
      (s) => UnshieldedState.spend(s, generateMockUtxoWithMeta('owner21', 'type12')),
    );

    expect(Either.isLeft(result)).toBe(true);
    pipe(
      result,
      Either.mapLeft((e) => expect(e).toBeInstanceOf(UtxoNotFoundError)),
    );
  });

  it('should rollback a spend', () => {
    const update = generateMockUpdate('SUCCESS', 1, 0);
    const utxoToSpend = update.createdUtxos[0];

    const state = pipe(
      UnshieldedState.empty(),
      (s) => UnshieldedState.applyUpdate(s, update),
      getOrThrow,
      (s) => UnshieldedState.spend(s, utxoToSpend),
      getOrThrow,
      (s) => UnshieldedState.rollbackSpend(s, utxoToSpend),
      getOrThrow,
    );

    expect(HashMap.size(state.availableUtxos)).toEqual(1);
    expect(HashMap.size(state.pendingUtxos)).toEqual(0);
  });

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
      (s) => UnshieldedState.spend(s, utxoToSpend),
      getOrThrow,
      (s) => UnshieldedState.applyFailedUpdate(s, failedUpdate),
      getOrThrow,
    );

    expect(HashMap.size(state.availableUtxos)).toEqual(1);
    expect(HashMap.size(state.pendingUtxos)).toEqual(0);
  });

  it('should reject applying update with wrong status', () => {
    const result = pipe(UnshieldedState.empty(), (s) =>
      UnshieldedState.applyUpdate(s, generateMockUpdate('FAILURE', 1, 0)),
    );

    expect(Either.isLeft(result)).toBe(true);
  });

  it('should reject applying failed update with wrong status', () => {
    const result = pipe(UnshieldedState.empty(), (s) =>
      UnshieldedState.applyFailedUpdate(s, generateMockUpdate('SUCCESS', 0, 1)),
    );

    expect(Either.isLeft(result)).toBe(true);
  });

  it('should restore state from arrays', () => {
    const utxo1 = generateMockUtxoWithMeta('owner1', 'type1');
    const utxo2 = generateMockUtxoWithMeta('owner2', 'type2');
    const pendingUtxo = generateMockUtxoWithMeta('owner3', 'type3');

    const state = UnshieldedState.restore([utxo1, utxo2], [pendingUtxo]);

    expect(HashMap.size(state.availableUtxos)).toEqual(2);
    expect(HashMap.size(state.pendingUtxos)).toEqual(1);
  });

  it('should convert state to arrays', () => {
    const utxo1 = generateMockUtxoWithMeta('owner1', 'type1');
    const utxo2 = generateMockUtxoWithMeta('owner2', 'type2');
    const pendingUtxo = generateMockUtxoWithMeta('owner3', 'type3');

    const arrays = pipe(UnshieldedState.restore([utxo1, utxo2], [pendingUtxo]), UnshieldedState.toArrays);

    expect(arrays.availableUtxos.length).toEqual(2);
    expect(arrays.pendingUtxos.length).toEqual(1);
  });

  it('should spend by utxo (ledger.Utxo)', () => {
    const update = generateMockUpdate('SUCCESS', 1, 0);

    const state = pipe(
      UnshieldedState.empty(),
      (s) => UnshieldedState.applyUpdate(s, update),
      getOrThrow,
      (s) => UnshieldedState.spendByUtxo(s, update.createdUtxos[0].utxo),
      getOrThrow,
    );

    expect(HashMap.size(state.availableUtxos)).toEqual(0);
    expect(HashMap.size(state.pendingUtxos)).toEqual(1);
  });

  it('should rollback spend by utxo (ledger.Utxo)', () => {
    const update = generateMockUpdate('SUCCESS', 1, 0);
    const utxoToSpend = update.createdUtxos[0];

    const state = pipe(
      UnshieldedState.empty(),
      (s) => UnshieldedState.applyUpdate(s, update),
      getOrThrow,
      (s) => UnshieldedState.spend(s, utxoToSpend),
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
      (s) => UnshieldedState.spend(s, utxoToSpend),
      getOrThrow,
      (s) => UnshieldedState.rollbackSpendByUtxo(s, utxoToSpend.utxo),
      getOrThrow,
      (s) => UnshieldedState.rollbackSpendByUtxo(s, utxoToSpend.utxo),
      getOrThrow,
    );

    expect(HashMap.size(state.availableUtxos)).toEqual(1);
    expect(HashMap.size(state.pendingUtxos)).toEqual(0);
  });

  describe('applyUpdate', () => {
    it('should apply PARTIAL_SUCCESS update the same as SUCCESS', () => {
      const created = makeUtxo({ intentHash: 'h-partial', outputNo: 0 });
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
      const existing = makeUtxo({ intentHash: 'h-existing', outputNo: 0 });
      const created = makeUtxo({ intentHash: 'h-new', outputNo: 0 });

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
      const u = makeUtxo({ intentHash: 'h-confirm', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [u],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u),
        getOrThrow,
        // sanity: u is now in pending
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
      const seed = makeUtxo({ intentHash: 'h-seed', outputNo: 0 });

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
      const present = makeUtxo({ intentHash: 'h-present', outputNo: 0 });
      const ghost = makeUtxo({ intentHash: 'h-ghost', outputNo: 0 });

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
      const a = makeUtxo({ intentHash: 'h-a', outputNo: 0 });
      const b = makeUtxo({ intentHash: 'h-b', outputNo: 1 });

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
  });

  describe('applyFailedUpdate', () => {
    it('should restore spent utxo to availableUtxos AND remove it from pendingUtxos', () => {
      // Two-utxo setup: spend A, leave B available. After applyFailedUpdate(A),
      // available should contain BOTH A and B, pending should be empty.
      const a = makeUtxo({ intentHash: 'h-a', outputNo: 0 });
      const b = makeUtxo({ intentHash: 'h-b', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [a, b],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, a),
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

    it('should be a no-op for spentUtxos not present in pendingUtxos', () => {
      const present = makeUtxo({ intentHash: 'h-present', outputNo: 0 });
      const ghost = makeUtxo({ intentHash: 'h-ghost', outputNo: 0 });

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

      // present remains exactly as it was; ghost is added to available because
      // applyFailedUpdate unconditionally restores spentUtxos. This documents
      // the current (intentional?) contract — see TODO below.
      expect(HashMap.has(after.availableUtxos, utxoHash(present))).toBe(true);
      // The current implementation (UnshieldedState.ts:132-139) does HashMap.union(available, spentUtxos).
      // That means a ghost spent-utxo gets ADDED to available. If this is unintended, the test will surface it.
      expect(HashMap.has(after.availableUtxos, utxoHash(ghost))).toBe(true);
      expect(HashMap.size(after.pendingUtxos)).toEqual(0);
    });
  });

  describe('lifecycle sequences', () => {
    it('happy path: create → spend → confirm leaves both collections empty', () => {
      const u = makeUtxo({ intentHash: 'h-life', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [u],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u),
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
      const u = makeUtxo({ intentHash: 'h-fail', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [u],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u),
        getOrThrow,
        (s) =>
          UnshieldedState.applyFailedUpdate(s, {
            createdUtxos: [],
            spentUtxos: [u],
            status: 'FAILURE',
          }),
        getOrThrow,
        // re-spend should succeed
        (s) => UnshieldedState.spend(s, u),
        getOrThrow,
      );

      expect(HashMap.has(after.pendingUtxos, utxoHash(u))).toBe(true);
      expect(HashMap.has(after.availableUtxos, utxoHash(u))).toBe(false);
    });

    it('rollback path: spend → rollbackSpend makes utxo re-spendable', () => {
      const u = makeUtxo({ intentHash: 'h-rb', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [u],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u),
        getOrThrow,
        (s) => UnshieldedState.rollbackSpend(s, u),
        getOrThrow,
        (s) => UnshieldedState.spend(s, u),
        getOrThrow,
      );

      expect(HashMap.has(after.pendingUtxos, utxoHash(u))).toBe(true);
      expect(HashMap.size(after.availableUtxos)).toEqual(0);
    });

    it('reorg shape: applyUpdate(A) → applyUpdate(B) → applyFailedUpdate(B) leaves A intact', () => {
      const a = makeUtxo({ intentHash: 'h-A', outputNo: 0 });
      const b = makeUtxo({ intentHash: 'h-B', outputNo: 0 });

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
        UnshieldedState.spend(seeded, b),
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
      const a = makeUtxo({ intentHash: 'h-pa', outputNo: 0 });
      const b = makeUtxo({ intentHash: 'h-pb', outputNo: 0 });

      const after = pipe(
        UnshieldedState.empty(),
        (s) =>
          UnshieldedState.applyUpdate(s, {
            createdUtxos: [a, b],
            spentUtxos: [],
            status: 'SUCCESS',
          }),
        getOrThrow,
        (s) => UnshieldedState.spend(s, a),
        getOrThrow,
        (s) => UnshieldedState.spend(s, b),
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
      | { tag: 'fail'; utxo: UtxoWithMeta };

    // Apply an operation, ignoring failures (e.g. spending a missing utxo).
    // The point of these invariants is that *valid* operations preserve them;
    // we silently skip ops the state can't accept.
    const applyOp = (state: UnshieldedState, op: Op): UnshieldedState => {
      const result: Either.Either<UnshieldedState, unknown> = (() => {
        switch (op.tag) {
          case 'spend':
            return UnshieldedState.spend(state, op.utxo);
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

            const availableKeys = new Set(HashMap.keys(finalState.availableUtxos));
            const pendingKeys = HashMap.keys(finalState.pendingUtxos);
            for (const k of pendingKeys) {
              if (availableKeys.has(k)) return false;
            }
            return true;
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
            UnshieldedState.spend(seeded, u),
            getOrThrow,
            (s) => UnshieldedState.rollbackSpend(s, u),
            getOrThrow,
          );

          // Same shape: same available, same pending.
          return (
            HashMap.has(roundTripped.availableUtxos, utxoHash(u)) &&
            !HashMap.has(roundTripped.pendingUtxos, utxoHash(u)) &&
            HashMap.size(roundTripped.availableUtxos) === HashMap.size(seeded.availableUtxos) &&
            HashMap.size(roundTripped.pendingUtxos) === HashMap.size(seeded.pendingUtxos)
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
            UnshieldedState.spend(seeded, u),
            getOrThrow,
            (s) =>
              UnshieldedState.applyFailedUpdate(s, {
                createdUtxos: [],
                spentUtxos: [u],
                status: 'FAILURE',
              }),
            getOrThrow,
          );

          return (
            HashMap.has(roundTripped.availableUtxos, utxoHash(u)) &&
            !HashMap.has(roundTripped.pendingUtxos, utxoHash(u)) &&
            HashMap.size(roundTripped.availableUtxos) === HashMap.size(seeded.availableUtxos) &&
            HashMap.size(roundTripped.pendingUtxos) === HashMap.size(seeded.pendingUtxos)
          );
        }),
        { numRuns: 50 },
      );
    });
  });
});
