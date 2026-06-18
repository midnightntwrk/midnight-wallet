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
//
// Pure scheme-consistency guards for unshielded signing (#402 AC #4).
//
// An unshielded key, address, and signature each carry a signature scheme
// (`schnorr` | `ecdsa`). These schemes must never be mixed: doing so is a
// security issue, not a cosmetic one. Every guard here is a pure, synchronous
// function returning an `Either` so a mismatch is decided BEFORE any network
// submission, with a clear, typed `SchemeMismatchError` — never coerced.
import {
  addressFromKey,
  type Signature,
  type SignatureKind,
  type SignatureVerifyingKey,
} from '@midnight-ntwrk/ledger-v9';
import { Either, pipe } from 'effect';
import type { PublicKey } from './KeyStore.js';
import { OtherWalletError, SchemeMismatchError, type WalletError } from './v1/WalletError.js';

const otherScheme = (kind: SignatureKind): SignatureKind => (kind === 'schnorr' ? 'ecdsa' : 'schnorr');

// Hex-string lengths of a verifying key per scheme: BIP-340 schnorr keys are
// 32-byte x-only (64 hex); ecdsa keys are 33-byte SEC1-compressed (66 hex).
const VERIFYING_KEY_HEX_LENGTH: Record<SignatureKind, number> = { schnorr: 64, ecdsa: 66 };

const schemeForVerifyingKeyHexLength = (length: number): SignatureKind | undefined => {
  if (length === VERIFYING_KEY_HEX_LENGTH.schnorr) {
    return 'schnorr';
  }
  if (length === VERIFYING_KEY_HEX_LENGTH.ecdsa) {
    return 'ecdsa';
  }
  return undefined;
};

/**
 * Asserts that a {@link PublicKey}'s stored address was derived from its stored verifying key. A `schnorr` address
 * bundled with an `ecdsa` key (or the inverse) is rejected at wallet construction.
 *
 * @param publicKey - The keystore-derived public key bundle to validate.
 * @returns `Right(publicKey)` when the address matches the key; `Left(SchemeMismatchError)` tagged `at: 'construction'`
 *   when it does not; or `Left(OtherWalletError)` when the key cannot be decoded at all.
 */
export const assertKeyAddressConsistency = (publicKey: PublicKey): Either.Either<PublicKey, WalletError> =>
  pipe(
    // Deriving the address exercises the ledger's key decoder. A value that cleared the length/tag check but is not a
    // valid curve point throws inside the wasm; wrap it so this guard (run on the deserialization trust boundary) fails
    // closed with a typed error instead of letting a wasm trap escape.
    Either.try({
      try: () => addressFromKey(publicKey.publicKey),
      catch: (cause) =>
        new OtherWalletError({
          message: `Unshielded verifying key could not be decoded as a ${publicKey.publicKey.tag} key.`,
          cause,
        }),
    }),
    Either.flatMap((derivedAddress): Either.Either<PublicKey, WalletError> => {
      if (derivedAddress === publicKey.addressHex) {
        return Either.right(publicKey);
      }
      // An unshielded address is a scheme-less 32-byte hash, so its own scheme cannot be read back from it. A mismatch
      // is therefore reported as the cross-scheme mix this guard exists to catch: `supplied` is the key's actual scheme
      // and `expected` is the other scheme the address must have been derived under.
      const supplied = publicKey.publicKey.tag;
      const expected = otherScheme(supplied);
      return Either.left(
        new SchemeMismatchError({
          at: 'construction',
          expected,
          supplied,
          message: `Unshielded address does not match its verifying key: the address is derived under the ${expected} scheme but the supplied key is ${supplied}. Signature schemes must not be mixed.`,
        }),
      );
    }),
  );

/**
 * Asserts that a supplied signature shares the scheme of the verifying key it will be checked against. Used at
 * signature-provision time so a `schnorr` signature can never be attached under an `ecdsa` key (or the inverse).
 *
 * @param key - The verifying key the signature must match.
 * @param signature - The supplied signature.
 * @returns `Right(signature)` (unchanged — no coercion) when the schemes match; otherwise `Left(SchemeMismatchError)`
 *   tagged `at: 'signature-provision'`, with `expected` = the key's scheme and `supplied` = the signature's scheme.
 */
export const assertSignatureMatchesKey = (
  key: SignatureVerifyingKey,
  signature: Signature,
): Either.Either<Signature, SchemeMismatchError> => {
  if (key.tag === signature.tag) {
    return Either.right(signature);
  }
  return Either.left(
    new SchemeMismatchError({
      at: 'signature-provision',
      expected: key.tag,
      supplied: signature.tag,
      message: `Signature scheme does not match the signing key: expected a ${key.tag} signature but a ${signature.tag} signature was supplied. Signature schemes must not be mixed.`,
    }),
  );
};

/**
 * Asserts that a verifying key's encoding length matches its scheme tag, enforcing the tag boundary on the
 * deserialization path so a key cannot be relabelled across schemes (e.g. an `ecdsa`-tagged value carrying a 32-byte
 * schnorr key).
 *
 * @param key - The tagged verifying key to validate.
 * @returns `Right(key)` when the encoding length matches the tag; otherwise `Left(SchemeMismatchError)` tagged `at:
 *   'deserialization'`.
 */
export const assertKeyTagConsistency = (
  key: SignatureVerifyingKey,
): Either.Either<SignatureVerifyingKey, SchemeMismatchError> => {
  if (key.value.length === VERIFYING_KEY_HEX_LENGTH[key.tag]) {
    return Either.right(key);
  }
  const supplied = schemeForVerifyingKeyHexLength(key.value.length) ?? otherScheme(key.tag);
  return Either.left(
    new SchemeMismatchError({
      at: 'deserialization',
      expected: key.tag,
      supplied,
      message: `Verifying key encoding does not match its scheme tag: tag is ${key.tag} (expects a ${VERIFYING_KEY_HEX_LENGTH[key.tag] / 2}-byte key) but the value encodes ${key.value.length / 2} bytes. Signature schemes must not be mixed.`,
    }),
  );
};
