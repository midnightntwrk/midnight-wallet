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
import type * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import type * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { type TokenType, type UnshieldedUtxo } from '@midnightntwrk/wallet-sdk-abstractions';
import { type Signing } from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, it } from 'vitest';

/**
 * The unshielded API states its UTxOs, token types and signatures in types the SDK owns, so it names no ledger version.
 * That holds only while both ledger versions' values fit them: a change in either fails here, rather than as a variant
 * that reports something its API does not describe.
 */
describe("the unshielded API's types", () => {
  it("are exactly ledger-v8's UTxOs and token types, which the V1 variant reports", () => {
    type _1 = Expect<Equal<ledgerV8.Utxo, UnshieldedUtxo>>;
    type _2 = Expect<Equal<ledgerV8.RawTokenType, TokenType>>;
  });

  it("are exactly ledger-v9's UTxOs and token types, which the V2 variant reports", () => {
    type _1 = Expect<Equal<ledgerV9.Utxo, UnshieldedUtxo>>;
    type _2 = Expect<Equal<ledgerV9.RawTokenType, TokenType>>;
  });

  it("take ledger-v9's signatures as they are, and ledger-v8's bare key only by lifting it", () => {
    // A signer answers in the SDK's shape, and the V2 variant hands that to ledger-v9 unchanged.
    type _1 = Expect<CanAssign<Signing.Signature, ledgerV9.Signature>>;
    type _2 = Expect<CanAssign<ledgerV9.SignatureVerifyingKey, Signing.SignatureVerifyingKey>>;
    // Ledger-v8's key names no scheme, so it is never one of the SDK's keys without being lifted.
    type _3 = Expect<Equal<CanAssign<ledgerV8.SignatureVerifyingKey, Signing.SignatureVerifyingKey>, false>>;
  });
});
