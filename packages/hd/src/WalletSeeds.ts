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
 * The one seed an application holds, and the three the wallets are started from.
 *
 * @remarks
 *   A Midnight wallet is three wallets, and each is started from its own seed derived from one master seed at its own
 *   place in the BIP32 tree. Everything needed to walk that tree has always been here — {@link HDWallet}, {@link Roles} —
 *   but the walk itself was left to callers, and every caller wrote it out again: select account zero, select the role,
 *   derive at index zero, wipe the tree. Naming it once is what this is.
 */
import { HDWallet } from './HDWallet.js';
import { type Role, Roles } from './HDWallet.js';

/**
 * The seeds the three wallets are started from.
 *
 * @remarks
 *   Plain bytes, and deliberately so: a seed is the only key material that crosses a protocol boundary, because each
 *   ledger version derives its own keys from it. Anything more specific would be a key object, which belongs to one
 *   ledger version and cannot cross.
 */
export type WalletSeeds = Readonly<{
  /** The seed the shielded wallet derives its Zswap secret keys from. */
  shielded: Uint8Array;
  /** The seed the unshielded wallet's signing key is made from. */
  unshielded: Uint8Array;
  /** The seed the Dust wallet derives its secret key from. */
  dust: Uint8Array;
}>;

/** How the three seeds are placed in the tree, for a caller that wants somewhere other than the first address. */
export type WalletSeedsOptions = Readonly<{
  /** The account to derive within. Defaults to the first. */
  account?: number;
  /** The address index within each role. Defaults to the first. */
  addressIndex?: number;
  /**
   * Which role the unshielded seed comes from.
   *
   * @remarks
   *   The unshielded wallet can sign with either of two schemes, and they are different keys at different places in the
   *   tree. Defaults to {@link Roles.NightExternal}, which is the scheme that works on both sides of the protocol
   *   boundary; {@link Roles.EcdsaUnshielded} is only available from ledger-v9 onwards.
   */
  unshieldedRole?: Role;
}>;

/** Raised when a master seed cannot be walked down to the three per-wallet seeds. */
export class SeedDerivationError extends Error {
  override readonly name = 'SeedDerivationError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * The seeds an application starts its three wallets from.
 *
 * @remarks
 *   Throws rather than returning a result, because this sits at the boundary an application calls directly and its
 *   failures are programming errors rather than ordinary states: a master seed BIP32 rejects, or an index outside the
 *   tree. {@link HDWallet} remains available for a caller that would rather branch on a tagged result than catch.
 */
export const WalletSeeds = {
  /**
   * Derives the three wallets' seeds from one master seed.
   *
   * @remarks
   *   The master seed itself is never retained: the BIP32 tree's private material is wiped before this returns, and the
   *   bytes the caller passed in remain the caller's own. As everywhere in this SDK, "cleared" means the SDK stops
   *   holding a reference — neither JavaScript nor WebAssembly offers a way to guarantee the bytes are gone from
   *   memory, and no wallet in any language running on a general-purpose runtime can promise otherwise.
   * @example
   *   ```typescript
   *   const seeds = WalletSeeds.fromMasterSeed(masterSeed);
   *   await facade.start(seeds);
   *   ```;
   *
   * @param masterSeed The master seed, as bytes.
   * @param options Where in the tree to derive from, and which signing scheme the unshielded wallet will use.
   * @returns The three per-wallet seeds. See {@link WalletSeeds}.
   * @throws {@link SeedDerivationError} When the master seed cannot be read, or the account or index falls outside the
   *   tree.
   */
  fromMasterSeed: (masterSeed: Uint8Array, options: WalletSeedsOptions = {}): WalletSeeds => {
    const { account = 0, addressIndex = 0, unshieldedRole = Roles.NightExternal } = options;

    const opened = HDWallet.fromSeed(masterSeed);
    if (opened.type !== 'seedOk') {
      throw new SeedDerivationError(
        'This master seed is not one a BIP32 tree can be built from, so no wallet seed can be derived from it.',
        { cause: opened.error },
      );
    }

    const derived = opened.hdWallet
      .selectAccount(account)
      .selectRoles([Roles.Zswap, unshieldedRole, Roles.Dust])
      .deriveKeysAt(addressIndex);

    // Wiped whether or not the derivation succeeded: a failed walk is no reason to leave the tree open.
    opened.hdWallet.clear();

    if (derived.type !== 'keysDerived') {
      throw new SeedDerivationError(
        `No key exists at account ${account}, address index ${addressIndex} for ${derived.roles.length === 1 ? 'role' : 'roles'} ` +
          `${derived.roles.join(', ')}: a BIP32 account, role and index are each whole numbers below 2^31.`,
      );
    }

    return {
      shielded: derived.keys[Roles.Zswap],
      unshielded: derived.keys[unshieldedRole],
      dust: derived.keys[Roles.Dust],
    };
  },
};
