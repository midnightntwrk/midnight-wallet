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
import * as ledger from '@midnightntwrk/ledger-v9';
import { tNightAmount } from './primitives.js';

export const nativeToken1Raw = '0000000000000000000000000000000000000000000000000000000000000001';
export const nativeToken2Raw = '0000000000000000000000000000000000000000000000000000000000000002';

export type StableBalance = {
  readonly label: string;
  readonly kind: 'shielded' | 'unshielded';
  readonly tokenType: string;
  readonly amount: bigint;
};

/**
 * The exact balances the stable wallet (`SEED_STABLE`) holds on every remote network. The balance-constant suite
 * asserts them and the funding script tops the wallet up to them, so both read this one table.
 */
export const STABLE_WALLET = {
  shielded: {
    label: 'shielded tNight',
    kind: 'shielded',
    tokenType: ledger.shieldedToken().raw,
    amount: tNightAmount(10n),
  },
  nativeToken1: { label: 'native token 1', kind: 'shielded', tokenType: nativeToken1Raw, amount: tNightAmount(25n) },
  nativeToken2: { label: 'native token 2', kind: 'shielded', tokenType: nativeToken2Raw, amount: tNightAmount(50n) },
  unshielded: {
    label: 'unshielded tNight',
    kind: 'unshielded',
    tokenType: ledger.unshieldedToken().raw,
    amount: tNightAmount(10n),
  },
} as const satisfies Record<string, StableBalance>;

export const STABLE_WALLET_BALANCES: readonly StableBalance[] = Object.values(STABLE_WALLET);
