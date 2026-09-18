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

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Buffer } from 'buffer';
import { Array as Arr, type DateTime, Either, Option, Order, ParseResult, pipe, Schema } from 'effect';

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

/**
 * The transaction traits a wallet can read pending transactions with, keyed by the protocol version range each one
 * serves.
 *
 * @remarks
 *   A transaction's bytes, identifiers and TTL are only meaningful under the ledger version it was authored against, so
 *   which trait applies is a property of the transaction rather than of the wallet holding it. Keeping that in the
 *   shared {@link ProtocolVersion.Registry} means the boundary between two traits is the same boundary variant selection
 *   and codec selection use.
 */
export type VersionedTransactionTrait<TTransaction> = ProtocolVersion.Registry<TransactionTrait<TTransaction>>;

export type HasVersionedTransactionTrait<TTransaction> = { txTraits: VersionedTransactionTrait<TTransaction> };

/** Registers one trait for every protocol version: the shape a wallet that speaks a single ledger version has. */
export const singleTrait = <TTransaction>(
  trait: TransactionTrait<TTransaction>,
): VersionedTransactionTrait<TTransaction> => ({
  entries: [
    {
      range: ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion),
      value: trait,
    },
  ],
});

/** The oldest registered trait: what an envelope that carries no version stamp is read with. */
export const headTrait = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
): Option.Option<TransactionTrait<TTransaction>> =>
  Option.fromNullable(traits.entries.at(0)).pipe(Option.map((entry) => entry.value));

/**
 * The trait registered for a protocol version, or the oldest trait when nothing says which version applies.
 *
 * @remarks
 *   Falling back to the oldest trait is the same convention snapshot restore uses for an envelope written before versions
 *   were recorded: the only envelopes without a stamp are ones written before stamping existed, and those necessarily
 *   predate every version boundary since.
 * @param traits The registered traits.
 * @param protocolVersion The version the transaction was authored for, when one is known.
 * @returns The trait to read with, or `Option.none()` when the version falls outside every registered range.
 */
export const traitForVersion = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
): Option.Option<TransactionTrait<TTransaction>> =>
  Option.match(protocolVersion, {
    onNone: () => headTrait(traits),
    onSome: (version) => ProtocolVersion.select(traits, version),
  });

/** The registered trait that recognises a transaction object as its own, if any does. */
export const recognisingTrait = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  tx: unknown,
): Option.Option<TransactionTrait<TTransaction>> =>
  Option.fromNullable(traits.entries.find((entry) => entry.value.isTx(tx))).pipe(Option.map((entry) => entry.value));

/**
 * The trait to read an incoming transaction with: the one that recognises it, or the oldest as a last resort.
 *
 * @param traits The registered traits.
 * @param tx The transaction to place.
 * @returns The trait that owns `tx`, the oldest trait when none claims it, or `Option.none()` when nothing is
 *   registered at all.
 */
export const traitForTx = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  tx: TTransaction,
): Option.Option<TransactionTrait<TTransaction>> =>
  Option.orElse(recognisingTrait(traits, tx), () => headTrait(traits));

// Compatible with the GraphQL API
export type FailedTransactionResult = Readonly<{
  segments: ReadonlyArray<{ id: number; success: boolean }>;
  status: 'PARTIAL_SUCCESS' | 'FAILURE';
}>;
export type SuccessTransactionResult = Readonly<{
  segments: ReadonlyArray<{ id: number; success: boolean }>;
  status: 'SUCCESS';
}>;

/**
 * The verdict on a transaction a protocol upgrade left behind.
 *
 * @remarks
 *   Deliberately not one of the indexer's statuses: the chain never reported anything about this transaction and never
 *   will, because bytes authored under the previous protocol version cannot be included under the new one. Saying so in
 *   its own arm keeps "the node rejected this" and "this can no longer be submitted at all" distinguishable.
 */
export type OrphanedByForkResult = Readonly<{
  status: 'ORPHANED_BY_FORK';
  /** The protocol version the transaction was authored for. */
  authoredFor: ProtocolVersion.ProtocolVersion;
  /** The protocol version the chain had reached when the wallet gave up on it. */
  chainNow: ProtocolVersion.ProtocolVersion;
}>;

export type TransactionResult = FailedTransactionResult | SuccessTransactionResult | OrphanedByForkResult;

