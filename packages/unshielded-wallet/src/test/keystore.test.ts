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
import { type Signing } from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, expect, it } from 'vitest';
import {
  type PublicKey,
  type UnshieldedKeystore,
  type UnshieldedSecretKey,
  type UnshieldedWalletTypes,
} from '../index.js';
import * as V1 from '../v1/index.js';
import * as V2 from '../v2/index.js';

describe('the keystore at the package root', () => {
  // A wallet spanning `forks.v9` signs for both variants with one keystore, so its keys are stated in the SDK's own
  // shapes, declared where the rest of the API's data is, and name neither ledger version.
  it("states its keys and signatures in the SDK's shapes", () => {
    type _1 = Expect<Equal<PublicKey['publicKey'], Signing.SignatureVerifyingKey>>;
    type _2 = Expect<Equal<ReturnType<UnshieldedKeystore['getPublicKey']>, Signing.SignatureVerifyingKey>>;
    type _3 = Expect<Equal<ReturnType<UnshieldedKeystore['signData']>, Signing.Signature>>;
    type _4 = Expect<Equal<UnshieldedSecretKey['kind'], Signing.SignatureKind>>;
  });

  it('declares them with the data the API speaks', () => {
    type _1 = Expect<Equal<UnshieldedWalletTypes.PublicKey, PublicKey>>;
    type _2 = Expect<Equal<UnshieldedWalletTypes.UnshieldedKeystore, UnshieldedKeystore>>;
    type _3 = Expect<Equal<UnshieldedWalletTypes.UnshieldedSecretKey, UnshieldedSecretKey>>;
  });
});

describe("each variant's keystore", () => {
  // The two ledger versions disagree about what a key is: ledger-v8's is a bare hex string, ledger-v9's a record naming
  // its signature scheme. Each variant keeps the keystore that speaks its own ledger version's keys.
  it('is exported by that variant, as each variant exports the rest of its ledger-bound code', () => {
    expect(V1).toHaveProperty('createKeystore');
    expect(V2).toHaveProperty('createKeystore');
  });

  it("speaks that variant's ledger version's keys", () => {
    type _1 = Expect<Equal<V1.PublicKey['publicKey'], ledgerV8.SignatureVerifyingKey>>;
    type _2 = Expect<Equal<V2.PublicKey['publicKey'], ledgerV9.SignatureVerifyingKey>>;
  });
});
