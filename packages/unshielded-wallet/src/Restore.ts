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
import { ProtocolVersion, SnapshotFormat } from '@midnightntwrk/wallet-sdk-abstractions';
import { Data, Either, Option, Schema } from 'effect';

/**
 * Raised when a snapshot declares a protocol version that no registered variant is able to read.
 *
 * @remarks
 *   A wallet built for one range of protocol versions cannot invent a reader for a snapshot written outside it, and
 *   guessing — handing the bytes to whichever variant happens to be registered — would decode them with the wrong
 *   ledger. The version is carried on the error so an application can say which one it was.
 */
export class UnsupportedSnapshotVersionError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-unshielded-wallet/Restore/UnsupportedSnapshotVersionError',
)<{
  readonly message: string;
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
}> {}

/**
 * The envelope the peek reads.
 *
 * @remarks
 *   Deliberately the smallest possible description of a snapshot: two optional fields, every other ignored. It has to
 *   read snapshots written by _any_ variant, including ones whose full schema this build does not have, so it must not
 *   assert anything it does not need. Everything it cannot make sense of is reported as "no version declared", leaving
 *   the real diagnosis to the deserializer that eventually reads the whole thing.
 */
const EnvelopeSchema = Schema.Struct({
  protocolVersion: Schema.optional(ProtocolVersion.ProtocolVersionSchema),
  writtenBy: SnapshotFormat.writtenByField(),
});

/**
 * Reads the protocol version a serialized unshielded wallet snapshot declares.
 *
 * @param serialized The serialized wallet state.
 * @returns The declared version, or `Option.none()` when the snapshot declares none or cannot be read at all.
 */
export const peekProtocolVersion = (serialized: string): Option.Option<ProtocolVersion.ProtocolVersion> =>
  Schema.decodeUnknownOption(Schema.parseJson(EnvelopeSchema))(serialized).pipe(
    Option.flatMap((envelope) => Option.fromNullable(envelope.protocolVersion)),
  );

/**
 * Reads which variant wrote a serialized unshielded wallet snapshot, when it says.
 *
 * @param serialized The serialized wallet state.
 * @returns The writer, or `Option.none()` when the snapshot predates the field or cannot be read at all.
 */
export const peekWriter = (serialized: string): Option.Option<SnapshotFormat.SnapshotWriter> =>
  Schema.decodeUnknownOption(Schema.parseJson(EnvelopeSchema))(serialized).pipe(
    Option.flatMap((envelope) => Option.fromNullable(envelope.writtenBy)),
  );

/**
 * Chooses the variant that should read a serialized unshielded wallet snapshot.
 *
 * @remarks
 *   The variant that wrote a snapshot is the one to read it, when the snapshot says which and that variant is registered:
 *   a V1 wallet that has seen the chain reach `forks.v9` annotates that version before the runtime hands it over, so a
 *   snapshot it writes in that window carries a version the V2 variant owns. Read as a V2 snapshot it would skip the
 *   cross-ledger migration; restored on the V1 variant, that variant announces the out-of-range version on its first
 *   observation and the runtime migrates it, exactly as for a live crossing.
 *
 *   Otherwise the version decides. A snapshot that declares no version predates snapshots declaring one, and can only
 *   have been written by the variant that shipped before the question arose — the head variant. The same fallback
 *   covers an envelope this function cannot read at all: refusing it here would replace the deserializer's precise
 *   error with a vaguer one.
 * @param serialized The serialized wallet state.
 * @param variantFor Resolves the variant registered for a protocol version.
 * @param headVariant The variant a snapshot with no declared version is restored into.
 * @param variantWrittenBy Resolves the registered variant that a snapshot names as its writer, if it is registered.
 * @returns The variant to restore with, or {@link UnsupportedSnapshotVersionError} when the writer is not registered and
 *   the declared version is one no registered variant owns.
 */
export const variantForSnapshot = <TVariant>(
  serialized: string,
  variantFor: (version: ProtocolVersion.ProtocolVersion) => Option.Option<TVariant>,
  headVariant: TVariant,
  variantWrittenBy: (writer: SnapshotFormat.SnapshotWriter) => Option.Option<TVariant>,
): Either.Either<TVariant, UnsupportedSnapshotVersionError> =>
  Option.match(Option.flatMap(peekWriter(serialized), variantWrittenBy), {
    onSome: (variant) => Either.right(variant),
    onNone: () =>
      Option.match(peekProtocolVersion(serialized), {
        onNone: () => Either.right(headVariant),
        onSome: (protocolVersion) =>
          Either.fromOption(
            variantFor(protocolVersion),
            () =>
              new UnsupportedSnapshotVersionError({
                message: `No registered variant reads unshielded wallet snapshots of protocol version ${protocolVersion}.`,
                protocolVersion,
              }),
          ),
      }),
  });
