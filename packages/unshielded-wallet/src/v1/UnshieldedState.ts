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
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { Data, Either, HashMap, Option, pipe } from 'effect';
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

/**
 * A coin reserved by a transaction that has been balanced but has not settled, together with the expiry that
 * reservation was taken with. `ttl` is the TTL of the transaction the coin was booked for: from that instant the ledger
 * rejects the transaction, so the reservation cannot still be valid and the coin returns to the available side.
 */
export interface PendingUtxo {
  readonly utxo: UtxoWithMeta;
  readonly ttl: Date;
  /**
   * True when this booking came back from a snapshot rather than being taken by the running process. The process that
   * took it is gone, so once sync proves nothing on chain spent the coin, only a durable record of the transaction can
   * justify keeping it booked.
   */
  readonly restored: boolean;
}

export type UpdateStatus = 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS';

export interface UnshieldedUpdate {
  readonly createdUtxos: readonly UtxoWithMeta[];
  readonly spentUtxos: readonly UtxoWithMeta[];
  readonly status: UpdateStatus;
}

export interface UnshieldedState {
  readonly availableUtxos: HashMap.HashMap<UtxoHash, UtxoWithMeta>;
  readonly pendingUtxos: HashMap.HashMap<UtxoHash, PendingUtxo>;
}

const UtxoHash = (utxo: ledger.Utxo): UtxoHash => `${utxo.intentHash}#${utxo.outputNo}`;

