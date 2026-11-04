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
 * Naming the type of a dust wallet that synchronizes by projections, from the package's public entry points.
 *
 * @remarks
 *   A wallet composed with `CustomForkingDustWallet` is a `ForkingDustWallet` over the update types its two variants
 *   synchronize with, and an application that annotates it — a return type, a field — has to be able to write those
 *   types down. The V1 variant's comes from `./v1`'s `SyncService`. The projections update the V2 variant applies has
 *   to come from `./v2`'s, beside the service and capability that produce and apply it, rather than be derived from a
 *   parameter of `applyUpdate`. Both assertions are on types, so what fails is the typecheck.
 */
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expectTypeOf, it } from 'vitest';
import {
  CustomForkingDustWallet,
  type DefaultDustConfiguration,
  dustVariantConfigurations,
  type ForkingDustWallet,
} from '../index.js';
import { SyncService as V1Sync, V1Builder } from '../v1/index.js';
import { SyncService as V2Sync, TransactionHistory, V2Builder } from '../v2/index.js';

const configuration: DefaultDustConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.DustTransactionHistoryEntrySchema),
  costParameters: { feeBlocksMargin: 0 },
  forks: { v9: ProtocolVersion.ProtocolVersion(2_000_000n) },
};

describe('a dust wallet that synchronizes by projections', () => {
  it('should export the update the projections capability applies, beside it in SyncService', () => {
    expectTypeOf(V2Sync.makeEventLessSyncCapability().applyUpdate)
      .parameter(1)
      .toEqualTypeOf<V2Sync.DustProjectionsUpdate>();
  });

  it('should be nameable from the public entry points, so an application can annotate the wallet it composes', () => {
    const { v1, v2, migration } = dustVariantConfigurations(configuration);
    const ProjectionsDustWallet = CustomForkingDustWallet(
      configuration,
      { builder: new V1Builder().withDefaults(), configuration: v1 },
      {
        builder: new V2Builder()
          .withDefaults()
          .withSync(V2Sync.makeEventLessSyncService, V2Sync.makeEventLessSyncCapability)
          .withStartAuxDefaults()
          .withMigration(migration),
        configuration: v2,
      },
    );

    // Assignability, which is what annotating a variable or a return type asks of it.
    expectTypeOf(ProjectionsDustWallet.restore).returns.toExtend<
      ForkingDustWallet<V1Sync.WalletSyncUpdate, V2Sync.DustProjectionsUpdate>
    >();
  });
});
