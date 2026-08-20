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
 * The names the SDK gives to token types, so an application never has to ask a ledger version for one.
 *
 * @remarks
 *   A token type is thirty-two bytes, written as hexadecimal, and it is the same thirty-two bytes on either side of a
 *   protocol boundary — which is the whole reason the SDK can name one for itself. Until now an application wanting the
 *   Night token type had to call `nativeToken().raw` on a ledger package, which meant importing a ledger version to
 *   read a constant that does not depend on one.
 */
import * as Data from 'effect/Data';
import * as Either from 'effect/Either';

/**
 * A token type, in the raw form every balance and coin is keyed by.
 *
 * @remarks
 *   Deliberately a plain `string` and **not** a branded type, which is a considered exception to this codebase's
 *   parse-don't-validate default. Balances are `Record<TokenType, bigint>`, and a branded key type does not produce a
 *   string index signature: branding here would break every balance read in the SDK and in every application, to buy a
 *   guarantee that the values are not confusable with anything else a caller holds anyway. Use {@link parseTokenType} at
 *   the boundary where a token type arrives from outside, which is where the guarantee is actually worth having.
 */
export type TokenType = string;

/** Raised when a value offered as a token type is not one. */
export class InvalidTokenTypeError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-abstractions/TokenType/InvalidTokenTypeError',
)<{
  readonly message: string;
  /** What was offered, so the caller can report it alongside the field it came from. */
  readonly value: string;
}> {}

/** Thirty-two bytes of lower-case hexadecimal: the form both ledger versions write a token type in. */
const TOKEN_TYPE_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The token types the SDK names.
 *
 * @remarks
 *   String literals rather than calls into a ledger, and that is load-bearing: these constants reach an application
 *   through the umbrella package's root barrel, which is the one place no ledger version's WebAssembly may be loaded. A
 *   test pins each of them against both ledger versions, so the literal cannot drift away from what the chain means.
 *
 *   There is one constant because there is one raw type to name. Both ledger versions report the same thirty-two bytes
 *   for the native, shielded and unshielded token; what distinguishes them is a `tag` on the ledger's own wrapper, and
 *   a balance is keyed by the raw type alone.
 */
export const Token = {
  /** Night: the token the chain is denominated in, and the resource Dust is generated from. */
  night: '0000000000000000000000000000000000000000000000000000000000000000',
} as const satisfies Readonly<Record<string, TokenType>>;

/**
 * Reads a token type from a value that came from outside the SDK.
 *
 * @remarks
 *   The boundary check the unbranded {@link TokenType} does not make for itself: a dApp request, a URL parameter or a
 *   configuration file can carry anything, and a token type that is quietly wrong selects no coins rather than failing.
 *   Returns rather than throws, because "this is not a token type" is an ordinary thing for input to be.
 * @example
 *   ```typescript
 *   const tokenType = parseTokenType(request.tokenType).pipe(
 *     Either.getOrElse(() => Token.night),
 *   );
 *   ```;
 *
 * @param value The value offered as a token type.
 * @returns The token type, or an {@link InvalidTokenTypeError} naming what was offered.
 */
export const parseTokenType = (value: string): Either.Either<TokenType, InvalidTokenTypeError> =>
  TOKEN_TYPE_PATTERN.test(value)
    ? Either.right(value)
    : Either.left(
        new InvalidTokenTypeError({
          message:
            `"${value}" is not a token type: a token type is thirty-two bytes written as sixty-four lower-case ` +
            `hexadecimal characters.`,
          value,
        }),
      );
