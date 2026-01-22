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
import type * as ledger from '@midnight-ntwrk/ledger-v7';
import { Data, Either, HashMap } from 'effect';
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

  rollbackSpend: (state: UnshieldedState, utxo: UtxoWithMeta): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo.utxo);
      if (!HashMap.has(state.pendingUtxos, hash)) {
        return yield* Either.left(new UtxoNotFoundError({ utxo: utxo.utxo }));
      }
      return {
        availableUtxos: HashMap.set(state.availableUtxos, hash, utxo),
        pendingUtxos: HashMap.remove(state.pendingUtxos, hash),
      };
    }),

  spendByUtxo: (state: UnshieldedState, utxo: ledger.Utxo): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo);
      const found = yield* Either.fromOption(
        HashMap.get(state.availableUtxos, hash),
        () => new UtxoNotFoundError({ utxo }),
      );
      return yield* UnshieldedState.spend(state, found);
    }),

  rollbackSpendByUtxo: (state: UnshieldedState, utxo: ledger.Utxo): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo);
      const found = yield* Either.fromOption(
        HashMap.get(state.pendingUtxos, hash),
        () => new UtxoNotFoundError({ utxo }),
      );
      return yield* UnshieldedState.rollbackSpend(state, found);
    }),

  applyUpdate: (
    state: UnshieldedState,
    update: UnshieldedUpdate,
  ): Either.Either<UnshieldedState, ApplyTransactionError> =>
    Either.gen(function* () {
      if (!['SUCCESS', 'PARTIAL_SUCCESS'].includes(update.status)) {
        return yield* Either.left(new ApplyTransactionError({ message: `Invalid status: ${update.status}` }));
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
  ): Either.Either<UnshieldedState, ApplyTransactionError> =>
    Either.gen(function* () {
      if (update.status !== 'FAILURE') {
        return yield* Either.left(new ApplyTransactionError({ message: `Invalid status: ${update.status}` }));
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
