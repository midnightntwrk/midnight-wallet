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
 * The adapter's own behaviour, against the real WASM translation.
 *
 * **Integration tier, and not for want of trying:** the import is static, so these need `wasm/pkg/` to exist. `turbo`
 * builds it first via this package's `artifacts` task. There is nothing left to stub — the module is a fixed import, so
 * a unit test here could only test the WASM itself.
 *
 * What this file covers is the seam between the WASM and its callers: that bytes survive the trip, and that a refusal
 * arrives as a typed error carrying the reason. That the translation is _correct_ — that state crosses the fork intact
 * — is checked where the fork is, in `forkStateTranslation.integration.test.ts` in
 * `@midnightntwrk/wallet-sdk-capabilities`.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { describe, expect, it } from 'vitest';

import { StateTranslationFailedError, translateLedgerState } from '../index.js';

const networkId = 'undeployed';

/** A real serialized pre-fork ledger state — the only input the translation accepts. */
const preForkLedger = (): Uint8Array => v8.LedgerState.blank(networkId).serialize();

describe('translateLedgerState', () => {
  it('translates serialized pre-fork state into state the post-fork ledger accepts', async () => {
    const translated = await translateLedgerState(preForkLedger());

    expect(translated).toBeInstanceOf(Uint8Array);
    // Deserializing is the assertion: it is what says these bytes are a v9 ledger state rather than merely bytes.
    expect(v9.LedgerState.deserialize(translated)).toBeInstanceOf(v9.LedgerState);
  });

  it('reports a refused translation as a failure, keeping its cause', async () => {
    // Not a serialized ledger state, so the translation refuses it at the tagged-header check. That is the reachable
    // failure path: the module either returns bytes or throws.
    const error = await translateLedgerState(new Uint8Array([0, 1, 2])).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StateTranslationFailedError);
    expect(error).toBeInstanceOf(Error);
    // The WASM module's own error is what says why, so it must survive as the cause rather than be flattened.
    const cause = (error as StateTranslationFailedError).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('ledger-v8 LedgerState');
  });

  it('does not touch its input', async () => {
    const original = preForkLedger();
    const copy = Uint8Array.from(original);

    await translateLedgerState(original);

    expect(original).toEqual(copy);
  });
});
