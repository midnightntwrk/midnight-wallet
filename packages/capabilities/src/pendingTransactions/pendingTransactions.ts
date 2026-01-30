/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) 2025 Midnight Foundation
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

import { Array as Arr, DateTime, Either, Order, ParseResult, pipe, Schema } from 'effect';

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

export type PendingTransactions<TTransaction> = Readonly<{
  all: ReadonlyArray<PendingTransactionsItem<TTransaction>>;
}>;

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
  };
};

export const fromSerialized = <TTransaction>(
  serialized: Serialized<TTransaction>,
): PendingTransactions<TTransaction> => {
  return {
    all: serialized.transactions,
  };
};
