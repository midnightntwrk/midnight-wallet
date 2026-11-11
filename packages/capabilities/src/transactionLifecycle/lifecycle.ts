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

/**
 * One record per transaction, from the moment it is balanced to the moment nothing can change its outcome.
 *
 * @remarks
 *   The states, what moves a record between them and what each stores are decided in ADR 0011. Every transition here is
 *   total: an event that does not apply to a record leaves it as it was, so a final state never moves, save that a
 *   reported inclusion overrules an end the wallet only inferred. No transition frees a coin; each wallet's own sweep
 *   does.
 */

import { ProtocolVersion, SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { Buffer } from 'buffer';
import { Array as Arr, Data, DateTime, Either, Match, Option, ParseResult, pipe, Schema, type SchemaAST } from 'effect';
import { checkV1Store, SNAPSHOT_FORMAT_VERSION, upgradeSnapshotV1ToV2 } from './SnapshotFormat.js';
import {
  type FailedTransactionResult,
  type Inputs,
  type TransactionTrait,
  traitForVersion,
  type VersionedTransactionTrait,
} from './transactionTraits.js';

export type { Inputs } from './transactionTraits.js';

/** Why a submitted transaction will never be included: the chain refused it, or its TTL passed while it waited. */
export type RejectedVerdict = FailedTransactionResult | Readonly<{ status: 'TTL_PASSED' }>;

/** Where a transaction is in its lifecycle. */
export type LifecycleState = Data.TaggedEnum<{
  Balanced: Record<never, never>;
  Finalized: Record<never, never>;
  Submitted: Record<never, never>;
  Confirmed: Record<never, never>;
  Rejected: { readonly verdict: RejectedVerdict };
  Orphaned: {
    readonly authoredFor: ProtocolVersion.ProtocolVersion;
    readonly chainNow: ProtocolVersion.ProtocolVersion;
  };
  Expired: Record<never, never>;
  Reverted: Record<never, never>;
}>;
export const LifecycleState = Data.taggedEnum<LifecycleState>();

/** The record of one transaction. */
export type LifecycleRecord<TTransaction> = Readonly<{
  /** What ties the record to the transaction at every state: proving and binding leave identifiers unchanged. */
  identifiers: readonly string[];
  /** The values the ledger stamps on the coins the transaction creates. */
  intentHashes: readonly string[];
  inputs: Inputs;
  /** From this instant the ledger rejects the transaction. */
  ttl: Date;
  /**
   * The version the transaction's bytes were built for; `none` for a record that never held its transaction, or one
   * stored before transactions were stamped, which is read with the oldest trait and never orphaned.
   */
  protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>;
  /** The transaction in the form for its state; `none` only for a record that never held its transaction. */
  tx: Option.Option<TTransaction>;
  /** When the record began, whichever state it began in. */
  createdAt: DateTime.Utc;
  /** When the transaction was submitted, kept through its verdict; `none` while it never was. */
  submittedAt: Option.Option<DateTime.Utc>;
  state: LifecycleState;
}>;

/** Every transaction's record. */
export type TransactionLifecycle<TTransaction> = Readonly<{
  records: ReadonlyArray<LifecycleRecord<TTransaction>>;
  /**
   * The top-level members of the stored payload this build does not declare, exactly as they were read, written back so
   * a later release that wrote them still finds them. Absent when the payload carried none.
   */
  unknownFields?: SnapshotFormat.UnknownFields;
}>;

/** What the facade knows about a transaction when it moves it into a state. */
export type TransactionFacts<TTransaction> = Readonly<{
  tx: TTransaction;
  identifiers: readonly string[];
  intentHashes: readonly string[];
  inputs: Inputs;
  ttl: Date;
  protocolVersion: ProtocolVersion.ProtocolVersion;
}>;

/** No transaction recorded. */
export const empty = <TTransaction>(): TransactionLifecycle<TTransaction> => ({ records: [] });

type StateTag = LifecycleState['_tag'];

/** The states a record can still leave. Every other state is final. */
const LIVE: ReadonlyArray<StateTag> = ['Balanced', 'Finalized', 'Submitted'];

/** The final states in which the transaction's coins were never spent on chain, so the spend can begin again. */
const ENDED_UNSPENT: ReadonlyArray<StateTag> = ['Rejected', 'Orphaned', 'Expired', 'Reverted'];

/**
 * Whether a record can still leave its state: balanced, finalized or submitted.
 *
 * @example
 *   const open = state.records.filter(isLive);
 *
 * @param record The record.
 * @returns `true` while some event can still move it.
 */
export const isLive = <TTransaction>(record: LifecycleRecord<TTransaction>): boolean =>
  LIVE.includes(record.state._tag);

/** Moves every record `applies` picks that is in one of the `from` states, leaving every other record as it was. */
const settle = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  applies: (record: LifecycleRecord<TTransaction>) => boolean,
  from: ReadonlyArray<StateTag>,
  to: (record: LifecycleRecord<TTransaction>) => LifecycleState,
): TransactionLifecycle<TTransaction> => ({
  ...state,
  records: state.records.map((record) =>
    applies(record) && from.includes(record.state._tag) ? { ...record, state: to(record) } : record,
  ),
});

