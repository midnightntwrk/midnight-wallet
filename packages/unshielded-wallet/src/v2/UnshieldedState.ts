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
import type * as ledger from '@midnightntwrk/ledger-v9';
import { Array as EArray, Data, Either, HashMap, Option, pipe } from 'effect';
import { ApplyTransactionError, UtxoNotFoundError } from './WalletError.js';

export interface UtxoMeta {
  readonly ctime: Date;
  readonly registeredForDustGeneration: boolean;
}

export type UtxoHash = string;

export class UtxoWithMeta extends Data.Class<{
  readonly utxo: ledger.Utxo;
  readonly meta: UtxoMeta;
}> {}

export type UpdateStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';

export interface UnshieldedUpdate {
  readonly createdUtxos: readonly UtxoWithMeta[];
  readonly spentUtxos: readonly UtxoWithMeta[];
  readonly status: UpdateStatus;
}

export interface UnshieldedState {
  readonly availableUtxos: HashMap.HashMap<UtxoHash, UtxoWithMeta>;
  readonly pendingUtxos: HashMap.HashMap<UtxoHash, UtxoWithMeta>;
}

const UtxoHash = (utxo: ledger.Utxo): UtxoHash => `${utxo.intentHash}#${utxo.outputNo}`;

/**
 * The first UTXO an update reports as spent that this state holds in neither map.
 *
 * @remarks
 *   A spend naming a UTXO the wallet has never held is not noise to absorb: it is the only observable sign that the
 *   source delivered a spend ahead of the create it consumes. Absorbed, the create arrives afterwards and puts an
 *   already-spent UTXO into the available set, where it will be offered for coin selection and produce a transaction
 *   the chain rejects. Reported, the fold fails before the caller's cursor moves, and the retry re-fetches the pair in
 *   order.
 * @param state The state the update is being folded into.
 * @param spentUtxos The UTXOs the update reports as spent.
 * @returns The first entry the state does not know, or `Option.none()` when every spend names a UTXO it holds.
 */
const firstUnknownSpend = (state: UnshieldedState, spentUtxos: readonly UtxoWithMeta[]): Option.Option<UtxoWithMeta> =>
  EArray.findFirst(spentUtxos, (spent) => {
    const hash = UtxoHash(spent.utxo);
    return !HashMap.has(state.availableUtxos, hash) && !HashMap.has(state.pendingUtxos, hash);
  });

export const UnshieldedState = {
  empty: (): UnshieldedState => ({
    availableUtxos: HashMap.empty(),
    pendingUtxos: HashMap.empty(),
  }),

  restore: (availableUtxos: readonly UtxoWithMeta[], pendingUtxos: readonly UtxoWithMeta[]): UnshieldedState => ({
    availableUtxos: HashMap.fromIterable(availableUtxos.map((utxo) => [UtxoHash(utxo.utxo), utxo])),
    pendingUtxos: HashMap.fromIterable(pendingUtxos.map((utxo) => [UtxoHash(utxo.utxo), utxo])),
  }),

  spend: (state: UnshieldedState, utxo: UtxoWithMeta): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo.utxo);
      if (!HashMap.has(state.availableUtxos, hash)) {
        return yield* Either.left(new UtxoNotFoundError({ utxo: utxo.utxo }));
      }
      return {
        availableUtxos: HashMap.remove(state.availableUtxos, hash),
        pendingUtxos: HashMap.set(state.pendingUtxos, hash, utxo),
      };
    }),

  rollbackSpend: (state: UnshieldedState, utxo: UtxoWithMeta): Either.Either<UnshieldedState, never> => {
    // Rollbacks can't fail due to a utxo not found as it is possible and expected if there is a race between sync and revert call
    const hash = UtxoHash(utxo.utxo);
    if (!HashMap.has(state.pendingUtxos, hash)) {
      return Either.right(state);
    }
    return Either.right({
      availableUtxos: HashMap.set(state.availableUtxos, hash, utxo),
      pendingUtxos: HashMap.remove(state.pendingUtxos, hash),
    });
  },

  spendByUtxo: (state: UnshieldedState, utxo: ledger.Utxo): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo);
      const found = yield* Either.fromOption(
        HashMap.get(state.availableUtxos, hash),
        () => new UtxoNotFoundError({ utxo }),
      );
      return yield* UnshieldedState.spend(state, found);
    }),

  rollbackSpendByUtxo: (state: UnshieldedState, utxo: ledger.Utxo): Either.Either<UnshieldedState, never> =>
    pipe(
      HashMap.get(state.pendingUtxos, UtxoHash(utxo)),
      Option.match({
        onNone: () => Either.right(state),
        onSome: (found) => UnshieldedState.rollbackSpend(state, found),
      }),
    ),

  applyUpdate: (
    state: UnshieldedState,
    update: UnshieldedUpdate,
  ): Either.Either<UnshieldedState, ApplyTransactionError | UtxoNotFoundError> =>
    Either.gen(function* () {
      if (!['SUCCESS', 'PARTIAL_SUCCESS'].includes(update.status)) {
        return yield* Either.left(new ApplyTransactionError({ message: `Invalid status: ${update.status}` }));
      }

      const unknownSpend = firstUnknownSpend(state, update.spentUtxos);
      if (Option.isSome(unknownSpend)) {
        return yield* Either.left(new UtxoNotFoundError({ utxo: unknownSpend.value.utxo }));
      }

      return {
        availableUtxos: HashMap.union(
          HashMap.removeMany(
            state.availableUtxos,
            update.spentUtxos.map((utxo) => UtxoHash(utxo.utxo)),
          ),
          HashMap.fromIterable(update.createdUtxos.map((utxo) => [UtxoHash(utxo.utxo), utxo])),
        ),
        pendingUtxos: HashMap.removeMany(
          state.pendingUtxos,
          update.spentUtxos.map((utxo) => UtxoHash(utxo.utxo)),
        ),
      };
    }),

  applyFailedUpdate: (
    state: UnshieldedState,
    update: UnshieldedUpdate,
  ): Either.Either<UnshieldedState, ApplyTransactionError | UtxoNotFoundError> =>
    Either.gen(function* () {
      if (update.status !== 'FAILURE') {
        return yield* Either.left(new ApplyTransactionError({ message: `Invalid status: ${update.status}` }));
      }

      const unknownSpend = firstUnknownSpend(state, update.spentUtxos);
      if (Option.isSome(unknownSpend)) {
        return yield* Either.left(new UtxoNotFoundError({ utxo: unknownSpend.value.utxo }));
      }

      return {
        availableUtxos: HashMap.union(
          state.availableUtxos,
          HashMap.fromIterable(update.spentUtxos.map((utxo) => [UtxoHash(utxo.utxo), utxo])),
        ),
        pendingUtxos: HashMap.removeMany(
          state.pendingUtxos,
          update.spentUtxos.map((utxo) => UtxoHash(utxo.utxo)),
        ),
      };
    }),

  toArrays: (
    state: UnshieldedState,
  ): {
    readonly availableUtxos: readonly UtxoWithMeta[];
    readonly pendingUtxos: readonly UtxoWithMeta[];
  } => ({
    availableUtxos: HashMap.toValues(state.availableUtxos),
    pendingUtxos: HashMap.toValues(state.pendingUtxos),
  }),
} as const;
