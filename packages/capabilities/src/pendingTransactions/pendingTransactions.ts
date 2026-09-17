/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Array as Arr, DateTime, Either, Order, type ParseResult, pipe, Schema } from 'effect';

export type TransactionTrait<TTransaction> = {
  ids: (tx: TTransaction) => readonly string[];
  firstId: (tx: TTransaction) => string;
  areAllTxIdsIncluded: (tx: TTransaction, txIds: readonly string[]) => boolean;
  isOneIncludedInOther: (tx: TTransaction, otherTx: TTransaction) => boolean;
  hasTTLExpired: (tx: TTransaction, txCreationTime: DateTime.Utc, now: DateTime.Utc) => boolean;
  serialize: (tx: TTransaction) => Uint8Array;
  deserialize: (serialized: Uint8Array) => TTransaction;
  isTx: (tx: unknown) => tx is TTransaction;
};
export type HasTransactionTrait<TTransaction> = { txTrait: TransactionTrait<TTransaction> };

// Compatible with the GraphQL API
export type FailedTransactionResult = Readonly<{
  segments: ReadonlyArray<{ id: number; success: boolean }>;
  status: 'PARTIAL_SUCCESS' | 'FAILURE';
}>;
export type SuccessTransactionResult = Readonly<{
  segments: ReadonlyArray<{ id: number; success: boolean }>;
  status: 'SUCCESS';
}>;
export type TransactionResult = FailedTransactionResult | SuccessTransactionResult;

export type PendingItem<TTransaction> = Readonly<{
  tx: TTransaction;
  creationTime: DateTime.Utc;
}>;
export type CheckedItem<TTransaction> = PendingItem<TTransaction> & { result: TransactionResult };
export type PendingTransactionsItem<TTransaction> = PendingItem<TTransaction> | CheckedItem<TTransaction>;
export type FailedTransactionItem<TTransaction> = PendingTransactionsItem<TTransaction> & {
  result: FailedTransactionResult;
};

/**
 * A transaction that has been balanced but not yet proven or submitted.
 *
 * Balancing reserves the coins a transaction will spend, and until the transaction is submitted nothing else records
 * that those coins are spoken for — so a transaction abandoned in between strands them. A reservation is that missing
 * record. It never holds the transaction itself: an unproven transaction carries key material and must not be
 * persisted.
 *
 * `identifiers` is what ties a reservation to the transaction that later arrives, and it is stable: proving and binding
 * both leave a transaction's identifiers unchanged. `intentHashes` is kept alongside because it is the value the ledger
 * stamps on the coins the transaction creates.
 */
export type Reservation = Readonly<{
  identifiers: readonly string[];
  intentHashes: readonly string[];
  /** Ids of the coins this transaction reserved, per wallet, so each wallet can release its own. */
  inputs: Readonly<{ unshielded: readonly string[] }>;
  /** The transaction's TTL: from this instant the ledger rejects it, so the reservation cannot still be valid. */
  ttl: Date;
  createdAt: DateTime.Utc;
  expired: boolean;
}>;

export type PendingTransactions<TTransaction> = Readonly<{
  all: ReadonlyArray<PendingTransactionsItem<TTransaction>>;
  reservations: ReadonlyArray<Reservation>;
}>;

/** Two reservations, or a reservation and a transaction, are the same spend if they share any identifier. */
const sharesIdentifier = (reservation: Reservation, identifiers: readonly string[]): boolean =>
  reservation.identifiers.some((id) => identifiers.includes(id));

/**
 * Records a balanced transaction, replacing any earlier reservation for the same spend.
 *
 * @example
 *   const held = addReservation(state, { identifiers: tx.identifiers(), inputs: { unshielded: ids }, ttl });
 *
 * @param state - The pending transactions to add to
 * @param reservation - The record of what the balanced transaction booked
 * @returns The state with that reservation held, and any it replaces gone
 */
export const addReservation = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  reservation: Reservation,
): PendingTransactions<TTransaction> => ({
  ...state,
  reservations: Arr.append(
    Arr.filter(state.reservations, (existing) => !sharesIdentifier(existing, reservation.identifiers)),
    reservation,
  ),
});

/**
 * Forgets every reservation holding one of `identifiers`.
 *
 * @example
 *   const cleared = clearReservation(state, [...tx.identifiers()]);
 *
 * @param state - The pending transactions to clear from
 * @param identifiers - Identifiers of the spend whose record is finished with
 * @returns The state with those reservations gone; identifiers no reservation holds are ignored
 */
export const clearReservation = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  identifiers: readonly string[],
): PendingTransactions<TTransaction> => ({
  ...state,
  reservations: Arr.filter(state.reservations, (reservation) => !sharesIdentifier(reservation, identifiers)),
});