/**
 * Whether a record stands for the same spend as the transaction with `identifiers`: they share any identifier.
 *
 * @example
 *   const covering = state.records.filter(isCoveredBy(tx.identifiers()));
 *
 * @param identifiers The transaction's identifiers.
 * @returns A predicate on records, `true` for each that shares one of them.
 */
export const isCoveredBy =
  (identifiers: readonly string[]) =>
  <TTransaction>(record: LifecycleRecord<TTransaction>): boolean =>
    record.identifiers.some((id) => identifiers.includes(id));

const earliest = (times: ReadonlyArray<DateTime.Utc>): Option.Option<DateTime.Utc> =>
  Arr.match(times, { onEmpty: () => Option.none(), onNonEmpty: (all) => Option.some(Arr.min(all, DateTime.Order)) });

/**
 * Replaces the records `facts` covers with one record in `target`, which the facts describe.
 *
 * When any covered record is in a state the move cannot start from, nothing changes, so a final state is left alone
 * unless the move names it. When none is covered, the record begins here. No move starts from `Submitted`, so the
 * submission time is the one `target` brings, never one a covered record held.
 */
const moveTo = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  from: ReadonlyArray<StateTag>,
  target: LifecycleState,
  createdAt: (folded: ReadonlyArray<LifecycleRecord<TTransaction>>) => DateTime.Utc,
  submittedAt: Option.Option<DateTime.Utc>,
  ttl: (folded: ReadonlyArray<LifecycleRecord<TTransaction>>) => Date = () => facts.ttl,
): TransactionLifecycle<TTransaction> => {
  const [rest, covered] = Arr.partition(state.records, isCoveredBy(facts.identifiers));
  return covered.every((record) => from.includes(record.state._tag))
    ? {
        ...state,
        records: Arr.append(rest, {
          identifiers: facts.identifiers,
          intentHashes: facts.intentHashes,
          inputs: facts.inputs,
          ttl: ttl(covered),
          protocolVersion: Option.some(facts.protocolVersion),
          tx: Option.some(facts.tx),
          createdAt: createdAt(covered),
          submittedAt,
          state: target,
        }),
      }
    : state;
};

/**
 * A record keeps the earliest TTL known for its spend through every move. The facts read a TTL against the instant of
 * the move, so where it is the Dust grace period after the record began, a later move reads a later one than the
 * transaction has.
 */
const keptTtl =
  <TTransaction>(facts: TransactionFacts<TTransaction>) =>
  (folded: ReadonlyArray<LifecycleRecord<TTransaction>>): Date =>
    new Date(Math.min(facts.ttl.getTime(), ...folded.map((record) => record.ttl.getTime())));

/** A record keeps the time it began through every move, and folding several keeps the earliest. */
const keptFrom =
  (now: DateTime.Utc) =>
  <TTransaction>(folded: ReadonlyArray<LifecycleRecord<TTransaction>>): DateTime.Utc =>
    pipe(
      earliest(folded.map((record) => record.createdAt)),
      Option.getOrElse(() => now),
    );

