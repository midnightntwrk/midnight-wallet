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
 * Which wallets a facade can be handed, decided by the keys it starts them with.
 *
 * @remarks
 *   The facade starts every shielded and dust wallet with one ledger version's keys per side of the boundary, and each
 *   wallet declares the keys it needs. Whether a wallet fits is therefore answered by the compiler at
 *   `WalletFacade.init`, never asked of the wallet at run time: a wallet those keys can start is accepted, and one that
 *   needs keys the facade does not derive is refused there.
 */

import type * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  type CustomizedDustWallet,
  type DustKeysByEpoch,
  type DustWallet,
  type DustWalletAPI,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import {
  type CustomizedShieldedWallet,
  type ShieldedKeysByEpoch,
  type ShieldedWallet,
  type ShieldedWalletAPI,
} from '@midnightntwrk/wallet-sdk-shielded';
import { type CanAssign, type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { describe, it } from 'vitest';
import { type DefaultConfiguration, type InitParams } from '../src/index.js';

/** What a facade takes from its `shielded` factory. */
type ShieldedSlot = Awaited<ReturnType<InitParams<DefaultConfiguration>['shielded']>>;
/** What a facade takes from its `dust` factory. */
type DustSlot = Awaited<ReturnType<InitParams<DefaultConfiguration>['dust']>>;

/** The shipped wallets spanning the boundary, as their class-level start builds them. */
type ForkingShielded = Awaited<ReturnType<ReturnType<typeof ShieldedWallet>['startWithSeed']>>;
type ForkingDust = Awaited<ReturnType<ReturnType<typeof DustWallet>['startWithSeed']>>;

/** Key objects of a ledger version the SDK does not run, standing for the one a later fork adds. */
type LaterLedgerKeys = Readonly<{ ledgerVersion: 'later' }>;

describe('the wallets a facade can be handed', () => {
  it('should accept the shipped forking and single-variant wallets, because the keys it derives start both', () => {
    type _1 = Expect<CanAssign<ForkingShielded, ShieldedSlot>>;
    type _2 = Expect<CanAssign<CustomizedShieldedWallet, ShieldedSlot>>;
    type _3 = Expect<CanAssign<ForkingDust, DustSlot>>;
    type _4 = Expect<CanAssign<CustomizedDustWallet, DustSlot>>;
  });

  it('should refuse a wallet that also needs keys of a later ledger version, because the facade does not derive them', () => {
    // The case that decides how `start` is declared. These keys fit the facade's in one direction only, which a
    // method's parameter accepts and a function-typed property does not: declared as a method, a wallet like this
    // would be handed keys without the side it reads with.
    type _1 = Expect<
      Equal<CanAssign<ShieldedWalletAPI<ShieldedKeysByEpoch & Readonly<{ v10: LaterLedgerKeys }>>, ShieldedSlot>, false>
    >;
    type _2 = Expect<
      Equal<CanAssign<DustWalletAPI<DustKeysByEpoch & Readonly<{ v10: LaterLedgerKeys }>>, DustSlot>, false>
    >;
  });

  it('should refuse a wallet started from a single ledger-v9 key, because the facade hands every wallet its keys by ledger version', () => {
    type _1 = Expect<Equal<CanAssign<ShieldedWalletAPI<ledgerV9.ZswapSecretKeys>, ShieldedSlot>, false>>;
    type _2 = Expect<Equal<CanAssign<DustWalletAPI<ledgerV9.DustSecretKey>, DustSlot>, false>>;
  });
});
