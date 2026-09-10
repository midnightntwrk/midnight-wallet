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

/** Records a balanced transaction, replacing any earlier reservation for the same spend. */
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

/** Forgets every reservation holding one of `identifiers`. */
export const clearReservation = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  identifiers: readonly string[],
): PendingTransactions<TTransaction> => ({
  ...state,
  reservations: Arr.filter(state.reservations, (reservation) => !sharesIdentifier(reservation, identifiers)),
});

/**
 * Marks every reservation whose TTL `now` has reached. Marked rather than removed, mirroring how a failed transaction
 * is kept until a caller has acted on it: the coins still have to be released before the record is dropped.
 */
export const expireReservations = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  now: DateTime.Utc,
): PendingTransactions<TTransaction> => ({
  ...state,
  reservations: Arr.map(state.reservations, (reservation) =>
    reservation.expired || reservation.ttl.getTime() > DateTime.toEpochMillis(now)
      ? reservation
      : { ...reservation, expired: true },
  ),
});

/** The reservations whose transactions can no longer be accepted, and whose coins are therefore free. */
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

//It has to stay immutable in the code now. Any changes made should be separate schemas with fallbacks/conversions
type Serialized<TTransaction> = Readonly<{
  version: 'v1';
  transactions: readonly PendingItem<TTransaction>[];
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
  });
};

const ReservationSchema = Schema.Struct({
  identifiers: Schema.Array(Schema.String),
  intentHashes: Schema.Array(Schema.String),
  inputs: Schema.Struct({ unshielded: Schema.Array(Schema.String) }),
  ttl: Schema.Date,
  createdAt: Schema.DateTimeUtc,
  expired: Schema.Boolean,
});

/** `v1` plus the reservations. Written by every `serialize`; `v1` is still read, and decodes to no reservations. */
type SerializedV2<TTransaction> = Readonly<{
  version: 'v2';
  transactions: readonly PendingItem<TTransaction>[];
  reservations: readonly Reservation[];
}>;

export const SerializedV2Schema = <TTransaction>(
  txTrait: TransactionTrait<TTransaction>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above, the encoded side is plain JSON
): Schema.Schema<SerializedV2<TTransaction>, any> => {
  const TxSchema = Schema.declare<TTransaction>((tx: unknown): tx is TTransaction => txTrait.isTx(tx));
  const TxFromHex: Schema.Schema<TTransaction, string> = Schema.transform(Schema.Uint8ArrayFromHex, TxSchema, {
    encode: (tx): Uint8Array => txTrait.serialize(tx),
    decode: (bytes) => txTrait.deserialize(bytes),
  });

  return Schema.Struct({
    version: Schema.Literal('v2'),
    transactions: Schema.Array(Schema.Struct({ tx: TxFromHex, creationTime: Schema.DateTimeUtc })),
    reservations: Schema.Array(ReservationSchema),
  });
};

/** Every format this module can read. A snapshot written by a newer version is refused rather than half-read. */
const AnySerializedSchema = <TTransaction>(
  txTrait: TransactionTrait<TTransaction>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
): Schema.Schema<SerializedV2<TTransaction> | Serialized<TTransaction>, any> =>
  Schema.Union(SerializedV2Schema(txTrait), SerializedSchema(txTrait));

export const serialize = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  txTrait: TransactionTrait<TTransaction>,
): string => pipe(state, toSerialized, Schema.encodeSync(SerializedV2Schema(txTrait)), JSON.stringify);

export const deserialize = <TTransaction>(
  serialized: string,
  txTrait: TransactionTrait<TTransaction>,
): Either.Either<PendingTransactions<TTransaction>, ParseResult.ParseError> => {
  return pipe(
    serialized,
    Schema.decodeUnknownEither(Schema.parseJson(AnySerializedSchema<TTransaction>(txTrait))),
    Either.map((data) => fromSerialized<TTransaction>(data)),
  );
};

export const toSerialized = <TTransaction>(
  pendingTransactions: PendingTransactions<TTransaction>,
): SerializedV2<TTransaction> => {
  return {
    version: 'v2',
    transactions: pendingTransactions.all,
    reservations: pendingTransactions.reservations,
  };
};

export const fromSerialized = <TTransaction>(
  serialized: SerializedV2<TTransaction> | Serialized<TTransaction>,
): PendingTransactions<TTransaction> => {
  return {
    all: serialized.transactions,
    // A snapshot written before reservations existed records none, which is the truth about what it knew.
    reservations: serialized.version === 'v2' ? serialized.reservations : [],
  };
};
