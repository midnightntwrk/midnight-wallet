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
import { describe, expect, it } from 'vitest';
import * as Root from '../index.js';
import * as V1 from '../v1/index.js';
import * as V2 from '../v2/index.js';

describe("each variant's entry point", () => {
  // The wallet API and `CustomDustWallet`, which composes the V2 variant over ledger-v9, sit above the variants. An entry
  // point that re-exported them would hand `/v1` a ledger-v9 wallet.
  it('exports its own variant, and leaves the wallet above the variants to the package root', () => {
    expect(Root).toHaveProperty('CustomDustWallet');
    expect(Root).toHaveProperty('DustWalletState');
    expect(Root).toHaveProperty('claimableFeePayment');

    expect(V1).not.toHaveProperty('CustomDustWallet');
    expect(V1).not.toHaveProperty('DustWalletState');
    expect(V1).not.toHaveProperty('claimableFeePayment');

    expect(V2).not.toHaveProperty('CustomDustWallet');
    expect(V2).not.toHaveProperty('DustWalletState');
    expect(V2).not.toHaveProperty('claimableFeePayment');
  });
});
