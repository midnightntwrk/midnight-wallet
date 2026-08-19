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
import { type NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, it } from 'vitest';
import { type DefaultUnshieldedConfiguration } from '../UnshieldedWallet.js';
import { type DefaultV1Configuration } from '../v1/index.js';
import {
  type DefaultV2Configuration,
  type Sync as V2Sync,
  type TransactionHistory as V2TransactionHistory,
} from '../v2/index.js';

describe('DefaultUnshieldedConfiguration', () => {
  it('is a configuration the package declares itself, not the head variant s', () => {
    type _1 = Expect<
      Equal<
        DefaultUnshieldedConfiguration,
        {
          networkId: NetworkId.NetworkId;
          indexerClientConnection: V2Sync.IndexerClientConnection;
          txHistoryStorage: V2TransactionHistory.UnshieldedHistoryStorage;
        }
      >
    >;
  });

  it('stays interchangeable with what either variant is built from', () => {
    type _1 = Expect<CanAssign<DefaultUnshieldedConfiguration, DefaultV2Configuration>>;
    type _2 = Expect<CanAssign<DefaultV2Configuration, DefaultUnshieldedConfiguration>>;
    type _3 = Expect<CanAssign<DefaultUnshieldedConfiguration, DefaultV1Configuration>>;
    type _4 = Expect<CanAssign<DefaultV1Configuration, DefaultUnshieldedConfiguration>>;
  });
});
