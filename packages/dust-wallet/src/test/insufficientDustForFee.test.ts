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

describe('InsufficientDustForFeeError', () => {
  // A first-time registration can fall short on either variant, and what it reports is plain data on both. So the error
  // is one class, declared with the data the API speaks, and a caller catches it with `instanceof` against the package
  // root's export whichever variant was running.
  it('is one class whichever variant raises it', () => {
    expect(V1.WalletError.InsufficientDustForFeeError).toBe(V2.WalletError.InsufficientDustForFeeError);
  });

  it("is the package root's export, declared with the data the API speaks", () => {
    expect(Root).toHaveProperty('InsufficientDustForFeeError');
    expect(V2.WalletError.InsufficientDustForFeeError).toBe(Root.DustWalletTypes.InsufficientDustForFeeError);
  });
});