/**
 * Records a transaction as balanced, replacing a balanced record of the same spend: balancing it again begins it anew.
 * So does balancing a spend whose record ended without its coins being spent on chain; a confirmed spend stays as it
 * is, and so does one already finalized or submitted.
 *
 * @example
 *   const held = balanced(state, { tx: erased, identifiers, intentHashes, inputs, ttl, protocolVersion }, now);
 *
 * @param state The records.
 * @param facts The balanced transaction, with its proofs erased.
 * @param now When it was balanced.
 * @returns The records with the transaction balanced, or unchanged when the spend has already moved past balancing.
 */
export const balanced = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  now: DateTime.Utc,
): TransactionLifecycle<TTransaction> =>
  moveTo(state, facts, ['Balanced', ...ENDED_UNSPENT], LifecycleState.Balanced(), () => now, Option.none());

/**
 * Records a transaction as finalized, from balanced or from nothing. Every record the finalized transaction covers is
 * folded into one, because merging the parts of a recipe makes one transaction.
 *
 * @example
 *   const proven = finalized(
 *     state,
 *     { tx: finalizedTx, identifiers, intentHashes, inputs, ttl, protocolVersion },
 *     now,
 *   );
 *
 * @param state The records.
 * @param facts The finalized transaction.
 * @param now When it was finalized.
 * @returns The records with the transaction finalized, or unchanged when the spend has already been submitted.
 */
export const finalized = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  now: DateTime.Utc,
): TransactionLifecycle<TTransaction> =>
  moveTo(
    state,
    facts,
    ['Balanced', 'Finalized'],
    LifecycleState.Finalized(),
    keptFrom(now),
    Option.none(),
    keptTtl(facts),
  );

/**
 * Records a transaction as submitted, from balanced, finalized, reverted or nothing: a transaction proven outside the
 * facade arrives still balanced, and an adopted one arrives unrecorded. A reverted one is sent again after a submission
 * that proved it was in no block: once it is sent it is in flight, whatever the wallet concluded before.
 *
 * @example
 *   const sent = submitted(state, { tx: finalizedTx, identifiers, intentHashes, inputs, ttl, protocolVersion }, now);
 *
 * @param state The records.
 * @param facts The submitted transaction.
 * @param now When it was submitted.
 * @returns The records with the transaction submitted, or unchanged when it already was.
 */
export const submitted = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  facts: TransactionFacts<TTransaction>,
  now: DateTime.Utc,
): TransactionLifecycle<TTransaction> =>
  moveTo(
    state,
    facts,
    ['Balanced', 'Finalized', 'Reverted'],
    LifecycleState.Submitted(),
    keptFrom(now),
    Option.some(now),
    keptTtl(facts),
  );

/** Whether the chain itself refused the transaction, rather than the wallet concluding it from the TTL. */
const isRejectedByChain = (state: LifecycleState): boolean =>
  state._tag === 'Rejected' && state.verdict.status !== 'TTL_PASSED';

/**
 * Records that a transaction was included, whichever live state its record is in: inclusion is a fact, and nothing
 * overrules it afterwards.
 *
 * It also overrules an end the wallet only inferred (expired, rejected at its TTL, orphaned, reverted): a block's time
 * is within the transaction's TTL, so an inclusion reported after such an end happened before it.
 *
 * @example
 *   const included = confirmed(state, [...tx.identifiers()]);
 *
 * @param state The records.
 * @param identifiers The included transaction's identifiers.
 * @returns The records with the transaction confirmed; a record whose end the chain reported is left as it was.
 */
export const confirmed = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  identifiers: readonly string[],
): TransactionLifecycle<TTransaction> =>
  settle(
    state,
    (record) => isCoveredBy(identifiers)(record) && !isRejectedByChain(record.state),
    [...LIVE, ...ENDED_UNSPENT],
    () => LifecycleState.Confirmed(),
  );

