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
//
// Each variant declares its own InsufficientDustForFeeError, so which class a rejection is depends on the variant
// running when it was raised. The guard is how a caller recognises it without knowing which one that was.
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { isInsufficientDustForFeeError } from '../src/index.js';
import * as V1WalletError from '../src/v1/WalletError.js';
import * as V2WalletError from '../src/v2/WalletError.js';

const reading = {
  claimableFeePayment: 10n,
  fee: 25n,
  estimate: { _tag: 'Unreachable', reason: 'NoGeneration' },
} as const;

const rejectionOf = (effect: Effect.Effect<never, unknown>): Promise<unknown> =>
  Effect.runPromise(effect).then(
    () => undefined,
    (error: unknown) => error,
  );

describe('isInsufficientDustForFeeError', () => {
  it('recognises the error whichever variant raised it', () => {
    expect(isInsufficientDustForFeeError(V1WalletError.InsufficientDustForFeeError.of(reading))).toBe(true);
    expect(isInsufficientDustForFeeError(V2WalletError.InsufficientDustForFeeError.of(reading))).toBe(true);
  });

  it('refuses other wallet errors, plain errors and non-errors', () => {
    expect(isInsufficientDustForFeeError(new V2WalletError.OtherWalletError({ message: 'other' }))).toBe(false);
    expect(isInsufficientDustForFeeError(new Error('Insufficient generated dust to cover registration fee'))).toBe(
      false,
    );
    expect(isInsufficientDustForFeeError(undefined)).toBe(false);
    expect(isInsufficientDustForFeeError({ _tag: 'Wallet.InsufficientDustForFee' })).toBe(false);
  });

  it('refuses the fiber wrapper Effect.runPromise puts around the error', async () => {
    const wrapped = await rejectionOf(Effect.fail(V2WalletError.InsufficientDustForFeeError.of(reading)));

    expect(isInsufficientDustForFeeError(wrapped)).toBe(false);
  });
});
