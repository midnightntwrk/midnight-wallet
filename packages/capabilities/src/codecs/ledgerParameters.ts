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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Buffer } from 'buffer';
import { Data, Either, pipe } from 'effect';

/**
 * Reads the indexer's hex-encoded ledger parameters as one ledger version understands them.
 *
 * @remarks
 *   A codec is deliberately allowed to throw: it wraps a WASM deserializer, and what it throws on is precisely the other
 *   ledger version's bytes. {@link decode} is the only way to call one, and it turns that into a typed failure.
 * @typeParam TParameters The `LedgerParameters` type of the ledger version this codec speaks.
 */
export type LedgerParametersCodec<TParameters> = Readonly<{
  decode: (hex: string) => TParameters;
}>;

/**
 * The codecs a caller is willing to decode with, keyed by the protocol version range each one serves.
 *
 * @remarks
 *   Registration is per caller, not global, and a caller registers only the ledger versions its own types are written
 *   against — which is why the registry stays homogeneous in `TParameters` while the SDK as a whole spans two ledgers.
 *   A version outside every registered range therefore means "this block belongs to a different variant", and
 *   {@link decode} says so instead of handing the bytes to a deserializer that would reject them.
 * @typeParam TParameters The `LedgerParameters` type the registered codecs produce.
 */
export type LedgerParametersCodecs<TParameters> = ProtocolVersion.Registry<LedgerParametersCodec<TParameters>>;

/** Raised when no registered codec claims the protocol version a block was reported under. */
export class UnsupportedProtocolVersionError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/codecs/ledgerParameters/UnsupportedProtocolVersionError',
)<{
  readonly message: string;
  /** The version the block was reported under, which no registered codec covers. */
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
}> {}

/** Raised when the codec chosen for a protocol version could not read the bytes it was given. */
export class LedgerParametersDecodeError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/codecs/ledgerParameters/LedgerParametersDecodeError',
)<{
  readonly message: string;
  /** The version the block was reported under, and so the codec that was chosen. */
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly cause: unknown;
}> {}

/** Every way a version-routed ledger parameters decode can fail. */
export type LedgerParametersCodecError = UnsupportedProtocolVersionError | LedgerParametersDecodeError;

/**
 * Builds a codec from a ledger version's `LedgerParameters.deserialize`.
 *
 * @param deserialize The ledger version's deserializer.
 * @returns A codec that hex-decodes the indexer's encoding before handing the bytes over.
 */
export const fromDeserializer = <TParameters>(
  deserialize: (bytes: Uint8Array) => TParameters,
): LedgerParametersCodec<TParameters> => ({
  decode: (hex: string): TParameters => deserialize(Buffer.from(hex, 'hex')),
});

/**
 * Decodes hex-encoded ledger parameters with the codec registered for the protocol version the block was reported
 * under.
 *
 * @param codecs The codecs the caller is willing to decode with.
 * @param protocolVersion The version the indexer reported the block under.
 * @param hex The block's hex-encoded ledger parameters.
 * @returns The decoded parameters, an {@link UnsupportedProtocolVersionError} when no codec claims that version, or a
 *   {@link LedgerParametersDecodeError} when the chosen codec could not read the bytes.
 */
export const decode = <TParameters>(
  codecs: LedgerParametersCodecs<TParameters>,
  protocolVersion: ProtocolVersion.ProtocolVersion,
  hex: string,
): Either.Either<TParameters, LedgerParametersCodecError> =>
  pipe(
    ProtocolVersion.select(codecs, protocolVersion),
    Either.fromOption(
      (): LedgerParametersCodecError =>
        new UnsupportedProtocolVersionError({
          message: `No ledger parameters codec is registered for protocol version ${protocolVersion}.`,
          protocolVersion,
        }),
    ),
    Either.flatMap((codec) =>
      Either.try({
        try: () => codec.decode(hex),
        catch: (cause): LedgerParametersCodecError =>
          new LedgerParametersDecodeError({
            message: `Could not decode ledger parameters reported at protocol version ${protocolVersion}.`,
            protocolVersion,
            cause,
          }),
      }),
    ),
  );

/**
 * Builds a registry from codecs and the versions they activate at.
 *
 * @remarks
 *   A thin name over {@link ProtocolVersion.makeRegistryFromActivations} so that codec registration reads the same as
 *   variant registration and cannot drift from it. The activation list is a constant at every call site in the SDK, so
 *   a rejection here is a programming error rather than a runtime condition — callers that build one at module scope
 *   are entitled to let it throw.
 * @param activations The codecs and the versions they start serving, in strictly ascending order.
 * @returns The registry, or the {@link ProtocolVersion.RegistryError} naming the versions that broke the ordering.
 */
export const makeCodecs = <TParameters>(
  activations: readonly Readonly<{
    sinceVersion: ProtocolVersion.ProtocolVersion;
    codec: LedgerParametersCodec<TParameters>;
  }>[],
): Either.Either<LedgerParametersCodecs<TParameters>, ProtocolVersion.RegistryError> =>
  ProtocolVersion.makeRegistryFromActivations(
    activations.map(({ sinceVersion, codec }) => ({ sinceVersion, value: codec })),
  );
