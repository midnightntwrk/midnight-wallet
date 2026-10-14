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
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { runPromiseThrowingFailure } from '../PromiseBoundary.js';
import { InsufficientFundsError } from '../v2/WalletError.js';

describe('runPromiseThrowingFailure', () => {
  it('resolves with the effect value on success', async () => {
    await expect(runPromiseThrowingFailure(Effect.succeed(42))).resolves.toBe(42);
  });

  it('rejects with the typed failure itself, not an Effect FiberFailure', async () => {
    const original = new InsufficientFundsError({
      message: 'Insufficient funds',
      tokenType: 'abc',
    });
    const error = await runPromiseThrowingFailure(Effect.fail(original)).catch((e: unknown) => e);
    // The same object: instanceof, the tag and the fields all survive the Promise boundary, which is what a
    // Promise-API consumer needs to tell which wallet error happened (issue #812).
    expect(error).toBe(original);
    expect(error).toBeInstanceOf(InsufficientFundsError);
    expect((error as InsufficientFundsError)._tag).toBe('Wallet.InsufficientFunds');
    expect((error as InsufficientFundsError).tokenType).toBe('abc');
    expect((error as Error).name).not.toContain('FiberFailure');
  });

  it('rejects a defect with an Error carrying the defect as its cause, not a FiberFailure', async () => {
    const defect = new Error('boom');
    const error = await runPromiseThrowingFailure(Effect.die(defect)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).not.toContain('FiberFailure');
    expect((error as Error).cause).toBe(defect);
    expect((error as Error).message).toContain('boom');
  });
});
