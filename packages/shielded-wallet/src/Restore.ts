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
import { ProtocolVersion, type SnapshotFormat, SnapshotRouting } from '@midnightntwrk/wallet-sdk-abstractions';
import { Data, type Either, Option } from 'effect';

/**
 * Raised when a snapshot declares a protocol version that no registered variant is able to read.
 *
 * @remarks
 *   A wallet built for one range of protocol versions cannot invent a reader for a snapshot written outside it, and
 *   guessing — handing the bytes to whichever variant happens to be registered — would decode them with the wrong
 *   ledger. The version is carried on the error so an application can say which one it was.
 */
export class UnsupportedSnapshotVersionError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-shielded/Restore/UnsupportedSnapshotVersionError',
)<{
  readonly message: string;
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
}> {}

/**
 * Reads the protocol version a serialized shielded wallet snapshot declares.
 *
 * @param serialized The serialized wallet state.
 * @returns The declared version, or `Option.none()` when the snapshot declares none or cannot be read at all.
 */
export const peekProtocolVersion = (serialized: string): Option.Option<ProtocolVersion.ProtocolVersion> =>
  SnapshotRouting.readEnvelope(serialized).protocolVersion;

/**
 * Reads which variant wrote a serialized shielded wallet snapshot, when it says.
 *
 * @remarks
 *   Shielded snapshots carry nothing in their shape that says which variant wrote them, so only the name counts; a
 *   snapshot written before snapshots named their writer reads as naming none.
 * @param serialized The serialized wallet state.
 * @returns The writer, or `Option.none()` when the snapshot predates the field, names a writer this build does not
 *   know, or cannot be read at all.
 */
export const peekWriter = (serialized: string): Option.Option<SnapshotFormat.SnapshotWriter> =>
  SnapshotRouting.readEnvelope(serialized).writer;

/**
 * Chooses the variant that should read a serialized shielded wallet snapshot.
 *
 * @remarks
 *   The rule is {@link SnapshotRouting.routeSnapshot}'s: the variant that wrote the snapshot when it says which and that
 *   variant is registered, otherwise the variant that owns the declared version, otherwise the head variant. The
 *   envelope is read once here, not once per question.
 * @param serialized The serialized wallet state.
 * @param variantFor Resolves the variant registered for a protocol version.
 * @param headVariant The variant a snapshot with no declared version is restored into.
 * @param variantWrittenBy Resolves the registered variant that a snapshot names as its writer, if it is registered.
 *   Defaults to none, which is the routing every caller had before snapshots named their writer.
 * @param activationOf The protocol version a registered variant starts answering for, as the wallet registered it. The
 *   writer takes a snapshot only from that version upwards; below it the version routes, since the runtime cannot hand
 *   over backwards. Defaults to the minimum version, which lets the writer take any snapshot, for compositions that
 *   pass no writer resolver either.
 * @returns The variant to restore with, or {@link UnsupportedSnapshotVersionError} when the writer is not registered and
 *   the declared version is one no registered variant owns.
 */
export const variantForSnapshot = <TVariant>(
  serialized: string,
  variantFor: (version: ProtocolVersion.ProtocolVersion) => Option.Option<TVariant>,
  headVariant: TVariant,
  variantWrittenBy: (writer: SnapshotFormat.SnapshotWriter) => Option.Option<TVariant> = () => Option.none(),
  activationOf: (variant: TVariant) => ProtocolVersion.ProtocolVersion = () => ProtocolVersion.MinSupportedVersion,
): Either.Either<TVariant, UnsupportedSnapshotVersionError> =>
  SnapshotRouting.routeSnapshot({
    activationOf,
    envelope: SnapshotRouting.readEnvelope(serialized),
    variantFor,
    headVariant,
    variantWrittenBy,
    unsupported: (protocolVersion) =>
      new UnsupportedSnapshotVersionError({
        message: `No registered variant reads shielded wallet snapshots of protocol version ${protocolVersion}.`,
        protocolVersion,
      }),
  });
