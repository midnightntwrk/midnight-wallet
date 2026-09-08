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
 * Where the boundary between the two variants lies is configured as `forks.v9`, not as a single fork version.
 *
 * @remarks
 *   A map keyed by ledger version, so the next hard fork adds a key rather than changing the configuration's shape. What
 *   is pinned here is the one thing the map decides today: below `forks.v9` the ledger-v8 variant owns the chain, from
 *   it the ledger-v9 variant does.
 */
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Variant } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { type DefaultDustConfiguration } from '../DustWalletAPI.js';
import { DustWallet } from '../DustWallet.js';
import { V1Tag } from '../v1/index.js';
import { TransactionHistory, V2Tag } from '../v2/index.js';

const v9 = ProtocolVersion.ProtocolVersion(7n);

const configuration: DefaultDustConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.DustTransactionHistoryEntrySchema),
  costParameters: { feeBlocksMargin: 0 },
  forks: { v9 },
};

describe('DustWallet forks', () => {
  it('hands the chain to the ledger-v9 variant from forks.v9, and leaves everything below it to ledger-v8', () => {
    const Wallet = DustWallet(configuration);
    const tagAt = (version: bigint) =>
      Variant.getVersionedVariantTag(Option.getOrThrow(Wallet.variantFor(ProtocolVersion.ProtocolVersion(version))));

    expect(tagAt(0n)).toBe(V1Tag);
    expect(tagAt(6n)).toBe(V1Tag);
    expect(tagAt(7n)).toBe(V2Tag);
    expect(tagAt(2_000_000n)).toBe(V2Tag);
  });
});