export type PendingItem<TTransaction> = Readonly<{
  tx: TTransaction;
  creationTime: DateTime.Utc;
  /**
   * The protocol version the transaction was authored for, when the wallet had observed one.
   *
   * @remarks
   *   `Option.none()` means the wallet never learned what version it was authored against — either the envelope predates
   *   stamping, or no wallet had reported a version yet. That is not evidence the transaction was left behind, so such
   *   an item is read with the oldest trait but never orphaned.
   */
  protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>;
}>;
export type CheckedItem<TTransaction> = PendingItem<TTransaction> & { result: TransactionResult };
export type PendingTransactionsItem<TTransaction> = PendingItem<TTransaction> | CheckedItem<TTransaction>;
export type FailedTransactionItem<TTransaction> = PendingTransactionsItem<TTransaction> & {
  result: FailedTransactionResult;
};
export type OrphanedTransactionItem<TTransaction> = PendingTransactionsItem<TTransaction> & {
  result: OrphanedByForkResult;
};
/** An item the wallet has given up on, whether the chain rejected it or a protocol upgrade stranded it. */
export type RejectedTransactionItem<TTransaction> = PendingTransactionsItem<TTransaction> & {
  result: FailedTransactionResult | OrphanedByForkResult;
};

export type PendingTransactions<TTransaction> = Readonly<{
  all: ReadonlyArray<PendingTransactionsItem<TTransaction>>;
}>;

const traitOfItem = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  item: PendingTransactionsItem<TTransaction>,
): Option.Option<TransactionTrait<TTransaction>> => traitForVersion(traits, item.protocolVersion);

/** Two versions are in the same epoch when the registry answers them with the same trait. */
const sameEpoch = <TTransaction>(
  a: Option.Option<TransactionTrait<TTransaction>>,
  b: Option.Option<TransactionTrait<TTransaction>>,
): boolean => Option.getEquivalence<TransactionTrait<TTransaction>>((left, right) => left === right)(a, b);

const idsOf = <TTransaction>(traits: VersionedTransactionTrait<TTransaction>, tx: TTransaction): readonly string[] =>
  traitForTx(traits, tx).pipe(
    Option.map((trait) => trait.ids(tx)),
    Option.getOrElse((): readonly string[] => []),
  );

/** A stored item's identifiers, read with the trait registered for the version it was stamped with. */
const idsOfItem = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  item: PendingTransactionsItem<TTransaction>,
): readonly string[] =>
  traitOfItem(traits, item).pipe(
    Option.map((trait) => trait.ids(item.tx)),
    Option.getOrElse((): readonly string[] => []),
  );

/** Whether a stored item is covered by the identifiers of an incoming transaction, each read with its own trait. */
const isCoveredBy = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  item: PendingTransactionsItem<TTransaction>,
  txIds: readonly string[],
): boolean =>
  traitOfItem(traits, item).pipe(
    Option.map((trait) => trait.areAllTxIdsIncluded(item.tx, txIds)),
    Option.getOrElse(() => false),
  );

export const has = <TTransaction>(
  transactions: PendingTransactions<TTransaction>,
  transaction: TTransaction,
  traits: VersionedTransactionTrait<TTransaction>,
): boolean =>
  traitForTx(traits, transaction).pipe(
    Option.map((trait) =>
      transactions.all.some((item) => trait.areAllTxIdsIncluded(transaction, idsOfItem(traits, item))),
    ),
    Option.getOrElse(() => false),
  );

export const all = <TTransaction>(transactions: PendingTransactions<TTransaction>): readonly TTransaction[] => {
  return transactions.all.map((item) => item.tx);
};

const resultOf = <TTransaction>(item: PendingTransactionsItem<TTransaction>): Option.Option<TransactionResult> =>
  'result' in item ? Option.fromNullable(item.result) : Option.none();

export const allFailed = <TTransaction>(
  transactions: PendingTransactions<TTransaction>,
): ReadonlyArray<FailedTransactionItem<TTransaction>> => {
  return transactions.all.filter(
    (item): item is FailedTransactionItem<TTransaction> =>
      'result' in item && (item.result?.status === 'FAILURE' || item.result?.status === 'PARTIAL_SUCCESS'),
  );
};

