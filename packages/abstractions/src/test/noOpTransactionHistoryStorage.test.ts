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
import { describe, it, expect } from 'vitest';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { NoOpTransactionHistoryStorage } from '../NoOpTransactionHistoryStorage.js';
import { InMemoryTransactionHistoryStorage } from '../InMemoryTransactionHistoryStorage.js';
import { CURRENT_FORMAT_VERSION, detectVersion } from '../TransactionHistoryFormat.js';
import { TransactionHistoryEntryCommonSchema } from '../TransactionHistoryStorage.js';

describe('NoOpTransactionHistoryStorage serialize', () => {
  it('should write an empty history in the current format, not a bare array', async () => {
    const serialized = await new NoOpTransactionHistoryStorage().serialize();

    expect(JSON.parse(serialized)).toEqual({ version: CURRENT_FORMAT_VERSION, entries: [] });
  });

  it('should write a payload that is detected as the current format', async () => {
    const serialized = await new NoOpTransactionHistoryStorage().serialize();

    expect(detectVersion(JSON.parse(serialized))._tag).toBe('v2');
  });

  it('should write a payload a real storage can restore', async () => {
    const serialized = await new NoOpTransactionHistoryStorage().serialize();

    const restored = EitherOps.getOrThrowLeft(
      InMemoryTransactionHistoryStorage.restore(serialized, TransactionHistoryEntryCommonSchema),
    );

    expect(await restored.getAll()).toEqual([]);
  });
});
