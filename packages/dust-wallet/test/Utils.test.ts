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

import { describe, it } from '@vitest/runner';
import { expect } from 'vitest';
import { calculatePrefixLength } from '../src/v1/Utils.js';
import { LedgerOps } from '@midnight-ntwrk/wallet-sdk-utilities';

describe('Utils', () => {
  it('calculatePrefixLength()', () => {
    const maxLength = 64; // 12bdf27706a2994ad7f214d5653bb44546afe1fedadda5219c8ba4fe90f23f44
    const nullifier = LedgerOps.generateHex(maxLength);
    // 0 means no privacy, no overhead (anonymity set equals 2**0 = 1)
    // 7 means 64x overhead, as well as 64 size of the anonymity set (62 additional values expected per query)
    expect(nullifier.substring(0, calculatePrefixLength(0, 1000, maxLength)).length).toBe(10);
    expect(nullifier.substring(0, calculatePrefixLength(1, 1000, maxLength)).length).toBe(8);
    expect(nullifier.substring(0, calculatePrefixLength(2, 1000, maxLength)).length).toBe(8);
    expect(nullifier.substring(0, calculatePrefixLength(3, 1000, maxLength)).length).toBe(6);
    expect(nullifier.substring(0, calculatePrefixLength(4, 1000, maxLength)).length).toBe(6);
    expect(nullifier.substring(0, calculatePrefixLength(5, 1000, maxLength)).length).toBe(4);
    expect(nullifier.substring(0, calculatePrefixLength(6, 1000, maxLength)).length).toBe(4);
    expect(nullifier.substring(0, calculatePrefixLength(7, 1000, maxLength)).length).toBe(2);
  });
});