/** Transactions a protocol upgrade stranded: they were authored for a version the chain has moved past. */
export const allOrphaned = <TTransaction>(
  transactions: PendingTransactions<TTransaction>,
): ReadonlyArray<OrphanedTransactionItem<TTransaction>> => {
  return transactions.all.filter(
    (item): item is OrphanedTransactionItem<TTransaction> =>
      'result' in item && item.result?.status === 'ORPHANED_BY_FORK',
  );
};

/**
 * Everything the wallet has given up on, in the order it was added: reported failures and orphaned transactions alike.
 * Both need the same treatment — unbook the coins, record the rejection — so both belong on one list.
 */
export const allRejected = <TTransaction>(
  transactions: PendingTransactions<TTransaction>,
): ReadonlyArray<RejectedTransactionItem<TTransaction>> => {
  return transactions.all.filter(
    (item): item is RejectedTransactionItem<TTransaction> =>
      'result' in item &&
      (item.result?.status === 'FAILURE' ||
        item.result?.status === 'PARTIAL_SUCCESS' ||
        item.result?.status === 'ORPHANED_BY_FORK'),
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

/**
 * Records a transaction as pending, stamped with the protocol version it was authored for.
 *
 * @param state The pending transactions.
 * @param tx The transaction to record.
 * @param now The time it was authored.
 * @param traits The traits pending transactions are read with.
 * @param protocolVersion The version the chain had reached when it was authored, when the wallet knew one.
 * @returns The pending transactions including `tx`, with any superseded entry from the same version epoch replaced.
 */
export const addPendingTransaction = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  tx: TTransaction,
  now: DateTime.Utc,
  traits: VersionedTransactionTrait<TTransaction>,
  protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
): PendingTransactions<TTransaction> => {
  const trait = traitForVersion(traits, protocolVersion);
  const item: PendingItem<TTransaction> = { tx, creationTime: now, protocolVersion };

  // Whether one transaction supersedes another is a question only a single ledger version can answer — across a
  // version boundary the two were authored against different rules, so they are simply different transactions.
  const [rest, foundMatching] = pipe(
    state.all,
    Arr.partition(
      (existing) =>
        sameEpoch(traitOfItem(traits, existing), trait) &&
        Option.match(trait, {
          onNone: () => false,
          onSome: (found) => found.isOneIncludedInOther(tx, existing.tx),
        }),
    ),
  );

  const idCount = (candidate: PendingTransactionsItem<TTransaction>): number =>
    Option.match(trait, { onNone: () => 0, onSome: (found) => found.ids(candidate.tx).length });

  const theBiggestMatchingTx = Arr.max(Arr.append(foundMatching, item), pipe(Order.number, Order.mapInput(idCount)));

  return {
    ...state,
    all: Arr.append(rest, theBiggestMatchingTx),
  };
};

export const clear = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  tx: TTransaction,
  traits: VersionedTransactionTrait<TTransaction>,
): PendingTransactions<TTransaction> => {
  const txIds = idsOf(traits, tx);
  return {
    ...state,
    all: Arr.filter(state.all, (item) => !isCoveredBy(traits, item, txIds)),
  };
};

export const saveResult = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  tx: TTransaction,
  result: TransactionResult,
  traits: VersionedTransactionTrait<TTransaction>,
): PendingTransactions<TTransaction> => {
  const txIds = idsOf(traits, tx);
  return {
    ...state,
    all: Arr.map(state.all, (item) => (isCoveredBy(traits, item, txIds) ? { ...item, result } : item)),
  };
};

/**
 * Gives up on every unresolved transaction whose version epoch the chain has moved past.
 *
 * @remarks
 *   The epochs are the registry's own ranges, so "the chain has moved past" means exactly "a different trait answers for
 *   the chain now than answered for this transaction". A transaction authored under the previous protocol version can
 *   never be included afterwards, so waiting for its TTL only delays the inevitable and holds its coins hostage
 *   meanwhile.
 * @param state The pending transactions.
 * @param traits The traits pending transactions are read with, whose ranges define the epochs.
 * @param chainNow The protocol version the wallets have reached.
 * @returns The pending transactions with the stranded ones given an {@link OrphanedByForkResult}.
 */
