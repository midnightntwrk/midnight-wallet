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

/**
 * The one transaction type an application carries, whichever ledger version produced it.
 *
 * @remarks
 *   An SDK that runs one ledger version before a protocol boundary and another from it has a problem its callers should
 *   never have to solve: a transaction built before the boundary and a transaction built after it are objects of two
 *   different runtimes, with two different types, and no conversion between them. Naming either type in a public
 *   signature is naming a ledger version, which is the thing that breaks when the chain moves on.
 *
 *   So the wallet layer hands out a handle instead. It seals the transaction away — an application cannot reach it, and
 *   so cannot come to depend on which version made it — and carries the protocol version it was built at as ordinary
 *   readable data. That stamp is what the SDK routes on: which prover proves it, which trait recognises it, which
 *   variant may unwrap it at all.
 */
import * as Data from 'effect/Data';
import * as Either from 'effect/Either';
import * as Option from 'effect/Option';
import * as ParseResult from 'effect/ParseResult';
import * as Schema from 'effect/Schema';
import * as ProtocolVersion from './ProtocolVersion.js';
import * as SerializedTransaction from './SerializedTransaction.js';

/**
 * How far along the building of a transaction a handle is.
 *
 * @remarks
 *   The three points at which a transaction changes hands between an application and the SDK: built but not proved,
 *   proved but not yet bound to its own contents, and finalized — proved, signed and bound, which is the only shape the
 *   network takes. Both ledger versions have all three, and the words mean the same thing on either side of a protocol
 *   boundary, which is why the stage can be plain data on a version-agnostic handle.
 */
export type TransactionStage = 'Unproven' | 'Unbound' | 'Finalized';

/** What a handle can carry: anything that can write itself out as bytes, which is every ledger's transaction. */
type Serializable = Readonly<{ serialize: () => Uint8Array }>;

/**
 * Raised when a transaction is used at a protocol version other than the one it was built for.
 *
 * @remarks
 *   The bytes of a transaction are fixed when it is built, by the ledger version that built them. A protocol boundary
 *   does not rewrite them, so a transaction authored on one side of the boundary cannot be understood on the other —
 *   not merged, not proved, not submitted. This is what the SDK answers with rather than handing a transaction to a
 *   ledger version that would misread it.
 */
export class ProtocolVersionMismatchError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-abstractions/WalletTransaction/ProtocolVersionMismatchError',
)<{
  readonly message: string;
  /** The protocol version the transaction was built at. */
  readonly authoredFor: ProtocolVersion.ProtocolVersion;
  /** The range of protocol versions the caller can act at. */
  readonly accepted: ProtocolVersion.ProtocolVersion.Range;
  /** How far along the building of the transaction the handle is, for the diagnostic. */
  readonly stage: TransactionStage;
}> {}

/** Raised when a wire envelope cannot be read as a transaction of a version this SDK knows. */
export class WireFormatError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-abstractions/WalletTransaction/WireFormatError',
)<{
  readonly message: string;
  /** What went wrong underneath: a parse failure, or whatever the caller's decoder raised. */
  readonly cause?: unknown;
}> {}

/**
 * The envelope's own format version.
 *
 * @remarks
 *   Deliberately separate from the protocol version it carries. A reader has to be able to tell "I do not know this
 *   envelope" from "I do not know this ledger version", because only the second is a chain fact.
 */
const WIRE_FORMAT = 1;

const TransactionStageSchema: Schema.Schema<TransactionStage> = Schema.Literal('Unproven', 'Unbound', 'Finalized');

/**
 * The envelope a handle crosses a process boundary in.
 *
 * @remarks
 *   Everything in it is JSON-safe, because the boundary it was designed for — a dApp connector — is a JSON one: the
 *   protocol version is a decimal string rather than a `bigint`, and the transaction is hex rather than bytes. What
 *   travels is exactly what a reader needs to decide whether it can read the rest at all: the envelope format, the
 *   protocol version the transaction was built at, the stage it reached, and the transaction's own serialization.
 *
 *   Kept deliberately small. The connector contract is an open question at the time of writing, and an envelope that
 *   guesses at it would be harder to reconcile than one that carries the minimum.
 */
const WireTransactionSchema = Schema.Struct({
  wireFormat: Schema.Literal(WIRE_FORMAT),
  protocolVersion: ProtocolVersion.ProtocolVersionSchema,
  stage: TransactionStageSchema,
  transaction: Schema.Uint8ArrayFromHex,
});

/** The wire envelope as it travels: a plain JSON-safe record. See {@link WalletTransaction.toWire}. */
export type WireTransaction = Schema.Schema.Encoded<typeof WireTransactionSchema>;

