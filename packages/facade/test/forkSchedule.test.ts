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

/** The facade asks for the fork schedule in the shape the wallets do, and for nothing the wallets no longer take. */
import { type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, it } from 'vitest';
import { type DefaultConfiguration } from '../src/index.js';

describe('DefaultConfiguration', () => {
  it('states where each ledger version begins as `forks`, one key per ledger version after the first', () => {
    type _1 = Expect<Equal<DefaultConfiguration['forks'], ProtocolVersion.ForkSchedule>>;
  });

  it('no longer takes a single fork version', () => {
    type _1 = Expect<Equal<'forkVersion' extends keyof DefaultConfiguration ? true : false, false>>;
  });
});
