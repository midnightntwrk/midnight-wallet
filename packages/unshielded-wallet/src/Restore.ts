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
import { type ProtocolVersion, SnapshotFormat, SnapshotRouting } from '@midnightntwrk/wallet-sdk-abstractions';
import { Data, type Either, Option } from 'effect';
import { isV1Keyed } from './SnapshotFormat.js';

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
 * Names the writer of an unshielded snapshot from its shape, when the snapshot names none this build knows.
 *
 * @remarks
 *   Only the V1 variant ever wrote the verifying key as a bare string, because ledger-v8 signs with one scheme; the V2
 *   variant has tagged it with its scheme since before either variant named itself. So a bare-string key is V1's
 *   signature, and it is what lets a V1 snapshot saved in the fork window by a build that predates the writer field
 *   still be sent home and cross through the migration. Unshielded is the one surface with such a shape: shielded and
 *   dust snapshots carry nothing that says who wrote them, and their `Restore.ts` passes no hook.
 */
const writerFromKeyShape: SnapshotRouting.InferWriter = (json) =>
  isV1Keyed(json) ? Option.some(SnapshotFormat.V1_SNAPSHOT_WRITER) : Option.none();

const readEnvelope = (serialized: string): SnapshotRouting.SnapshotEnvelope =>
  SnapshotRouting.readEnvelope(serialized, writerFromKeyShape);

/**
 * Reads the protocol version a serialized unshielded wallet snapshot declares.
 *
 * @param serialized The serialized wallet state.
 * @returns The declared version, or `Option.none()` when the snapshot declares none or cannot be read at all.
 */
export const peekProtocolVersion = (serialized: string): Option.Option<ProtocolVersion.ProtocolVersion> =>
  readEnvelope(serialized).protocolVersion;

/**
 * Reads which variant wrote a serialized unshielded wallet snapshot.
 *
 * @remarks
 *   The writer the snapshot names wins, when it names one this build knows. When it names none this build knows — no name
 *   at all, or a name from a variant this build does not have, which routing treats alike — the shape of the verifying
 *   key answers instead ({@link writerFromKeyShape}).
 * @param serialized The serialized wallet state.
 * @returns The writer, or `Option.none()` when the snapshot neither names a writer this build knows nor carries the key
 *   shape only V1 wrote, or cannot be read at all.
 */
export const peekWriter = (serialized: string): Option.Option<SnapshotFormat.SnapshotWriter> =>
  readEnvelope(serialized).writer;

/**
 * Chooses the variant that should read a serialized unshielded wallet snapshot.
 *
 * @remarks
 *   The rule is {@link SnapshotRouting.routeSnapshot}'s: the variant that wrote the snapshot when it says which and that
 *   variant is registered, otherwise the variant that owns the declared version, otherwise the head variant. For
 *   unshielded, "says which" includes a snapshot that names no known writer but carries the bare-string key only V1
 *   wrote, so such a snapshot from a build that predates the field goes home too. The envelope is read once here, not
 *   once per question.
 * @param serialized The serialized wallet state.
 * @param variantFor Resolves the variant registered for a protocol version.
 * @param headVariant The variant a snapshot with no declared version is restored into.
 * @param variantWrittenBy Resolves the registered variant that a snapshot names as its writer, if it is registered.
 *   Defaults to none, which is the routing every caller had before snapshots named their writer.
 * @returns The variant to restore with, or {@link UnsupportedSnapshotVersionError} when the writer is not registered and
 *   the declared version is one no registered variant owns.
 */
export const variantForSnapshot = <TVariant>(
  serialized: string,
  variantFor: (version: ProtocolVersion.ProtocolVersion) => Option.Option<TVariant>,
  headVariant: TVariant,
  variantWrittenBy: (writer: SnapshotFormat.SnapshotWriter) => Option.Option<TVariant> = () => Option.none(),
): Either.Either<TVariant, UnsupportedSnapshotVersionError> =>
  SnapshotRouting.routeSnapshot({
    envelope: readEnvelope(serialized),
    variantFor,
    headVariant,
    variantWrittenBy,
    unsupported: (protocolVersion) =>
      new UnsupportedSnapshotVersionError({
        message: `No registered variant reads unshielded wallet snapshots of protocol version ${protocolVersion}.`,
        protocolVersion,
      }),
  });
