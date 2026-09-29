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
import { Either, Option, Schema } from 'effect';
import { type ProtocolVersion, ProtocolVersionSchema } from './ProtocolVersion.js';
import { isSnapshotWriter, type SnapshotWriter } from './SnapshotFormat.js';

/** What routing reads off a serialized snapshot before any variant's deserializer sees it. */
export type SnapshotEnvelope = {
  readonly protocolVersion: Option.Option<ProtocolVersion>;
  readonly writer: Option.Option<SnapshotWriter>;
};

/** A hook that names the writer of a snapshot from its shape, for surfaces where the shape says. */
export type InferWriter = (json: unknown) => Option.Option<SnapshotWriter>;

const parseJson = Schema.decodeUnknownOption(Schema.parseJson(Schema.Unknown));
const isRecord = Schema.is(Schema.Record({ key: Schema.String, value: Schema.Unknown }));
const decodeVersion = Schema.decodeUnknownOption(ProtocolVersionSchema);

const noInference: InferWriter = () => Option.none();

/**
 * Reads the protocol version and the writer a serialized snapshot declares, and nothing else.
 *
 * @remarks
 *   Deliberately the smallest possible reading of a snapshot: one parse, two fields, every other ignored. It has to read
 *   snapshots written by _any_ variant, including ones whose full schema this build does not have, so it asserts
 *   nothing it does not need — and the two fields are read independently of each other, so that a writer name this
 *   build does not know, or a value that is not even a string, cannot blind it to the version beside it, and a
 *   malformed version cannot blind it to the writer. Whatever it cannot make sense of reads as "not declared", leaving
 *   the real diagnosis to the deserializer that eventually reads the whole thing.
 *
 *   The writer is the one the snapshot names, when this build knows that name; otherwise `inferWriter` may read it off
 *   the shape. That hook exists for the one surface whose shape says who wrote it — unshielded, where only the V1
 *   variant ever wrote a bare-string verifying key — so that a snapshot written before snapshots named their writer can
 *   still be sent home. Shielded and dust carry no such shape and pass nothing.
 * @param serialized The serialized wallet state.
 * @param inferWriter Names the writer from the decoded JSON when the snapshot names none this build knows. Defaults to
 *   never inferring.
 * @returns The two fields, each `Option.none()` when not declared, not readable, or (for the writer) not known.
 */
export const readEnvelope = (serialized: string, inferWriter: InferWriter = noInference): SnapshotEnvelope =>
  Option.match(parseJson(serialized).pipe(Option.filter(isRecord)), {
    onNone: () => ({ protocolVersion: Option.none(), writer: Option.none() }),
    onSome: (json) => ({
      protocolVersion: decodeVersion(json['protocolVersion']),
      writer: Option.some(json['writtenBy']).pipe(
        Option.filter(isSnapshotWriter),
        Option.orElse(() => inferWriter(json)),
      ),
    }),
  });

/**
 * Chooses the variant that should read a snapshot, from what {@link readEnvelope} found on it.
 *
 * @remarks
 *   The variant that wrote a snapshot is the one to read it, when the envelope says which and that variant is registered:
 *   a V1 wallet that has seen the chain reach `forks.v9` annotates that version before the runtime hands it over, so a
 *   snapshot it writes in that window carries a version the V2 variant owns. Read as a V2 snapshot it would skip the
 *   cross-ledger migration; restored on the V1 variant, that variant announces the out-of-range version on its first
 *   observation and the runtime migrates it, exactly as for a live crossing.
 *
 *   Otherwise the version decides. A snapshot that declares no version predates snapshots declaring one, and can only
 *   have been written by the variant that shipped before the question arose — the head variant. The same fallback
 *   covers an envelope that could not be read at all: refusing it here would replace the deserializer's precise error
 *   with a vaguer one. A declared version that no registered variant owns is refused through the error the caller
 *   builds, so each surface reports it under its own tag.
 * @param params.envelope What the snapshot declares.
 * @param params.variantFor Resolves the variant registered for a protocol version.
 * @param params.headVariant The variant a snapshot with no declared version is restored into.
 * @param params.variantWrittenBy Resolves the registered variant that a snapshot names as its writer, if registered.
 * @param params.unsupported Builds the caller's error for a version no registered variant owns.
 * @returns The variant to restore with, or the caller's error when the writer is not registered and the declared
 *   version is one no registered variant owns.
 */
export const routeSnapshot = <TVariant, E>(params: {
  readonly envelope: SnapshotEnvelope;
  readonly variantFor: (version: ProtocolVersion) => Option.Option<TVariant>;
  readonly headVariant: TVariant;
  readonly variantWrittenBy: (writer: SnapshotWriter) => Option.Option<TVariant>;
  readonly unsupported: (version: ProtocolVersion) => E;
}): Either.Either<TVariant, E> =>
  Option.match(Option.flatMap(params.envelope.writer, params.variantWrittenBy), {
    onSome: (variant) => Either.right(variant),
    onNone: () =>
      Option.match(params.envelope.protocolVersion, {
        onNone: () => Either.right(params.headVariant),
        onSome: (protocolVersion) =>
          Either.fromOption(params.variantFor(protocolVersion), () => params.unsupported(protocolVersion)),
      }),
  });
