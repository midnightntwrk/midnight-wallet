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

/**
 * The reservation held on a UTxO while a transaction that spends it is in flight.
 *
 * Inputs are booked during balancing, not submission, so a failure in between (proving fails, the process dies) can
 * leave a booking with no transaction behind it. `expiresAt` is the TTL of the transaction the booking was taken for:
 * past that instant the ledger would reject the transaction, so the booking cannot still be valid and is released.
 *
 * A booking is never persisted — see ADR 0008. It expresses the intent of a caller in this process, and that intent
 * does not outlive the process.
 */
export interface UtxoBooking {
  readonly expiresAt: Date;
}

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

/**
 * Every UTxO this wallet owns, and the reservations currently held against them.
 *
 * A coin is stored once, in `utxos`. A booking is a key into that map, in `bookings`. The available and pending views
 * consumers read are derived from the two (see {@link UnshieldedState.availableUtxos} and
 * {@link UnshieldedState.pendingUtxos}), so they cannot disagree and a coin cannot be in both — the defect in #697 is
 * not representable in this shape. ADR 0008 records the reasoning.
 */
export interface UnshieldedState {
  readonly utxos: HashMap.HashMap<UtxoHash, UtxoWithMeta>;
  readonly bookings: HashMap.HashMap<UtxoHash, UtxoBooking>;
}

/**
 * The canonical identity of a UTxO, and the key of both maps in {@link UnshieldedState}. Exported so no other layer
 * re-derives it: a second spelling of this key that drifts from the map keying would silently break any lookup or
 * change-detection built on it.
 */
export const UtxoHash = (utxo: ledger.Utxo): UtxoHash => `${utxo.intentHash}#${utxo.outputNo}`;

const hashesOf = (utxos: readonly UtxoWithMeta[]): readonly UtxoHash[] => utxos.map((utxo) => UtxoHash(utxo.utxo));

const entriesOf = (utxos: readonly UtxoWithMeta[]): readonly (readonly [UtxoHash, UtxoWithMeta])[] =>
  utxos.map((utxo) => [UtxoHash(utxo.utxo), utxo] as const);

