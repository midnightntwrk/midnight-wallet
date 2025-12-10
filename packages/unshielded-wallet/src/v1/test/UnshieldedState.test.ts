// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { Either, HashMap, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { UnshieldedState, UnshieldedUpdate } from '../UnshieldedState.js';
import { UtxoNotFoundError } from '../WalletError.js';
import { generateMockUpdate, generateMockUtxoWithMeta } from './testUtils.js';

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
});