const encodeWire = Schema.encodeSync(WireTransactionSchema);
const decodeWire = Schema.decodeUnknownEither(WireTransactionSchema);

/**
 * A transaction the SDK produced or adopted, sealed together with the protocol version it was built at.
 *
 * @remarks
 *   A class rather than a record, and the one place in this package where that earns its keep: a `#private` field is the
 *   only way to carry something an application provably cannot reach, and reaching the wrapped transaction is exactly
 *   what would re-introduce the ledger-version dependency the handle exists to remove. Nothing about it mutates — the
 *   fields are read-only and every operation returns a new value.
 *
 *   The stage is a type parameter as well as a field, so a signature can ask for the shape it needs
 *   (`WalletTransaction<'Finalized'>`, spelled {@link FinalizedTx}) and a caller who has an unproven transaction finds
 *   out at compile time. It is covariant: a `FinalizedTx` is an {@link AnyTx}, which is what the operations that accept
 *   a transaction at any stage — reverting one, say — are stated in terms of.
 * @example
 *   Sealing a transaction an application built for itself, and handing it back to the wallet:
 *
 *   ```typescript
 *   import * as ledger from '@midnightntwrk/wallet-sdk/ledger/v9';
 *
 *   const intent = ledger.Intent.new(ttl);
 *   const handle = WalletTransaction.adopt('Unproven', ledger.Transaction.fromParts(networkId, undefined, undefined, intent), version);
 *   ```;
 *
 * @typeParam TStage How far along the building of this transaction the handle is.
 */
export class WalletTransaction<out TStage extends TransactionStage = TransactionStage> {
  /** The protocol version this transaction was built at, and so the only one it can be used at. */
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;

  /** How far along the building of this transaction the handle is. */
  readonly stage: TStage;

  /** The transaction itself, reachable only from inside this class. */
  readonly #carried: Serializable;

  private constructor(protocolVersion: ProtocolVersion.ProtocolVersion, stage: TStage, carried: Serializable) {
    this.protocolVersion = protocolVersion;
    this.stage = stage;
    this.#carried = carried;
  }

  /**
   * Seals a transaction built elsewhere into a handle.
   *
   * @remarks
   *   How an application that builds its own transactions — with the ledger version it imported from
   *   `@midnightntwrk/wallet-sdk/ledger/v8` or `/v9` — hands one to the wallet. The version passed here is a claim
   *   about which ledger version produced the transaction, and the SDK holds the caller to it: a handle stamped for one
   *   side of a protocol boundary is refused by a wallet acting on the other side, with a
   *   {@link ProtocolVersionMismatchError}. Until the fork, that means a transaction built with the post-fork ledger
   *   version is refused at run time, however well it type-checks.
   * @param stage How far along the building of the transaction is.
   * @param transaction The transaction, of whichever ledger version built it.
   * @param protocolVersion The protocol version that ledger version serves.
   * @returns The sealed handle.
   */
  static adopt<TStage extends TransactionStage>(
    stage: TStage,
    transaction: Serializable,
    protocolVersion: ProtocolVersion.ProtocolVersion,
  ): WalletTransaction<TStage> {
    return new WalletTransaction(protocolVersion, stage, transaction);
  }