/**
 * Records that the chain refused a finalized or submitted transaction. A finalized one counts too, because another
 * party may have submitted it, as in a swap, and the chain's answer about it is a fact. A balanced one is left as it
 * was: it is not yet proven, so no chain can have been asked to include it.
 *
 * @example
 *   const refused = rejected(state, [...tx.identifiers()], { status: 'FAILURE', segments });
 *
 * @param state The records.
 * @param identifiers The refused transaction's identifiers.
 * @param verdict What the chain reported.
 * @returns The records with the transaction rejected.
 */
export const rejected = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  identifiers: readonly string[],
  verdict: FailedTransactionResult,
): TransactionLifecycle<TTransaction> =>
  settle(state, isCoveredBy(identifiers), ['Finalized', 'Submitted'], () => LifecycleState.Rejected({ verdict }));

/** Whether the epoch `authoredFor` belongs to has ended by `chainNow`. A version no epoch serves has not. */
const hasEpochEnded = <TEpoch>(
  epochs: ProtocolVersion.Registry<TEpoch>,
  authoredFor: ProtocolVersion.ProtocolVersion,
  chainNow: ProtocolVersion.ProtocolVersion,
): boolean =>
  pipe(
    ProtocolVersion.selectEntry(epochs, authoredFor),
    Option.exists((entry) => chainNow >= entry.range[1]),
  );

/**
 * Gives up on every live transaction built for an epoch the chain has left. A record whose version was never known is
 * left as it was: that is no evidence it was left behind.
 *
 * @example
 *   const stranded = orphanBeyond(state, traits, chainNow);
 *
 * @param state The records.
 * @param epochs The protocol version epochs, as the registry of traits keys them.
 * @param chainNow The version the chain has reached.
 * @returns The records with every stranded transaction orphaned.
 */
export const orphanBeyond = <TTransaction, TEpoch>(
  state: TransactionLifecycle<TTransaction>,
  epochs: ProtocolVersion.Registry<TEpoch>,
  chainNow: ProtocolVersion.ProtocolVersion,
): TransactionLifecycle<TTransaction> => ({
  ...state,
  records: state.records.map((record) =>
    pipe(
      record.protocolVersion,
      Option.filter((authoredFor) => isLive(record) && hasEpochEnded(epochs, authoredFor, chainNow)),
      Option.match({
        onNone: () => record,
        onSome: (authoredFor) => ({ ...record, state: LifecycleState.Orphaned({ authoredFor, chainNow }) }),
      }),
    ),
  ),
});

/**
 * Records that a transaction was reverted, so no chain will be asked to include it.
 *
 * @example
 *   const abandoned = reverted(state, [...tx.identifiers()]);
 *
 * @param state The records.
 * @param identifiers The reverted transaction's identifiers.
 * @returns The records with the transaction reverted; a final record is left as it was.
 */
export const reverted = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  identifiers: readonly string[],
): TransactionLifecycle<TTransaction> => settle(state, isCoveredBy(identifiers), LIVE, () => LifecycleState.Reverted());

/**
 * Passed, not reached: the ledger accepts an intent while its TTL is at or after the block's timestamp, so a
 * transaction is still valid at the instant its TTL names.
 */
const hasTtlPassed = <TTransaction>(record: LifecycleRecord<TTransaction>, now: DateTime.Utc): boolean =>
  record.ttl.getTime() < DateTime.toEpochMillis(now);

/**
 * Ends every live record whose TTL `now` has passed: one never submitted expires, and a submitted one is rejected.
 *
 * @param state The records.
 * @param now The instant to expire against.
 * @returns The records with every passed TTL acted on, or the same state when none has passed.
 */
export const expire = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  now: DateTime.Utc,
): TransactionLifecycle<TTransaction> => {
  const isDue = (record: LifecycleRecord<TTransaction>): boolean => isLive(record) && hasTtlPassed(record, now);
  return Arr.some(state.records, isDue)
    ? {
        ...state,
        records: state.records.map((record) =>
          isDue(record)
            ? {
                ...record,
                state:
                  record.state._tag === 'Submitted'
                    ? LifecycleState.Rejected({ verdict: { status: 'TTL_PASSED' } })
                    : LifecycleState.Expired(),
              }
            : record,
        ),
      }
    : state;
};

