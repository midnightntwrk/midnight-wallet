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
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId as Networks,
  ProtocolVersion,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { type Duration, Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { asV8DustParameters, type CustomForkingDustWallet, DustWallet } from '../DustWallet.js';
import { type DefaultDustConfiguration } from '../DustWalletAPI.js';
import { type DustGenerationRates } from '../index.js';
import { CoreWallet as V1CoreWallet } from '../v1/CoreWallet.js';
import { type WalletSyncUpdate as V1SyncUpdate } from '../v1/Sync.js';
import { type DefaultV1Configuration } from '../v1/V1Builder.js';
import { TransactionHistory as V2TransactionHistory, V2Tag } from '../v2/index.js';
import { type NetworkId, type TotalCostParameters } from '../v2/types/index.js';
import { type WalletSyncUpdate as V2SyncUpdate } from '../v2/SyncSchema.js';
import { type DefaultV2Configuration } from '../v2/V2Builder.js';

describe('DefaultDustConfiguration', () => {
  it('is a configuration the package declares itself, not the head variant s', () => {
    type _1 = Expect<
      Equal<
        DefaultDustConfiguration,
        {
          networkId: NetworkId;
          costParameters: TotalCostParameters;
          dustParameters?: DustGenerationRates;
          txHistoryStorage: V2TransactionHistory.DustHistoryStorage;
          indexerClientConnection: { indexerHttpUrl: string };
          transactionDetailsRetryWindow?: Duration.DurationInput;
          forks: ProtocolVersion.ForkSchedule;
          chainVersionProbe?: ChainVersionProbe;
          skipLedgerV8DustHistory?: boolean;
        }
      >
    >;
  });

  it("builds either variant from everything but its dust rates, which become each ledger version's own parameters", () => {
    // One direction only, and deliberately so. The wallet's configuration now says something no single variant does —
    // where the boundary between them lies — so it is strictly larger than either variant's. What must keep holding is
    // that it can still build both: a variant asking for something this type does not carry would be a wallet that
    // cannot be built for one of its own variants.
    //
    // `dustParameters` is the one field not handed over as it is. The wallet is configured with plain rates, and each
    // variant is built with its own ledger version's `DustParameters` made from them: a ledger object belongs to the
    // WASM module that made it, so not even a structurally identical one could be shared.
    type WithoutRates = Omit<DefaultDustConfiguration, 'dustParameters'>;
    type _1 = Expect<CanAssign<WithoutRates, DefaultV2Configuration>>;
    type _2 = Expect<CanAssign<WithoutRates, DefaultV1Configuration>>;

    // Either ledger version's own parameters still configure the rates, so a caller already holding one can go on
    // passing it.
    type _7 = Expect<CanAssign<ledgerV9.DustParameters, DustGenerationRates>>;
    type _8 = Expect<CanAssign<ledgerV8.DustParameters, DustGenerationRates>>;

    // `forks` is the wallet layer's alone: neither variant knows there is another one.
    type _3 = Expect<Equal<'forks' extends keyof DefaultV1Configuration ? true : false, false>>;
    type _4 = Expect<Equal<'forks' extends keyof DefaultV2Configuration ? true : false, false>>;

    // And so is the question of where to start, for the same reason: a variant that does not know there is another
    // one has no use for the answer.
    type _5 = Expect<Equal<'chainVersionProbe' extends keyof DefaultV1Configuration ? true : false, false>>;
    type _6 = Expect<Equal<'chainVersionProbe' extends keyof DefaultV2Configuration ? true : false, false>>;
  });
});

describe('CustomForkingDustWallet', () => {
  it('composes a V2 variant built from a configuration of its own, which need not state dust parameters', () => {
    // A builder implementing `VariantBuilder` is configured with whatever it asks for, and may build its cross-ledger
    // migration on dust parameters it supplies itself; the wallet layer only hands each builder its configuration.
    type _1 = typeof CustomForkingDustWallet<V1SyncUpdate, V2SyncUpdate, object, { endpoint: string }>;
  });
});

describe('DustWallet configured with dust rates', () => {
  const networkId = Networks.NetworkId.Undeployed;
  const v9 = ProtocolVersion.ProtocolVersion(7n);

  it('values a wallet crossing forks.v9 against rates configured as plain numbers, so configuring them imports no ledger', async () => {
    // Deliberately not the ledger's initial parameters, so a wallet that fell back to those is told apart.
    const rates: DustGenerationRates = {
      nightDustRatio: 4_000_000_000n,
      generationDecayRate: 9_000n,
      dustGracePeriodSeconds: 7_200n,
    };
    const Wallet = DustWallet({
      networkId,
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(V2TransactionHistory.DustTransactionHistoryEntrySchema),
      costParameters: { feeBlocksMargin: 0 },
      forks: { v9 },
      dustParameters: rates,
    });
    // The variant registered at forks.v9, which a wallet below the boundary hands over to.
    const { variant } = Wallet.allVariantsRecord()[V2Tag];
    const belowBoundary = V1CoreWallet.initEmpty(
      asV8DustParameters(rates),
      ledgerV8.DustSecretKey.fromSeed(Buffer.alloc(32, 1)),
      networkId,
    );

    const crossed = await Effect.runPromise(variant.migrateState(belowBoundary));

    const { nightDustRatio, generationDecayRate, dustGracePeriodSeconds } = crossed.state.params;
    expect(crossed.state.params).toBeInstanceOf(ledgerV9.DustParameters);
    expect({ nightDustRatio, generationDecayRate, dustGracePeriodSeconds }).toEqual(rates);
  });
});
