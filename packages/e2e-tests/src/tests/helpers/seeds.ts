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
import { HDWallet, Roles, type Role } from '@midnightntwrk/wallet-sdk-hd';
import { type DustKeysByEpoch } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { type ShieldedKeysByEpoch } from '@midnightntwrk/wallet-sdk-shielded';

type UnshieldedSeedRole = typeof Roles.NightExternal | typeof Roles.EcdsaUnshielded;

const deriveKey = (seed: string, role: Role): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(role).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }
  hdWallet.clear();
  return derivationResult.key;
};

export const getShieldedSeed = (seed: string): Uint8Array => Buffer.from(deriveKey(seed, Roles.Zswap));

export const getUnshieldedSeed = (
  seed: string,
  role: UnshieldedSeedRole = Roles.NightExternal,
): Uint8Array<ArrayBufferLike> => deriveKey(seed, role);

export const getDustSeed = (seed: string): Uint8Array<ArrayBufferLike> => deriveKey(seed, Roles.Dust);

/**
 * One ledger version's shielded keys per side of the boundary, each derived from the seed by its own ledger version —
 * what a shielded wallet spanning the boundary is started with.
 */
export const shieldedKeysFromSeed = (seed: Uint8Array): ShieldedKeysByEpoch => ({
  v8: ledgerV8.ZswapSecretKeys.fromSeed(seed),
  v9: ledgerV9.ZswapSecretKeys.fromSeed(seed),
});

/**
 * One ledger version's dust key per side of the boundary, each derived from the seed by its own ledger version — what a
 * dust wallet spanning the boundary is started and stepped with.
 */
export const dustKeysFromSeed = (seed: Uint8Array): DustKeysByEpoch => ({
  v8: ledgerV8.DustSecretKey.fromSeed(seed),
  v9: ledgerV9.DustSecretKey.fromSeed(seed),
});
