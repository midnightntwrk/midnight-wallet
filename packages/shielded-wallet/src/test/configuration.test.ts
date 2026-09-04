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
import { type NetworkId, type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { type Duration } from 'effect';
import { describe, it } from 'vitest';
import { type DefaultShieldedConfiguration } from '../ShieldedWallet.js';
import { type DefaultV1Configuration } from '../v1/index.js';
import {
  type DefaultV2Configuration,
  type Sync as V2Sync,
  type TransactionHistory as V2TransactionHistory,
} from '../v2/index.js';

describe('DefaultShieldedConfiguration', () => {
  it('is a configuration the package declares itself, not the head variant s', () => {
    type _1 = Expect<
      Equal<
        DefaultShieldedConfiguration,
        {
          networkId: NetworkId.NetworkId;
          indexerClientConnection: V2Sync.IndexerClientConnection;
          batchUpdates?: V2Sync.BatchUpdatesConfig;
          txHistoryStorage: V2TransactionHistory.ShieldedHistoryStorage;
          transactionDetailsRetryWindow?: Duration.DurationInput;
          forkVersion: ProtocolVersion.ProtocolVersion;
          chainVersionProbe?: ChainVersionProbe;
        }
      >
    >;
  });

  it('builds either variant, being a superset of what each is built from', () => {
    // One direction only, and deliberately so. The wallet's configuration now says something no single
    // variant does — where the boundary between them lies — so it is strictly larger than either
    // variant's. What must keep holding is that it can still build both: a variant asking for something
    // this type does not carry would be a wallet that cannot be built for one of its own variants.
    type _1 = Expect<CanAssign<DefaultShieldedConfiguration, DefaultV2Configuration>>;
    type _2 = Expect<CanAssign<DefaultShieldedConfiguration, DefaultV1Configuration>>;

    // `forkVersion` is the wallet layer's alone: neither variant knows there is another one.
    type _3 = Expect<Equal<'forkVersion' extends keyof DefaultV1Configuration ? true : false, false>>;
    type _4 = Expect<Equal<'forkVersion' extends keyof DefaultV2Configuration ? true : false, false>>;

    // And so is the question of where to start, for the same reason: a variant that does not know there is another
    // one has no use for the answer.
    type _5 = Expect<Equal<'chainVersionProbe' extends keyof DefaultV1Configuration ? true : false, false>>;
    type _6 = Expect<Equal<'chainVersionProbe' extends keyof DefaultV2Configuration ? true : false, false>>;
  });
});
