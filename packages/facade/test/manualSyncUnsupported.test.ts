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
 * Recognising the facade's manual sync refusal from the facade alone.
 *
 * @remarks
 *   `start` with `manualSync`, and `doSync`, reject with `ManualSyncUnsupportedError` while the dust wallet is below
 *   `forks.v9`. A caller depending on the facade alone has to be able to recognise it without importing the dust wallet
 *   package, so the facade exports the error and its guard — the dust wallet's own, not lookalikes, so that
 *   `instanceof` and the guard agree with what is actually thrown.
 */

import * as DustWallet from '@midnightntwrk/wallet-sdk-dust-wallet';
import { describe, expect, it } from 'vitest';
import * as Facade from '../src/index.js';

describe('the manual sync refusal, named from the facade', () => {
  it('should be the dust wallet’s own error and guard, so both recognise what start and doSync reject with', () => {
    expect(Facade.ManualSyncUnsupportedError).toBe(DustWallet.ManualSyncUnsupportedError);
    expect(Facade.isManualSyncUnsupportedError).toBeTypeOf('function');
    expect(Facade.isManualSyncUnsupportedError).toBe(DustWallet.isManualSyncUnsupportedError);
  });
});
