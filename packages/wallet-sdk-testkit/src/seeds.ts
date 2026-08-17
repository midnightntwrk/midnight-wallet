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
import { HDWallet, Roles, type Role } from '@midnightntwrk/wallet-sdk-hd';

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

export const getUnshieldedSeed = (seed: string): Uint8Array<ArrayBufferLike> => deriveKey(seed, Roles.NightExternal);

export const getDustSeed = (seed: string): Uint8Array<ArrayBufferLike> => deriveKey(seed, Roles.Dust);
