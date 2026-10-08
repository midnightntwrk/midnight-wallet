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
 * Signatures and verifying keys across a protocol boundary.
 *
 * @remarks
 *   The one scalar that genuinely changed shape at the fork. Ledger-v8 has a single signature scheme and writes a
 *   signature as bare hex; ledger-v9 names the scheme alongside the bytes, because it has more than one. So the SDK
 *   speaks the ledger-v9 shape everywhere and lowers it for the V1 variant, which is a total operation in one direction
 *   and a partial one in the other: a signature of a scheme ledger-v8 has never heard of cannot be lowered at all, and
 *   says so rather than being handed over as bytes it would misread.
 */
import type * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import { Data, Either } from 'effect';
import type * as Signing from './signing.js';

/** The signature scheme ledger-v8 has, and the only one a lowered value can name. */
const V8_SIGNATURE_KIND: Signing.SignatureKind = 'schnorr';

/** Raised when a signature or verifying key names a scheme ledger-v8 does not have. */
export class UnsupportedSignatureKindError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/signatures/v8Signatures/UnsupportedSignatureKindError',
)<{
  readonly message: string;
  /** The scheme that was named. */
  readonly kind: Signing.SignatureKind;
}> {}

const lower = (
  value: Signing.Signature | Signing.SignatureVerifyingKey,
  what: string,
): Either.Either<string, UnsupportedSignatureKindError> =>
  value.tag === V8_SIGNATURE_KIND
    ? Either.right(value.value)
    : Either.left(
        new UnsupportedSignatureKindError({
          message:
            `This ${what} names the ${value.tag} signature scheme, which the ledger version before the protocol ` +
            `boundary does not have: it has ${V8_SIGNATURE_KIND} and nothing else. Sign with ` +
            `${V8_SIGNATURE_KIND} while the chain is still on ledger-v8.`,
          kind: value.tag,
        }),
      );

/**
 * Lowers a signature to ledger-v8's shape.
 *
 * @param signature The signature, as ledger-v9 writes it.
 * @returns The bare hex ledger-v8 reads, or the reason it cannot be expressed there.
 */
export const lowerSignature = (
  signature: Signing.Signature,
): Either.Either<ledgerV8.Signature, UnsupportedSignatureKindError> => lower(signature, 'signature');

/**
 * Lowers a signature verifying key to ledger-v8's shape.
 *
 * @param key The verifying key, as ledger-v9 writes it.
 * @returns The bare hex ledger-v8 reads, or the reason it cannot be expressed there.
 */
export const lowerSignatureVerifyingKey = (
  key: Signing.SignatureVerifyingKey,
): Either.Either<ledgerV8.SignatureVerifyingKey, UnsupportedSignatureKindError> => lower(key, 'verifying key');

/**
 * Lifts a ledger-v8 signature into ledger-v9's shape.
 *
 * @remarks
 *   Total, unlike lowering: ledger-v8 has exactly one scheme, so naming it is never a guess.
 * @param signature The signature, as ledger-v8 writes it.
 * @returns The same signature, with the scheme it necessarily used named.
 */
export const liftSignature = (signature: ledgerV8.Signature): Signing.Signature => ({
  tag: V8_SIGNATURE_KIND,
  value: signature,
});

/**
 * Lifts a ledger-v8 verifying key into ledger-v9's shape.
 *
 * @param key The verifying key, as ledger-v8 writes it.
 * @returns The same key, with the scheme it necessarily used named.
 */
export const liftSignatureVerifyingKey = (key: ledgerV8.SignatureVerifyingKey): Signing.SignatureVerifyingKey => ({
  tag: V8_SIGNATURE_KIND,
  value: key,
});
