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
 * What the SDK's own token-type constants are worth: that an application which stops calling a ledger for them reads
 * exactly the same balances afterwards.
 *
 * @remarks
 *   The constants are string literals so they can reach the umbrella package's root without loading either ledger's
 *   WebAssembly. That is only safe while the literals agree with both ledger versions, which is what this pins — on
 *   both, because a constant that were right on one side of the protocol boundary and wrong on the other would be worse
 *   than no constant at all.
 */
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';

describe('the Night token type the SDK names', () => {
  it('is what the pre-fork ledger version calls the native token', () => {
    expect(sdk.Token.night).toBe(ledgerV8.nativeToken().raw);
  });

  it('is what the post-fork ledger version calls the native token', () => {
    expect(sdk.Token.night).toBe(ledgerV9.nativeToken().raw);
  });

  it('is the same raw type on both, which is why one constant can serve both epochs', () => {
    expect(ledgerV8.nativeToken().raw).toBe(ledgerV9.nativeToken().raw);
  });

  it('is also what both call the shielded and unshielded token, because the raw form carries no tag', () => {
    // The ledger distinguishes them with the `tag` on its wrapper, not with the raw type. A balance record is keyed
    // by the raw type alone, so there is exactly one constant to name here — recorded so that a future ledger which
    // separates them is caught by this test rather than by an application.
    expect(ledgerV8.shieldedToken().raw).toBe(sdk.Token.night);
    expect(ledgerV8.unshieldedToken().raw).toBe(sdk.Token.night);
    expect(ledgerV9.shieldedToken().raw).toBe(sdk.Token.night);
    expect(ledgerV9.unshieldedToken().raw).toBe(sdk.Token.night);
  });

  it('reads as a token type through the parser the SDK offers', () => {
    expect(sdk.parseTokenType(ledgerV9.nativeToken().raw)._tag).toBe('Right');
  });
});
