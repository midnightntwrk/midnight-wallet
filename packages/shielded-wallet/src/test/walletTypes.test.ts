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
import { type TokenType } from '@midnightntwrk/wallet-sdk-abstractions';
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, it } from 'vitest';
import {
  type CoinCommitment,
  type Nullifier,
  type QualifiedShieldedCoinInfo,
  type ShieldedCoinInfo,
} from '../types/ShieldedWalletTypes.js';

/**
 * The shielded API states its coins in its own types, so it names no ledger version. That holds only while both ledger
 * versions' coins are exactly those types: a field either ledger version adds, drops or retypes fails here, rather than
 * as a variant that reports something its API does not describe.
 */
describe("the shielded API's coin types", () => {
  it("are exactly ledger-v8's, which the V1 variant reports", () => {
    type _1 = Expect<Equal<ledgerV8.QualifiedShieldedCoinInfo, QualifiedShieldedCoinInfo>>;
    type _2 = Expect<Equal<ledgerV8.ShieldedCoinInfo, ShieldedCoinInfo>>;
    type _3 = Expect<Equal<ledgerV8.Nullifier, Nullifier>>;
    type _4 = Expect<Equal<ledgerV8.CoinCommitment, CoinCommitment>>;
    type _5 = Expect<Equal<ledgerV8.RawTokenType, TokenType>>;
  });

  it("are exactly ledger-v9's, which the V2 variant reports", () => {
    type _1 = Expect<Equal<ledgerV9.QualifiedShieldedCoinInfo, QualifiedShieldedCoinInfo>>;
    type _2 = Expect<Equal<ledgerV9.ShieldedCoinInfo, ShieldedCoinInfo>>;
    type _3 = Expect<Equal<ledgerV9.Nullifier, Nullifier>>;
    type _4 = Expect<Equal<ledgerV9.CoinCommitment, CoinCommitment>>;
    type _5 = Expect<Equal<ledgerV9.RawTokenType, TokenType>>;
  });
});
