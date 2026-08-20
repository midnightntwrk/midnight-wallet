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
 *   The one scalar that genuinely changed shape at the fork. The pre-fork ledger version has a single signature scheme
 *   and writes a signature as bare hex; the current one names the scheme alongside the bytes, because it has more than
 *   one. So the SDK speaks the current shape everywhere and lowers it for the pre-fork variant, which is a total
 *   operation in one direction and a partial one in the other: a signature of a scheme the pre-fork ledger has never
 *   heard of cannot be lowered at all, and says so rather than being handed over as bytes it would misread.
 */
import type * as preForkLedger from '@midnight-ntwrk/ledger-v8';
import type * as ledger from '@midnightntwrk/ledger-v9';
import { Data, Either } from 'effect';

/** The signature scheme the pre-fork ledger version has, and the only one a lowered value can name. */
const PRE_FORK_SIGNATURE_KIND: ledger.SignatureKind = 'schnorr';

/** Raised when a signature or verifying key names a scheme the pre-fork ledger version does not have. */
export class UnsupportedSignatureKindError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/signatures/preForkSignatures/UnsupportedSignatureKindError',
)<{
  readonly message: string;
  /** The scheme that was named. */
  readonly kind: ledger.SignatureKind;
}> {}

const lower = (
  value: Readonly<{ tag: ledger.SignatureKind; value: string }>,
  what: string,
): Either.Either<string, UnsupportedSignatureKindError> =>
  value.tag === PRE_FORK_SIGNATURE_KIND
    ? Either.right(value.value)
    : Either.left(
        new UnsupportedSignatureKindError({
          message:
            `This ${what} names the ${value.tag} signature scheme, which the ledger version before the protocol ` +
            `boundary does not have: it has ${PRE_FORK_SIGNATURE_KIND} and nothing else. Sign with ` +
            `${PRE_FORK_SIGNATURE_KIND} while the chain is still pre-fork.`,
          kind: value.tag,
        }),
      );

/**
 * Lowers a signature to the pre-fork ledger version's shape.
 *
 * @param signature The signature, as the current ledger version writes it.
 * @returns The bare hex the pre-fork ledger version reads, or the reason it cannot be expressed there.
 */
export const lowerSignature = (
  signature: ledger.Signature,
): Either.Either<preForkLedger.Signature, UnsupportedSignatureKindError> => lower(signature, 'signature');

/**
 * Lowers a signature verifying key to the pre-fork ledger version's shape.
 *
 * @param key The verifying key, as the current ledger version writes it.
 * @returns The bare hex the pre-fork ledger version reads, or the reason it cannot be expressed there.
 */
export const lowerSignatureVerifyingKey = (
  key: ledger.SignatureVerifyingKey,
): Either.Either<preForkLedger.SignatureVerifyingKey, UnsupportedSignatureKindError> => lower(key, 'verifying key');

/**
 * Lifts a pre-fork signature into the current ledger version's shape.
 *
 * @remarks
 *   Total, unlike lowering: the pre-fork ledger version has exactly one scheme, so naming it is never a guess.
 * @param signature The signature, as the pre-fork ledger version writes it.
 * @returns The same signature, with the scheme it necessarily used named.
 */
export const liftSignature = (signature: preForkLedger.Signature): ledger.Signature => ({
  tag: PRE_FORK_SIGNATURE_KIND,
  value: signature,
});

/**
 * Lifts a pre-fork verifying key into the current ledger version's shape.
 *
 * @param key The verifying key, as the pre-fork ledger version writes it.
 * @returns The same key, with the scheme it necessarily used named.
 */
export const liftSignatureVerifyingKey = (key: preForkLedger.SignatureVerifyingKey): ledger.SignatureVerifyingKey => ({
  tag: PRE_FORK_SIGNATURE_KIND,
  value: key,
});
