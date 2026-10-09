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
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { InvalidTokenTypeError, parseTokenType, Token, type TokenType } from '../TokenType.js';

describe('the token types the SDK names for itself', () => {
  it('names Night without asking a ledger version for it', () => {
    // A plain string literal, not a call into either ledger's WebAssembly: this constant reaches an application
    // through the umbrella package's root, which is the one place no ledger may be loaded.
    expect(Token.night).toBe('0000000000000000000000000000000000000000000000000000000000000000');
    expect(typeof Token.night).toBe('string');
  });

  it('is a string, so a balance record still has a string index signature', () => {
    // Deliberately unbranded. A branded key type does not produce a string index signature, and every balance read in
    // the SDK is `balances[someTokenType]`.
    const balances: Record<TokenType, bigint> = { [Token.night]: 7n };
    const key: string = Token.night;

    expect(balances[key]).toBe(7n);
  });
});

describe('reading a token type an application supplied', () => {
  it('accepts the raw form a ledger writes', () => {
    expect(parseTokenType(Token.night)).toStrictEqual(Either.right(Token.night));
    expect(parseTokenType('772032da83618448e5cf06d3033e368642fb27150a8cdb3af5820d4d2fa04f2d')).toStrictEqual(
      Either.right('772032da83618448e5cf06d3033e368642fb27150a8cdb3af5820d4d2fa04f2d'),
    );
  });

  it('refuses anything that is not thirty-two bytes of lower-case hex', () => {
    const tooShort = parseTokenType('00');
    const notHex = parseTokenType('zz32032da83618448e5cf06d3033e368642fb27150a8cdb3af5820d4d2fa04f2d');
    const upperCase = parseTokenType('772032DA83618448E5CF06D3033E368642FB27150A8CDB3AF5820D4D2FA04F2D');

    expect(Either.getOrThrow(Either.flip(tooShort))).toBeInstanceOf(InvalidTokenTypeError);
    expect(Either.getOrThrow(Either.flip(notHex))).toBeInstanceOf(InvalidTokenTypeError);
    expect(Either.getOrThrow(Either.flip(upperCase))).toBeInstanceOf(InvalidTokenTypeError);
  });

  it('says what it was given, so the caller can name the field that was wrong', () => {
    const error = Either.getOrThrow(Either.flip(parseTokenType('nonsense')));

    expect(error.value).toBe('nonsense');
    expect(error.message).toContain('nonsense');
  });
});