/**
 * Drops every final record whose TTL `now` has passed.
 *
 * @param state The records.
 * @param now The instant to drop against.
 * @returns The records without them, or the same state when none is due.
 */
export const dropFinished = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  now: DateTime.Utc,
): TransactionLifecycle<TTransaction> => {
  const isDue = (record: LifecycleRecord<TTransaction>): boolean => !isLive(record) && hasTtlPassed(record, now);
  return Arr.some(state.records, isDue)
    ? { ...state, records: Arr.filter(state.records, (record) => !isDue(record)) }
    : state;
};

/**
 * The unshielded coin ids some live transaction still accounts for.
 *
 * A final record accounts for none: a confirmed transaction's coins are spent on chain, and every other final state's
 * coins are free. Read from the inputs each record keeps, so a record that never held its transaction still counts.
 *
 * @example
 *   const spokenFor = coveredUnshieldedIds(lifecycle);
 *
 * @param state The records.
 * @returns Every such coin id, without repeats.
 */
export const coveredUnshieldedIds = <TTransaction>(state: TransactionLifecycle<TTransaction>): readonly string[] =>
  pipe(
    Arr.filter(state.records, isLive),
    Arr.flatMap((record) => record.inputs.unshielded),
    Arr.dedupe,
  );

const SegmentsSchema = Schema.Array(Schema.Struct({ id: Schema.Number, success: Schema.Boolean }));

const RejectedVerdictSchema = Schema.Union(
  Schema.Struct({ status: Schema.Literal('FAILURE', 'PARTIAL_SUCCESS'), segments: SegmentsSchema }),
  Schema.Struct({ status: Schema.Literal('TTL_PASSED') }),
);

/** A state as stored: its tag, and whatever the state carries beside it. */
const WireStateSchema = Schema.Union(
  Schema.TaggedStruct('Balanced', {}),
  Schema.TaggedStruct('Finalized', {}),
  Schema.TaggedStruct('Submitted', {}),
  Schema.TaggedStruct('Confirmed', {}),
  Schema.TaggedStruct('Rejected', { verdict: RejectedVerdictSchema }),
  Schema.TaggedStruct('Orphaned', {
    authoredFor: ProtocolVersion.ProtocolVersionSchema,
    chainNow: ProtocolVersion.ProtocolVersionSchema,
  }),
  Schema.TaggedStruct('Expired', {}),
  Schema.TaggedStruct('Reverted', {}),
);

const isWireState = Schema.is(Schema.typeSchema(WireStateSchema));

/** Builds each state with its own constructor, so a read state is the same value the transitions make. */
const StateSchema = Schema.transform(
  WireStateSchema,
  Schema.declare((value: unknown): value is LifecycleState => isWireState(value)),
  {
    strict: true,
    decode: (wire) =>
      Match.valueTags(wire, {
        Balanced: () => LifecycleState.Balanced(),
        Finalized: () => LifecycleState.Finalized(),
        Submitted: () => LifecycleState.Submitted(),
        Confirmed: () => LifecycleState.Confirmed(),
        Rejected: ({ verdict }) => LifecycleState.Rejected({ verdict }),
        Orphaned: ({ authoredFor, chainNow }) => LifecycleState.Orphaned({ authoredFor, chainNow }),
        Expired: () => LifecycleState.Expired(),
        Reverted: () => LifecycleState.Reverted(),
      }),
    encode: (state) => state,
  },
);

const InputsSchema = Schema.Struct({
  unshielded: Schema.Array(Schema.String),
  shielded: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
});

/**
 * A record as stored. Its identifiers, intent hashes, inputs and TTL may be absent only beside its transaction, which
 * they are then read from: a store upgraded from `v1` never recorded them for a pending item.
 */