  /**
   * Reads the transaction a handle carries, if it was built for a protocol version the caller can act at.
   *
   * @remarks
   *   The SDK's own way in, and the enforcement point for everything an application hands back: a caller states the range
   *   of protocol versions it speaks — a variant's activation range, or the era the chain is currently in — and gets
   *   the transaction only when the stamp falls inside it. The result type is the caller's to name, because the handle
   *   deliberately does not remember it; the range is the whole of the guarantee, which is why it is checked here
   *   rather than trusted anywhere else.
   * @param handle The handle to read.
   * @param accepted The range of protocol versions the caller can act at.
   * @returns The carried transaction, or a {@link ProtocolVersionMismatchError} naming what was carried and what was
   *   asked for.
   */
  static unwrapWithin<T>(
    handle: WalletTransaction,
    accepted: ProtocolVersion.ProtocolVersion.Range,
  ): Either.Either<T, ProtocolVersionMismatchError> {
    if (!ProtocolVersion.withinRange(handle.protocolVersion, accepted)) {
      const [from, to] = accepted;
      return Either.left(
        new ProtocolVersionMismatchError({
          message:
            `This transaction was built for protocol version ${handle.protocolVersion}, and can only be used at ` +
            `that version: its bytes were fixed by the ledger version that produced them. The caller acts at ` +
            `protocol versions ${from} up to (but not including) ${to}. Build the transaction again on the side of ` +
            `the protocol boundary it is to be used on.`,
          authoredFor: handle.protocolVersion,
          accepted,
          stage: handle.stage,
        }),
      );
    }
    // The carried type is erased when a transaction is sealed, and deliberately: remembering it would put a ledger
    // version back into the handle's own type. The version check above is the whole of what can be guaranteed here,
    // and it is the same guarantee the caller would have had to make for itself.
    return Either.right(handle.#carried as T);
  }

  /**
   * Narrows a handle to a stage, for a caller that has one of unknown stage.
   *
   * @param handle The handle to narrow.
   * @param stage The stage to narrow it to.
   * @returns The same handle, typed at that stage, or nothing when it is at another.
   */
  static atStage<TStage extends TransactionStage>(
    handle: WalletTransaction,
    stage: TStage,
  ): Option.Option<WalletTransaction<TStage>> {
    return handle.stage === stage
      ? // Narrowed by the value that the type parameter names; `stage` is the only thing distinguishing the two types.
        Option.some(handle as WalletTransaction<TStage>)
      : Option.none();
  }

  /**
   * Determines whether a value is a handle this SDK produced.
   *
   * @remarks
   *   Answers on the sealed transaction itself, so a record that merely has the same readable fields is not mistaken for
   *   one.
   * @param value The value to test.
   * @returns `true` when `value` is a {@link WalletTransaction}.
   */
  static is(value: unknown): value is WalletTransaction {
    return typeof value === 'object' && value !== null && #carried in value;
  }

  /**
   * Writes a handle out as an envelope that can cross a process boundary.
   *
   * @param handle The handle to write out.
   * @returns The envelope. See {@link WireTransaction}.
   */
  static toWire(handle: WalletTransaction): WireTransaction {
    return encodeWire({
      wireFormat: WIRE_FORMAT,
      protocolVersion: handle.protocolVersion,
      stage: handle.stage,
      transaction: handle.serialize(),
    });
  }

  /**
   * Reads an envelope back into a handle, decoding its bytes with whichever ledger version the envelope names.
   *
   * @remarks
   *   The decoder is the caller's because the choice of ledger version is: this package has none, and picking one here
   *   would be the hardcoded version the handle exists to avoid. It is handed the version and stage the envelope
   *   declares so it can route on them, and it may raise — a deserializer meeting bytes of another ledger version does
   *   — which is reported as a {@link WireFormatError} rather than escaping.
   * @param value The envelope, as received.
   * @param decode Produces the transaction from the envelope's bytes, at the version and stage it names.
   * @returns The handle, or a {@link WireFormatError} describing what could not be read.
   */
  static fromWire(
    value: unknown,
    decode: (
      bytes: Uint8Array,
      protocolVersion: ProtocolVersion.ProtocolVersion,
      stage: TransactionStage,
    ) => Serializable,
  ): Either.Either<WalletTransaction, WireFormatError> {
    return decodeWire(value).pipe(
      Either.mapLeft(
        (error) =>
          new WireFormatError({
            message: `This is not a transaction envelope this SDK can read: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
            cause: error,
          }),
      ),
      Either.flatMap((envelope) =>
        Either.try({
          try: () => decode(envelope.transaction, envelope.protocolVersion, envelope.stage),
          catch: (cause) =>
            new WireFormatError({
              message:
                `The envelope declares protocol version ${envelope.protocolVersion}, but its bytes could not be ` +
                `read as a ${envelope.stage.toLowerCase()} transaction of that version.`,
              cause,
            }),
        }).pipe(
          Either.map((transaction) => WalletTransaction.adopt(envelope.stage, transaction, envelope.protocolVersion)),
        ),
      ),
    );
  }

  /**
   * Writes the carried transaction out as bytes.
   *
   * @remarks
   *   The one thing every ledger version's transaction can do identically, and so the one thing a handle can offer
   *   without knowing which produced it. What the bytes mean still depends on {@link protocolVersion}.
   * @returns The transaction's own serialization.
   */
  serialize(): SerializedTransaction.SerializedTransaction {
    return SerializedTransaction.from(this.#carried);
  }
}

export declare namespace WalletTransaction {
  /** How far along the building of a transaction a handle is. See {@link TransactionStage}. */
  type Stage = TransactionStage;
}

/** A transaction that has been built but not proved. */
export type UnprovenTx = WalletTransaction<'Unproven'>;

/** A transaction that has been proved but not yet bound to its own contents. */
export type UnboundTx = WalletTransaction<'Unbound'>;

/** A transaction that is proved, signed and bound: the only shape the network takes. */
export type FinalizedTx = WalletTransaction<'Finalized'>;

/** A transaction at whichever stage it happens to have reached. */
export type AnyTx = WalletTransaction<TransactionStage>;
