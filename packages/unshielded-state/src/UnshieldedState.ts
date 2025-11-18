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
import { Context, Effect, Layer, HashSet, SubscriptionRef } from 'effect';
import { ParseError } from 'effect/ParseResult';
import {
  ApplyTransactionError,
  RollbackError,
  UnshieldedStateAPI,
  UnshieldedState,
  UnshieldedTransaction,
  Utxo,
  UtxoNotFoundError,
} from './model.js';

export class UnshieldedStateService extends Context.Tag('@midnight-ntwrk/wallet-sdk-unshielded-state')<
  UnshieldedStateService,
  UnshieldedStateAPI
>() {
  private static createService = (stateRef: SubscriptionRef.SubscriptionRef<UnshieldedState>) => {
    const applyTx = (tx: UnshieldedTransaction): Effect.Effect<void, ParseError | ApplyTransactionError> =>
      SubscriptionRef.updateEffect(stateRef, (state) =>
        Effect.gen(function* () {
          const { createdUtxos, spentUtxos, transactionResult, id } = tx;

          if (transactionResult?.status === 'FailedEntirely') {
            return yield* Effect.fail(
              new ApplyTransactionError({
                tx: tx,
                message: `Cannot apply failed a transaction with status: ${transactionResult?.status ?? 'Unknown'}`,
              }),
            );
          }
          // @TODO: Handle partial success
          return {
            ...state,
            utxos: HashSet.union(state.utxos, HashSet.fromIterable(createdUtxos)),
            pendingUtxos: HashSet.difference(state.pendingUtxos, HashSet.fromIterable(spentUtxos)),
            syncProgress: {
              highestTransactionId: state.syncProgress?.highestTransactionId ?? 0,
              currentTransactionId: id,
            },
          };
        }),
      );

    const applyFailedTx = (tx: UnshieldedTransaction): Effect.Effect<void, ParseError | ApplyTransactionError> =>
      SubscriptionRef.updateEffect(stateRef, (state) =>
        Effect.gen(function* () {
          const { spentUtxos, transactionResult } = tx;

          if (transactionResult?.status !== 'FailedEntirely') {
            return yield* Effect.fail(
              new ApplyTransactionError({
                tx: tx,
                message: `Cannot apply failed a transaction with status: ${transactionResult?.status ?? 'Unknown'}`,
              }),
            );
          }

          return {
            ...state,
            utxos: HashSet.union(state.utxos, HashSet.fromIterable(spentUtxos)),
            pendingUtxos: HashSet.difference(state.pendingUtxos, HashSet.fromIterable(spentUtxos)),
          };
        }),
      );

    const spend = (utxoToSpend: Utxo): Effect.Effect<void, UtxoNotFoundError | ParseError> =>
      SubscriptionRef.updateEffect(stateRef, (state) =>
        Effect.gen(function* () {
          const utxo = utxoToSpend;

          if (!HashSet.has(state.utxos, utxo)) {
            return yield* Effect.fail(new UtxoNotFoundError({ utxo: utxoToSpend }));
          }

          return {
            ...state,
            utxos: HashSet.remove(state.utxos, utxo),
            pendingUtxos: HashSet.add(state.pendingUtxos, utxo),
          };
        }),
      );

    const updateSyncProgress = (highestTransactionId: number): Effect.Effect<void> =>
      SubscriptionRef.update(stateRef, (state) => ({
        ...state,
        syncProgress: {
          highestTransactionId,
          currentTransactionId: state?.syncProgress?.currentTransactionId ?? 0,
        },
      }));

    const rollbackTx = (tx: UnshieldedTransaction): Effect.Effect<void, ParseError | RollbackError> =>
      SubscriptionRef.updateEffect(stateRef, (state) => {
        const { spentUtxos } = tx;

        return Effect.succeed({
          ...state,
          utxos: HashSet.union(state.utxos, HashSet.fromIterable(spentUtxos)),
          pendingUtxos: HashSet.difference(state.pendingUtxos, HashSet.fromIterable(spentUtxos)),
        });
      });

    return UnshieldedStateService.of({
      state: stateRef.changes,
      getLatestState: () => SubscriptionRef.get(stateRef),
      applyTx,
      applyFailedTx,
      spend,
      updateSyncProgress,
      rollbackTx,
    });
  };

  static readonly Live = (): Layer.Layer<UnshieldedStateService, ParseError> =>
    Layer.effect(
      UnshieldedStateService,
      Effect.gen(function* () {
        const initialState: UnshieldedState = {
          utxos: HashSet.empty<Utxo>(),
          pendingUtxos: HashSet.empty<Utxo>(),
          syncProgress: undefined,
        };

        const stateRef = yield* SubscriptionRef.make<UnshieldedState>(initialState);
        return UnshieldedStateService.createService(stateRef);
      }),
    );

  static readonly LiveWithState = (initialState: UnshieldedState): Layer.Layer<UnshieldedStateService, ParseError> =>
    Layer.effect(
      UnshieldedStateService,
      Effect.gen(function* () {
        const stateRef = yield* SubscriptionRef.make<UnshieldedState>(initialState);
        return UnshieldedStateService.createService(stateRef);
      }),
    );
}