export const orphanBeyond = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  traits: VersionedTransactionTrait<TTransaction>,
  chainNow: ProtocolVersion.ProtocolVersion,
): PendingTransactions<TTransaction> => ({
  ...state,
  all: Arr.map(state.all, (item) =>
    Option.isSome(resultOf(item))
      ? item
      : Option.match(item.protocolVersion, {
          onNone: () => item,
          onSome: (authoredFor) =>
            hasEpochEnded(traits, authoredFor, chainNow)
              ? { ...item, result: { status: 'ORPHANED_BY_FORK' as const, authoredFor, chainNow } }
              : item,
        }),
  ),
});

const hasEpochEnded = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  authoredFor: ProtocolVersion.ProtocolVersion,
  chainNow: ProtocolVersion.ProtocolVersion,
): boolean =>
  ProtocolVersion.selectEntry(traits, authoredFor).pipe(
    Option.map((entry) => chainNow >= entry.range[1]),
    Option.getOrElse(() => false),
  );

//It has to stay immutable in the code now. Any changes made should be separate schemas with fallbacks/conversions
type Serialized<TTransaction> = Readonly<{
  version: 'v1';
  transactions: readonly PendingItem<TTransaction>[];
}>;

const WireItemSchema = Schema.Struct({
  tx: Schema.String,
  creationTime: Schema.DateTimeUtc,
  // Additive: envelopes written before transactions were stamped simply omit it, and decode to `Option.none()`.
  protocolVersion: Schema.optionalWith(ProtocolVersion.ProtocolVersionSchema, { as: 'Option' }),
});

const PendingItemSchema = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
): Schema.Schema<PendingItem<TTransaction>, Schema.Schema.Encoded<typeof WireItemSchema>> => {
  const TxSchema = Schema.declare<TTransaction>((tx: unknown): tx is TTransaction =>
    Option.isSome(recognisingTrait(traits, tx)),
  );
  const DomainSchema = Schema.typeSchema(
    Schema.Struct({
      tx: TxSchema,
      creationTime: Schema.DateTimeUtc,
      protocolVersion: Schema.OptionFromSelf(ProtocolVersion.ProtocolVersionSchema),
    }),
  );

  return Schema.asSchema(
    Schema.transformOrFail(WireItemSchema, DomainSchema, {
      strict: true,
      decode: (wire, _options, ast) =>
        pipe(
          traitForVersion(traits, wire.protocolVersion),
          Either.fromOption(
            () =>
              new ParseResult.Type(
                ast,
                wire,
                `No transaction trait is registered for protocol version ${Option.getOrElse(wire.protocolVersion, () => 'unknown' as const)}.`,
              ),
          ),
          Either.flatMap((trait) =>
            Either.try({
              try: () => trait.deserialize(Buffer.from(wire.tx, 'hex')),
              catch: (cause) =>
                new ParseResult.Type(ast, wire, `Could not read the pending transaction: ${String(cause)}`),
            }),
          ),
          Either.map((tx) => ({ tx, creationTime: wire.creationTime, protocolVersion: wire.protocolVersion })),
        ),
      encode: (item, _options, ast) =>
        pipe(
          traitForTx(traits, item.tx),
          Either.fromOption(() => new ParseResult.Type(ast, item, 'No transaction trait is registered.')),
          Either.flatMap((trait) =>
            Either.try({
              try: () => Buffer.from(trait.serialize(item.tx)).toString('hex'),
              catch: (cause) =>
                new ParseResult.Type(ast, item, `Could not write the pending transaction: ${String(cause)}`),
            }),
          ),
          Either.map((tx) => ({ tx, creationTime: item.creationTime, protocolVersion: item.protocolVersion })),
        ),
    }),
  );
};

export const SerializedSchema = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- it's pointless in this place as we don't care about the input data type really
): Schema.Schema<Serialized<TTransaction>, any> =>
  Schema.Struct({
    version: Schema.Literal('v1'),
    transactions: Schema.Array(PendingItemSchema(traits)),
  });

export const serialize = <TTransaction>(
  state: PendingTransactions<TTransaction>,
  traits: VersionedTransactionTrait<TTransaction>,
): string => pipe(state, toSerialized, Schema.encodeSync(SerializedSchema(traits)), JSON.stringify);

export const deserialize = <TTransaction>(
  serialized: string,
  traits: VersionedTransactionTrait<TTransaction>,
): Either.Either<PendingTransactions<TTransaction>, ParseResult.ParseError> => {
  return pipe(
    serialized,
    Schema.decodeUnknownEither(Schema.parseJson(SerializedSchema<TTransaction>(traits))),
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
