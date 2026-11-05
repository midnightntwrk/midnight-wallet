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
// A step below forks.v9 rejects with the ManualSyncUnsupportedError itself, so a caller can recognise it with
// instanceof — or with the guard, the way isInsufficientDustForFeeError recognises the other error a caller handles.
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { ManualSyncUnsupportedError, isManualSyncUnsupportedError } from '../src/index.js';
import * as V2WalletError from '../src/v2/WalletError.js';

const refusal = (): ManualSyncUnsupportedError =>
  new ManualSyncUnsupportedError({
    message: 'This dust wallet is below forks.v9, where it cannot be synchronized by hand.',
    protocolVersion: ProtocolVersion.ProtocolVersion(5n),
  });

const rejectionOf = (effect: Effect.Effect<never, unknown>): Promise<unknown> =>
  Effect.runPromise(effect).then(
    () => undefined,
    (error: unknown) => error,
  );

describe('isManualSyncUnsupportedError', () => {
  it('recognises the refusal a step below forks.v9 rejects with', () => {
    expect(isManualSyncUnsupportedError(refusal())).toBe(true);
  });

  it('refuses other wallet errors, plain errors and non-errors', () => {
    expect(isManualSyncUnsupportedError(new V2WalletError.OtherWalletError({ message: 'other' }))).toBe(false);
    expect(isManualSyncUnsupportedError(new Error(refusal().message))).toBe(false);
    expect(isManualSyncUnsupportedError(undefined)).toBe(false);
    expect(isManualSyncUnsupportedError({ _tag: refusal()._tag })).toBe(false);
  });

  it('refuses the fiber wrapper Effect.runPromise puts around the error', async () => {
    const wrapped = await rejectionOf(Effect.fail(refusal()));

    expect(isManualSyncUnsupportedError(wrapped)).toBe(false);
  });
});