const WireRecordSchema = Schema.Struct({
  tx: Schema.optionalWith(Schema.String, { exact: true }),
  /** What the trait said about the transaction that its bytes do not, when it said anything. */
  txForm: Schema.optionalWith(Schema.String, { exact: true }),
  protocolVersion: Schema.optionalWith(ProtocolVersion.ProtocolVersionSchema, { as: 'Option', exact: true }),
  identifiers: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  intentHashes: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  inputs: Schema.optionalWith(InputsSchema, { exact: true }),
  ttl: Schema.optionalWith(Schema.Date, { exact: true }),
  createdAt: Schema.DateTimeUtc,
  submittedAt: Schema.optionalWith(Schema.DateTimeUtc, { as: 'Option', exact: true }),
  state: StateSchema,
});

type WireRecord = typeof WireRecordSchema.Type;

type Facts = Pick<LifecycleRecord<unknown>, 'identifiers' | 'intentHashes' | 'inputs' | 'ttl'>;

/** The facts a record stored, each one it lacks read off its transaction by `trait`. A stored fact always wins. */
const factsOf = <TTransaction>(wire: WireRecord, tx: TTransaction, trait: TransactionTrait<TTransaction>): Facts => ({
  identifiers: wire.identifiers ?? trait.ids(tx),
  intentHashes: wire.intentHashes ?? trait.intentHashes(tx),
  inputs: wire.inputs ?? trait.inputs(tx),
  ttl: wire.ttl ?? trait.ttl(tx, wire.createdAt),
});

/** The facts of a record that never held its transaction: all stored, since nothing else could supply them. */
const storedFactsOf = (wire: WireRecord): Option.Option<Facts> =>
  wire.identifiers !== undefined &&
  wire.intentHashes !== undefined &&
  wire.inputs !== undefined &&
  wire.ttl !== undefined
    ? Option.some({
        identifiers: wire.identifiers,
        intentHashes: wire.intentHashes,
        inputs: wire.inputs,
        ttl: wire.ttl,
      })
    : Option.none();

const RecordSchema = <TTransaction>(
  traits: VersionedTransactionTrait<TTransaction>,
): Schema.Schema<LifecycleRecord<TTransaction>, Schema.Schema.Encoded<typeof WireRecordSchema>> => {
  const DomainSchema = Schema.declare(
    (value: unknown): value is LifecycleRecord<TTransaction> =>
      typeof value === 'object' && value !== null && 'state' in value && 'identifiers' in value,
  );

  /** The trait a record's transaction is read and written with: the one for its version, or the oldest without one. */
  const traitOf = (
    protocolVersion: Option.Option<ProtocolVersion.ProtocolVersion>,
    ast: SchemaAST.AST,
    actual: unknown,
  ): Either.Either<TransactionTrait<TTransaction>, ParseResult.ParseIssue> =>
    Either.fromOption(
      traitForVersion(traits, protocolVersion),
      () =>
        new ParseResult.Type(
          ast,
          actual,
          `No transaction trait is registered for protocol version ${Option.getOrElse(protocolVersion, () => 'unknown' as const)}.`,
        ),
    );

  return Schema.asSchema(
    Schema.transformOrFail(WireRecordSchema, DomainSchema, {
      strict: true,
      decode: (wire, _options, ast) => {
        const rest = {
          protocolVersion: wire.protocolVersion,
          createdAt: wire.createdAt,
          submittedAt: wire.submittedAt,
          state: wire.state,
        };
        return wire.tx === undefined
          ? pipe(
              storedFactsOf(wire),
              Either.fromOption(
                () =>
                  new ParseResult.Type(
                    ast,
                    wire,
                    'A record that holds no transaction must carry its identifiers, intent hashes, inputs and TTL.',
                  ),
              ),
              Either.map((facts) => ({ ...facts, ...rest, tx: Option.none<TTransaction>() })),
            )
          : pipe(
              traitOf(wire.protocolVersion, ast, wire),
              Either.flatMap((trait) =>
                Either.try({
                  try: () => ({ trait, tx: trait.deserialize(Buffer.from(wire.tx ?? '', 'hex'), wire.txForm) }),
                  catch: (cause) =>
                    new ParseResult.Type(ast, wire, `Could not read the recorded transaction: ${String(cause)}`),
                }),
              ),
              Either.map(({ trait, tx }) => ({ ...factsOf(wire, tx, trait), ...rest, tx: Option.some(tx) })),
            );
      },
      encode: (record, _options, ast) => {
        const rest = {
          protocolVersion: record.protocolVersion,
          identifiers: record.identifiers,
          intentHashes: record.intentHashes,
          inputs: record.inputs,
          ttl: record.ttl,
          createdAt: record.createdAt,
          submittedAt: record.submittedAt,
          state: record.state,
        };
        return Option.match(record.tx, {
          onNone: () => Either.right(rest),
          onSome: (tx) =>
            pipe(
              traitOf(record.protocolVersion, ast, record),
              Either.flatMap((trait) =>
                Either.try({
                  try: () => ({
                    tx: Buffer.from(trait.serialize(tx)).toString('hex'),
                    ...(trait.formOf === undefined ? {} : { txForm: trait.formOf(tx) }),
                  }),
                  catch: (cause) =>
                    new ParseResult.Type(ast, record, `Could not write the recorded transaction: ${String(cause)}`),
                }),
              ),
              Either.map((written) => ({ ...rest, ...written })),
            ),
        });
      },
    }),
  );
};

