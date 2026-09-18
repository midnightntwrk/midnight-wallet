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

// Reference for the "Per-wallet seeds" section of the specification: the walk from one master seed down to the seed
// each of the three wallets is generated from. Everything else in this package takes such a seed as given.
//
// BIP-32 itself is delegated to @scure/bip32, exactly as the specification delegates it to BIP-32: what is stated here
// is the wallet-specific part, which is the path and which role each seed comes from.

import { HDKey } from '@scure/bip32';

/** Path components the specification fixes for every Midnight wallet. */
export const PURPOSE = 44;
export const COIN_TYPE = 2400;

/** The role level of the path. Which role each seed comes from is the whole of this reference. */
export const Roles = {
  UnshieldedExternal: 0,
  UnshieldedInternal: 1,
  Dust: 2,
  Shielded: 3,
  /**
   * The role an unshielded seed comes from when the wallet signs with ECDSA rather than the scheme role 0 is used with,
   * so the secret scalar is never shared between two algorithms.
   */
  EcdsaUnshielded: 4,
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

/** Where the three seeds an application holds sit, for a wallet that has a reason not to use the first address. */
export type WalletSeedsOptions = {
  account?: number;
  index?: number;
  /** Which role the unshielded seed comes from — role 0 unless the wallet signs with a different scheme. */
  unshieldedRole?: Role;
};

/** The three seeds every other derivation in this package takes as its input. */
export type WalletSeeds = {
  unshielded: Buffer;
  dust: Buffer;
  shielded: Buffer;
};

/** `m / purpose' / coin_type' / account' / role / index`, written the way BIP-32 writes it. */
export function derivationPath(account: number, role: Role, index: number): string {
  return `m/${PURPOSE}'/${COIN_TYPE}'/${account}'/${role}/${index}`;
}

/**
 * The private key at a path, which is what the specification means by a seed.
 *
 * The 32 bytes of the key itself, and not an extended key: chain code and depth belong to the derivation rather than to
 * what the seed is used for.
 */
export function seedAt(masterSeed: Buffer, path: string): Buffer {
  const derived = HDKey.fromMasterSeed(masterSeed).derive(path);
  if (derived.privateKey === null) {
    throw new Error(`No private key exists at ${path}`);
  }
  return Buffer.from(derived.privateKey);
}

/** The walk from one master seed down to the seed each of the three wallets is generated from. */
export function walletSeeds(masterSeed: Buffer, options: WalletSeedsOptions = {}): WalletSeeds {
  const { account = 0, index = 0, unshieldedRole = Roles.UnshieldedExternal } = options;
  return {
    unshielded: seedAt(masterSeed, derivationPath(account, unshieldedRole, index)),
    dust: seedAt(masterSeed, derivationPath(account, Roles.Dust, index)),
    shielded: seedAt(masterSeed, derivationPath(account, Roles.Shielded, index)),
  };
}