export const UnshieldedState = {
  empty: (): UnshieldedState => ({
    utxos: HashMap.empty(),
    bookings: HashMap.empty(),
  }),

  /**
   * Restores state from persisted arrays.
   *
   * Both arrays are coins this wallet owns, so they are unioned into one map. Any booking the snapshot implied by
   * placing a coin in `pendingUtxos` is discarded: the process that took it is gone. This also repairs a snapshot
   * written by a version that could hold the same coin in both arrays — a map keyed by `intentHash#outputNo` cannot
   * hold it twice.
   *
   * @param availableUtxos - Coins the snapshot recorded as spendable.
   * @param pendingUtxos - Coins the snapshot recorded as booked.
   * @returns State owning every given coin, with no bookings.
   */
  restore: (availableUtxos: readonly UtxoWithMeta[], pendingUtxos: readonly UtxoWithMeta[]): UnshieldedState => ({
    utxos: HashMap.fromIterable([...entriesOf(availableUtxos), ...entriesOf(pendingUtxos)]),
    bookings: HashMap.empty(),
  }),

  /** The coins coin selection may draw on: owned, and not booked. */
  availableUtxos: (state: UnshieldedState): HashMap.HashMap<UtxoHash, UtxoWithMeta> =>
    HashMap.filter(state.utxos, (_, hash) => !HashMap.has(state.bookings, hash)),

  /** The coins a transaction in flight has reserved: owned, and booked. */
  pendingUtxos: (state: UnshieldedState): HashMap.HashMap<UtxoHash, UtxoWithMeta> =>
    HashMap.filter(state.utxos, (_, hash) => HashMap.has(state.bookings, hash)),

  spend: (
    state: UnshieldedState,
    utxo: UtxoWithMeta,
    booking: UtxoBooking,
  ): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo.utxo);
      if (!HashMap.has(state.utxos, hash) || HashMap.has(state.bookings, hash)) {
        return yield* Either.left(new UtxoNotFoundError({ utxo: utxo.utxo }));
      }
      // The coin itself does not move or change: booking it only adds a key.
      return { utxos: state.utxos, bookings: HashMap.set(state.bookings, hash, booking) };
    }),

  rollbackSpend: (state: UnshieldedState, utxo: UtxoWithMeta): Either.Either<UnshieldedState, never> => {
    // Rollbacks can't fail due to a utxo not found as it is possible and expected if there is a race between sync and revert call
    const hash = UtxoHash(utxo.utxo);
    if (!HashMap.has(state.bookings, hash)) {
      return Either.right(state);
    }
    return Either.right({
      utxos: HashMap.has(state.utxos, hash) ? state.utxos : HashMap.set(state.utxos, hash, utxo),
      bookings: HashMap.remove(state.bookings, hash),
    });
  },

  spendByUtxo: (
    state: UnshieldedState,
    utxo: ledger.Utxo,
    booking: UtxoBooking,
  ): Either.Either<UnshieldedState, UtxoNotFoundError> =>
    Either.gen(function* () {
      const hash = UtxoHash(utxo);
      // Probed directly rather than through the derived availableUtxos view: this runs once per selected input while
      // balancing, and materializing the filtered map would make each probe O(owned coins).
      const found = yield* Either.fromOption(
        HashMap.has(state.bookings, hash) ? Option.none() : HashMap.get(state.utxos, hash),
        () => new UtxoNotFoundError({ utxo }),
      );
      return yield* UnshieldedState.spend(state, found, booking);
    }),

  /**
   * Releases every booking that has reached its expiry.
   *
   * Inputs are booked during balancing, and the paths that release a booking on failure (the facade's proving and
   * submission catches, and an on-chain FAILURE) all require the transaction to have reached proving. A caller that
   * balances and then abandons the transaction before that — a different branch taken, its own code throwing — leaves
   * the booking outstanding with nothing to release it. Expiry is the reaper for that case.
   *
   * @param state - State to sweep.
   * @param now - Instant to judge expiry against.
   * @returns State with expired bookings removed; the same state if none had expired.
   */
  expireBookings: (state: UnshieldedState, now: Date): UnshieldedState => {
    const expired = Array.from(HashMap.entries(state.bookings))
      .filter(([, booking]) => booking.expiresAt.getTime() <= now.getTime())
      .map(([hash]) => hash);

    return expired.length === 0 ? state : { utxos: state.utxos, bookings: HashMap.removeMany(state.bookings, expired) };
  },

  rollbackSpendByUtxo: (state: UnshieldedState, utxo: ledger.Utxo): Either.Either<UnshieldedState, never> =>
    pipe(
      // Same direct probe as spendByUtxo, for the same hot-path reason.
      HashMap.has(state.bookings, UtxoHash(utxo)) ? HashMap.get(state.utxos, UtxoHash(utxo)) : Option.none(),
      Option.match({
        onNone: () => Either.right(state),
        onSome: (found) => UnshieldedState.rollbackSpend(state, found),
      }),
    ),

  applyUpdate: (
    state: UnshieldedState,
    update: UnshieldedUpdate,
  ): Either.Either<UnshieldedState, ApplyTransactionError> =>
    Either.gen(function* () {
      if (!['SUCCESS', 'PARTIAL_SUCCESS'].includes(update.status)) {
        return yield* Either.left(new ApplyTransactionError({ message: `Invalid status: ${update.status}` }));
      }

      const spentHashes = hashesOf(update.spentUtxos);

      // A replayed creation of a coin that is currently booked overwrites its entry rather than adding a second one,
      // and its booking is untouched. That is the property the two-map shape could not offer.
      return {
        utxos: HashMap.union(
          HashMap.removeMany(state.utxos, spentHashes),
          HashMap.fromIterable(entriesOf(update.createdUtxos)),
        ),
        bookings: HashMap.removeMany(state.bookings, spentHashes),
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

      const spentHashes = hashesOf(update.spentUtxos);

      return {
        utxos: HashMap.union(state.utxos, HashMap.fromIterable(entriesOf(update.spentUtxos))),
        bookings: HashMap.removeMany(state.bookings, spentHashes),
      };
    }),

  toArrays: (
    state: UnshieldedState,
  ): {
    readonly availableUtxos: readonly UtxoWithMeta[];
    readonly pendingUtxos: readonly UtxoWithMeta[];
  } => ({
    availableUtxos: HashMap.toValues(UnshieldedState.availableUtxos(state)),
    pendingUtxos: HashMap.toValues(UnshieldedState.pendingUtxos(state)),
  }),
} as const;