/**
 * The stored shape in the current format version. Its own `fields` are the top-level members the format declares; any
 * other member of a payload is an unknown field, carried rather than read.
 */
const StoredStruct = <TTransaction>(traits: VersionedTransactionTrait<TTransaction>) =>
  Schema.Struct({
    version: Schema.Literal(SNAPSHOT_FORMAT_VERSION),
    records: Schema.Array(RecordSchema(traits)),
  });

/**
 * Writes the records in the current stored format, with every top-level member a payload it was read from carried but
 * this build does not declare.
 *
 * @example
 *   const stored = serialize(lifecycle, traits);
 *
 * @param state The records.
 * @param traits The traits each record's transaction is written with, chosen by the version it was built for.
 * @returns The records as a JSON string.
 */
export const serialize = <TTransaction>(
  state: TransactionLifecycle<TTransaction>,
  traits: VersionedTransactionTrait<TTransaction>,
): string => {
  const encoded: unknown = Schema.encodeSync(StoredStruct(traits))({
    version: SNAPSHOT_FORMAT_VERSION,
    records: state.records,
  });
  const written = SnapshotFormat.isJsonObject(encoded) ? encoded : {};
  return JSON.stringify({
    ...written,
    ...SnapshotFormat.unknownFieldsOf(state.unknownFields ?? {}, (key) => Object.hasOwn(written, key)),
  });
};

/**
 * Reads records stored in any format version this build knows, upgrading an older one on the way.
 *
 * @remarks
 *   A record that holds its transaction but lacks a fact reads it off the transaction, with the trait registered for the
 *   version the record was stamped with, or the oldest trait when it carries no stamp. A version this build does not
 *   know is refused, never read as the current one.
 * @example
 *   const lifecycle = deserialize(stored, traits);
 *
 * @param serialized The stored JSON string.
 * @param traits The traits each record's transaction is read with, chosen by the version it was stamped with.
 * @returns The records, or why the payload could not be read.
 */
export const deserialize = <TTransaction>(
  serialized: string,
  traits: VersionedTransactionTrait<TTransaction>,
): Either.Either<TransactionLifecycle<TTransaction>, ParseResult.ParseError> =>
  pipe(
    serialized,
    Schema.decodeUnknownEither(Schema.parseJson()),
    Either.flatMap(checkV1Store),
    Either.flatMap((parsed) => {
      const json = upgradeSnapshotV1ToV2(parsed);
      const schema = StoredStruct(traits);
      return pipe(
        Schema.decodeUnknownEither(schema)(json),
        Either.map((data) =>
          SnapshotFormat.withUnknownFields<TransactionLifecycle<TTransaction>>(
            { records: data.records },
            SnapshotFormat.isJsonObject(json)
              ? SnapshotFormat.unknownFieldsOf(json, (key) => Object.hasOwn(schema.fields, key))
              : {},
          ),
        ),
      );
    }),
  );