/**
 * Marks every reservation whose TTL `now` has passed. Marked rather than removed, mirroring how a failed transaction is
 * kept until a caller has acted on it: the coins still have to be released before the record is dropped.
 *
 * Passed, not reached: the ledger accepts an intent while its TTL is at or after the block's timestamp, so a
 * transaction is still perfectly valid at the instant its TTL names.
 *
 * Returns the state it was given when nothing reaches its expiry. This runs on a timer, so most visits change nothing,
 * and handing back the same value is what lets a caller publish only when something actually moved.
 *
 * @example
 *   const swept = expireReservations(state, DateTime.unsafeNow());
 *
 * @param state - The pending transactions to sweep
 * @param now - The instant to expire against
 * @returns The state with newly expired reservations marked, or the same state when none is
 */
export const expireReservations = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  now: DateTime.Utc,
): PendingTransactions<TTransaction> => {
  const hasExpiry = (reservation: Reservation): boolean =>
    !reservation.expired && reservation.ttl.getTime() < DateTime.toEpochMillis(now);

  return Arr.some(state.reservations, hasExpiry)
    ? {
        ...state,
        reservations: Arr.map(state.reservations, (reservation) =>
          hasExpiry(reservation) ? { ...reservation, expired: true } : reservation,
        ),
      }
    : state;
};

/**
 * The unshielded coin ids some spend still accounts for.
 *
 * Every reservation's inputs, plus the inputs of every transaction being tracked. Both halves are needed: a reservation
 * covers a transaction that was balanced and never submitted, and registering a transaction drops the reservation
 * standing in for it, so from submission onwards only the tracked transaction says the coins are spoken for.
 *
 * @example
 *   const spokenFor = coveredUnshieldedIds(pending, (tx) => ownInputIdsOf(tx));
 *
 * @param state - The reservations and tracked transactions to read
 * @param unshieldedInputsOf - How to name the unshielded coins a tracked transaction spends
 * @returns Every such coin id, without repeats
 */
export const coveredUnshieldedIds = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  unshieldedInputsOf: (tx: TTransaction) => readonly string[],
): readonly string[] =>
  pipe(
    Arr.appendAll(
      Arr.flatMap(state.reservations, (reservation) => reservation.inputs.unshielded),
      Arr.flatMap(state.all, (item) => unshieldedInputsOf(item.tx)),
    ),
    Arr.dedupe,
  );

/**
 * The reservations whose transactions can no longer be accepted, and whose coins are therefore free.
 *
 * Expiry marks a reservation rather than removing it, so this is what a caller reads to find the records it still has
 * to act on before dropping them.
 *
 * @example
 *   const finished = allExpiredReservations(state);
 *
 * @param state - The pending transactions to read
 * @returns The marked reservations, in the order they were added; empty when none has expired
 */
export const allExpiredReservations = <TTransaction>(
  state: PendingTransactions<TTransaction>,
): ReadonlyArray<Reservation> => Arr.filter(state.reservations, (reservation) => reservation.expired);

export const has = <TTransaction>(
  transactions: PendingTransactions<TTransaction>,
  transaction: TTransaction,
  txTrait: TransactionTrait<TTransaction>,
): boolean => {
  return transactions.all.some((item) => txTrait.areAllTxIdsIncluded(transaction, txTrait.ids(item.tx)));
};

export const all = <TTransaction>(transactions: PendingTransactions<TTransaction>): readonly TTransaction[] => {
  return transactions.all.map((item) => item.tx);
};

export const allFailed = <TTransaction>(
  transactions: PendingTransactions<TTransaction>,
): ReadonlyArray<FailedTransactionItem<TTransaction>> => {
  return transactions.all.filter(
    (item): item is FailedTransactionItem<TTransaction> =>
      'result' in item && (item.result?.status === 'FAILURE' || item.result?.status === 'PARTIAL_SUCCESS'),
  );
};

export const allPending = <TTransaction>(
  state: PendingTransactions<TTransaction>,
): readonly PendingItem<TTransaction>[] => {
  return state.all.filter(
    (item): item is PendingItem<TTransaction> => !('result' in item) || item.result === undefined,
  );
};

export const empty = <TTransaction>(): PendingTransactions<TTransaction> => {
  return {
    all: [],
    reservations: [],
  };
};