export const UnshieldedState = {
  empty: (): UnshieldedState => ({
    availableUtxos: HashMap.empty(),
    pendingUtxos: HashMap.empty(),
  }),

  /**
   * Rebuilds the state from a persisted snapshot. The two maps are disjoint by construction, so a UTxO a snapshot
   * records in both is kept on the pending side only: the spend that booked it may still be on its way, and expiry
   * releases it if it is not.
   */
  restore: (
    availableUtxos: readonly UtxoWithMeta[],
    // Every entry read back is restored by definition, so the caller does not get to say otherwise.
    pendingUtxos: ReadonlyArray<Omit<PendingUtxo, 'restored'>>,
  ): UnshieldedState => {
    const pending = HashMap.fromIterable(
      pendingUtxos.map((entry) => [UtxoHash(entry.utxo.utxo), { ...entry, restored: true }] as const),
    );
    return {
      availableUtxos: HashMap.fromIterable(
        availableUtxos
          .filter((utxo) => !HashMap.has(pending, UtxoHash(utxo.utxo)))
          .map((utxo) => [UtxoHash(utxo.utxo), utxo] as const),
      ),
      pendingUtxos: pending,
    };
  },

  /**
   * Books a coin for a transaction being balanced, moving it from the available side to the pending side.
   *
   * @param ttl - The TTL of the transaction the coin is being booked for. It bounds the reservation: nothing else
   *   releases a booking whose transaction is abandoned before submission, so without it the coin is stuck forever.
   */
  spend: (state: UnshieldedState, utxo: UtxoWithMeta, ttl: Date): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo.utxo);
      if (!HashMap.has(state.availableUtxos, hash)) {
        return yield* Either.left(new UtxoNotFoundError({ utxo: utxo.utxo }));
      }
      return {
        availableUtxos: HashMap.remove(state.availableUtxos, hash),
        pendingUtxos: HashMap.set(state.pendingUtxos, hash, { utxo, ttl, restored: false }),
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

  spendByUtxo: (
    state: UnshieldedState,
    utxo: ledger.Utxo,
    ttl: Date,
  ): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo);
      const found = yield* Either.fromOption(
        HashMap.get(state.availableUtxos, hash),
        () => new UtxoNotFoundError({ utxo }),
      );
      return yield* UnshieldedState.spend(state, found, ttl);
    }),

  rollbackSpendByUtxo: (state: UnshieldedState, utxo: ledger.Utxo): Either.Either<UnshieldedState, never> =>
    pipe(
      HashMap.get(state.pendingUtxos, UtxoHash(utxo)),
      Option.match({
        onNone: () => Either.right(state),
        onSome: (found) => UnshieldedState.rollbackSpend(state, found.utxo),
      }),
    ),

  /**
   * Releases a booked coin named by its id, returning it to the available side. A reservation records the ids of the
   * coins it books rather than the coins themselves, so releasing one has to be possible from the id alone.
   *
   * Like {@link UnshieldedState.rollbackSpend}, an id that is not booked is left alone rather than reported: sync may
   * have cleared the coin first, and that race is expected.
   */
  rollbackSpendByHash: (state: UnshieldedState, hash: UtxoHash): UnshieldedState =>
    pipe(
      HashMap.get(state.pendingUtxos, hash),
      Option.match({
        onNone: () => state,
        onSome: ({ utxo }) => ({
          availableUtxos: HashMap.set(state.availableUtxos, hash, utxo),
          pendingUtxos: HashMap.remove(state.pendingUtxos, hash),
        }),
      }),
    ),

  /**
   * Releases every booking that came back from a snapshot and that `coveredIds` does not account for.
   *
   * Meant for the moment sync reaches the chain tip: from there, every transaction the address is party to has been
   * applied, so a coin still booked was never spent by the process that booked it. Releasing it then returns it in
   * seconds rather than at the transaction's TTL.
   *
   * @param coveredIds - Coins some durable record still accounts for, such as a transaction waiting on a counterparty.
   *   Those stay booked: the wallet cannot see that transaction, but something else knows it is still live.
   */
  releaseRestoredPending: (state: UnshieldedState, coveredIds: ReadonlyArray<UtxoHash>): UnshieldedState => {
    const releasable = HashMap.filter(
      state.pendingUtxos,
      ({ restored }, hash) => restored && !coveredIds.includes(hash),
    );

    return HashMap.isEmpty(releasable)
      ? state
      : {
          availableUtxos: HashMap.union(
            state.availableUtxos,
            HashMap.map(releasable, ({ utxo }) => utxo),
          ),
          pendingUtxos: HashMap.removeMany(state.pendingUtxos, HashMap.keys(releasable)),
        };
  },

  /**
   * Releases every booking that has reached its expiry, returning those coins to the available side. A booking is only
   * released by the submit path today, so a transaction abandoned between balancing and submission leaks its coins;
   * this sweep is what bounds that leak to the transaction's own lifetime.
   *
   * @param now - The instant to expire against. A booking expires at its TTL, not after it, because the ledger already
   *   rejects the transaction at that instant.
   */
  expirePending: (state: UnshieldedState, now: Date): UnshieldedState => {
    const expired = HashMap.filter(state.pendingUtxos, ({ ttl }) => ttl.getTime() <= now.getTime());

    return HashMap.isEmpty(expired)
      ? state
      : {
          availableUtxos: HashMap.union(
            state.availableUtxos,
            HashMap.map(expired, ({ utxo }) => utxo),
          ),
          pendingUtxos: HashMap.removeMany(state.pendingUtxos, HashMap.keys(expired)),
        };
  },

  applyUpdate: (
    state: UnshieldedState,
    update: UnshieldedUpdate,
  ): Either.Either<UnshieldedState, ApplyTransactionError> =>
    Either.gen(function* () {
      if (!['SUCCESS', 'PARTIAL_SUCCESS'].includes(update.status)) {
        return yield* Either.left(new ApplyTransactionError({ message: `Invalid status: ${update.status}` }));
      }

      const spentHashes = update.spentUtxos.map((utxo) => UtxoHash(utxo.utxo));
      const pendingUtxos = HashMap.removeMany(state.pendingUtxos, spentHashes);

      return {
        availableUtxos: HashMap.union(
          HashMap.removeMany(state.availableUtxos, spentHashes),
          // A created UTxO that is still booked must not re-enter availableUtxos. The indexer replays the
          // transaction that created a booked coin whenever sync resumes from a cursor predating it, and the two
          // maps are disjoint by construction — every balance accessor counts them independently.
          HashMap.fromIterable(
            update.createdUtxos
              .filter((utxo) => !HashMap.has(pendingUtxos, UtxoHash(utxo.utxo)))
              .map((utxo) => [UtxoHash(utxo.utxo), utxo] as const),
          ),
        ),
        pendingUtxos,
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
    readonly pendingUtxos: readonly PendingUtxo[];
  } => ({
    availableUtxos: HashMap.toValues(state.availableUtxos),
    pendingUtxos: HashMap.toValues(state.pendingUtxos),
  }),
} as const;
