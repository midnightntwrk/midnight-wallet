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
 * The types an application names when it talks to a wallet: the coins it reads, the transfers it asks for, the signer
 * it hands over. Each wallet declares them once, in no ledger version's terms, so an application reaches them from the
 * package root and never from a variant's `/v1` or `/v2` subpath. Two wallets can declare the same name — each has a
 * `TokenTransfer` of its own — so each wallet's arrive under that wallet's name, and one barrel holds all three.
 */
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';

describe('the types a wallet speaks', () => {
  it("name the shielded wallet's coins and transfers as its API uses them", () => {
    type _1 = Expect<Equal<sdk.ShieldedWalletTypes.AvailableCoin, sdk.ShieldedWalletState['availableCoins'][number]>>;
    type _2 = Expect<Equal<sdk.ShieldedWalletTypes.PendingCoin, sdk.ShieldedWalletState['pendingCoins'][number]>>;
    type _3 = Expect<Equal<sdk.ShieldedWalletTypes.ReservedCoin, sdk.ShieldedWalletState['reservedCoins'][number]>>;
    type _4 = Expect<
      Equal<sdk.ShieldedWalletTypes.TokenTransfer, Parameters<sdk.ShieldedWalletAPI['transferTransaction']>[0][number]>
    >;
  });

  it("name the unshielded wallet's UTxOs, transfers and signer as its API uses them", () => {
    type _1 = Expect<
      Equal<sdk.UnshieldedWalletTypes.UtxoWithMeta, sdk.UnshieldedWalletState['availableCoins'][number]>
    >;
    type _2 = Expect<
      Equal<
        sdk.UnshieldedWalletTypes.TokenTransfer,
        Parameters<sdk.UnshieldedWalletAPI['transferTransaction']>[0][number]
      >
    >;
    type _3 = Expect<
      Equal<sdk.UnshieldedWalletTypes.SignSegment, Parameters<sdk.UnshieldedWalletAPI['signUnprovenTransaction']>[1]>
    >;
  });

  it("name the dust wallet's dust and the Night UTxOs that generate it as its API uses them", () => {
    type _1 = Expect<Equal<sdk.DustWalletTypes.DustFullInfo, sdk.DustWalletState['availableCoins'][number]>>;
    type _2 = Expect<
      Equal<
        sdk.DustWalletTypes.UtxoWithMeta,
        Parameters<sdk.DustWalletAPI['splitNightUtxosForDustRegistration']>[1][number]
      >
    >;
    type _3 = Expect<
      Equal<
        sdk.DustWalletTypes.NightUtxoSplitForDustRegistration,
        Awaited<ReturnType<sdk.DustWalletAPI['splitNightUtxosForDustRegistration']>>
      >
    >;
  });

  it('carry the same history schemas the package roots export', () => {
    expect(sdk).toHaveProperty('ShieldedWalletTypes.ShieldedSectionSchema', sdk.ShieldedSectionSchema);
    expect(sdk).toHaveProperty('UnshieldedWalletTypes.UnshieldedSectionSchema', sdk.UnshieldedSectionSchema);
    expect(sdk).toHaveProperty('DustWalletTypes.DustSectionSchema', sdk.DustSectionSchema);
  });
});
