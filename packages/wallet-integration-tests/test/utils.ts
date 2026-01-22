// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import type * as ledger from '@midnight-ntwrk/ledger-v7';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';

/**
 * Temporary function until the ledger fixes imbalances.get()
 *
 * @param imbalances
 * @param rawTokenType
 * @returns bigint
 */
export const getNonDustImbalance = (
  imbalances: Map<ledger.TokenType, bigint>,
  rawTokenType: ledger.RawTokenType,
): bigint => {
  const [, value] = Array.from(imbalances.entries()).find(([t, value]) =>
    t.tag !== 'dust' && t.raw == rawTokenType ? value : undefined,
  ) ?? [undefined, BigInt(0)];

  return value;
};

export const getShieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return Buffer.from(derivationResult.key);
};
