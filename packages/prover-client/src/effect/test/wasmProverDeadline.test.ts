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
/**
 * Whether the in-process prover gives up on a check or a proof within its ten-minute deadline when the circuit's key
 * material never arrives, as it does when its worker stalls.
 */
import type { KeyMaterialProvider } from '@midnightntwrk/zkir-v2';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as WasmProver from '../WasmProver.js';

const tenMinutes = 10 * 60 * 1_000;

/** Key material that never arrives, as from a download that stalls without failing. */
const stalledKeyMaterial: KeyMaterialProvider = {
  lookupKey: () => new Promise(() => undefined),
  getParams: () => new Promise(() => undefined),
};

/**
 * Starts watching a promise, and returns how to ask what has become of it so far: its error message if it was refused,
 * or that it is still pending.
 */
const watch = (promise: Promise<unknown>): (() => Promise<string>) => {
  const outcome = promise.then(
    () => 'resolved',
    (error: Error) => `refused: ${error.message}`,
  );
  return () => Promise.race([outcome, Promise.resolve('still pending')]);
};

describe('the bundled in-process prover, when key material never arrives', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['check', 'prove'] as const)(
    'should refuse a %s once the ten-minute deadline passes, so a stalled key download cannot hang it',
    async (op) => {
      const provider = Effect.runSync(
        WasmProver.create({ keyMaterialProvider: stalledKeyMaterial }),
      ).asProvingProvider();
      const outcomeSoFar = watch(
        op === 'check'
          ? provider.check(new Uint8Array(), 'midnight/zswap/output')
          : provider.prove(new Uint8Array(), 'midnight/zswap/output'),
      );

      await vi.advanceTimersByTimeAsync(tenMinutes);

      expect(await outcomeSoFar()).toBe(`refused: ${op} action timed out`);
    },
  );
});