export const addPendingTransaction = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  tx: TTransaction,
  now: DateTime.Utc,
  txTrait: TransactionTrait<TTransaction>,
): PendingTransactions<TTransaction> => {
  const [rest, foundMatching] = pipe(
    state.all,
    Arr.partition((item) => txTrait.isOneIncludedInOther(tx, item.tx)),
  );
  const allMatchingTransactions = Arr.append(foundMatching, { tx, creationTime: now });
  const theBiggestMatchingTx = Arr.max(
    allMatchingTransactions,
    pipe(
      Order.number,
      Order.mapInput((input: TTransaction) => txTrait.ids(input).length),
      Order.mapInput((input: PendingTransactionsItem<TTransaction>) => input.tx),
    ),
  );
  return {
    ...state,
    all: Arr.append(rest, theBiggestMatchingTx),
    // The transaction now stands for the spend its reservation was holding open, and carries the same identifiers.
    reservations: Arr.filter(state.reservations, (reservation) => !sharesIdentifier(reservation, txTrait.ids(tx))),
  };
};

export const clear = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  tx: TTransaction,
  txTrait: TransactionTrait<TTransaction>,
): PendingTransactions<TTransaction> => {
  return {
    ...state,
    all: Arr.filter(state.all, (item) => !txTrait.areAllTxIdsIncluded(item.tx, txTrait.ids(tx))),
    // Whatever stopped tracking the transaction — a revert, or a spend that confirmed — also ends the reservation.
    reservations: Arr.filter(state.reservations, (reservation) => !sharesIdentifier(reservation, txTrait.ids(tx))),
  };
};

export const saveResult = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  tx: TTransaction,
  result: TransactionResult,
  txTrait: TransactionTrait<TTransaction>,
): PendingTransactions<TTransaction> => {
  return {
    ...state,
    all: Arr.map(state.all, (item) => {
      return txTrait.areAllTxIdsIncluded(item.tx, txTrait.ids(tx)) ? { ...item, result } : item;
    }),
  };
};

const ReservationSchema = Schema.Struct({
  identifiers: Schema.Array(Schema.String),
  intentHashes: Schema.Array(Schema.String),
  inputs: Schema.Struct({ unshielded: Schema.Array(Schema.String) }),
  ttl: Schema.Date,
  createdAt: Schema.DateTimeUtc,
  expired: Schema.Boolean,
});

/**
 * The stored shape. Reservations arrived after the format was already in the field, so they are an optional member of
 * the version that was already there rather than a version of their own: a reader that predates them sees the version
 * it knows and ignores the member it does not, which is what keeps a store written here readable by an older package.
 *
 * A snapshot that omits them records no reservations, which is the truth about what the writer knew.
 */
type Serialized<TTransaction> = Readonly<{
  version: 'v1';
  transactions: readonly PendingItem<TTransaction>[];
  reservations: readonly Reservation[];
}>;

export const SerializedSchema = <TTransaction>(
  txTrait: TransactionTrait<TTransaction>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- it's pointless in this place as we don't care about the input data type really
): Schema.Schema<Serialized<TTransaction>, any> => {
  const TxSchema = Schema.declare<TTransaction>((tx: unknown): tx is TTransaction => txTrait.isTx(tx));
  const TxFromHex: Schema.Schema<TTransaction, string> = Schema.transform(Schema.Uint8ArrayFromHex, TxSchema, {
    encode: (tx): Uint8Array => txTrait.serialize(tx),
    decode: (bytes) => txTrait.deserialize(bytes),
  });
  const TxItemSchema = Schema.Struct({
    tx: TxFromHex,
    creationTime: Schema.DateTimeUtc,
  });

  return Schema.Struct({
    version: Schema.Literal('v1'),
    transactions: Schema.Array(TxItemSchema),
    reservations: Schema.optionalWith(Schema.Array(ReservationSchema), { default: () => [] }),
  });
};

export const serialize = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  txTrait: TransactionTrait<TTransaction>,
): string => pipe(state, toSerialized, Schema.encodeSync(SerializedSchema(txTrait)), JSON.stringify);

export const deserialize = <TTransaction>(
  serialized: string,
  txTrait: TransactionTrait<TTransaction>,
): Either.Either<PendingTransactions<TTransaction>, ParseResult.ParseError> => {
  return pipe(
    serialized,
    Schema.decodeUnknownEither(Schema.parseJson(SerializedSchema<TTransaction>(txTrait))),
    Either.map((data) => fromSerialized<TTransaction>(data)),
  );
};

export const toSerialized = <TTransaction>(
  pendingTransactions: PendingTransactions<TTransaction>,
): Serialized<TTransaction> => {
  return {
    version: 'v1',
    transactions: pendingTransactions.all,
    reservations: pendingTransactions.reservations,
  };
};

export const fromSerialized = <TTransaction>(
  serialized: Serialized<TTransaction>,
): PendingTransactions<TTransaction> => {
  return {
    all: serialized.transactions,
    reservations: serialized.reservations,
  };
};
