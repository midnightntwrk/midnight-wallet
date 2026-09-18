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
 * The one seed an application holds, and the three the wallets need.
 *
 * @remarks
 *   Every consumer in this repository — the test kit, the end-to-end suites, the snippets — has been hand-rolling this
 *   derivation, six near-identical copies of the same walk down the same tree, each one silently discarding the failure
 *   branches. The walk is what `packages/hd` is for; naming it is what was missing.
 *
 *   The values are now pinned against a published specification rather than against themselves. The [Per-wallet
 *   seeds](../../../docs/spec/Specification.md#per-wallet-seeds) section states which role each of the three seeds
 *   comes from, the [spec reference](../../spec-reference) implements that walk independently, and
 *   `seedDerivation.json` is the vector file it generates — a byte-identical copy of
 *   `packages/spec-reference/test-vectors/seedDerivation.json`, the same arrangement `packages/address-format` uses for
 *   its own vectors. The hexadecimal below is therefore a claim about what a Midnight wallet is, not a record of what
 *   this package happened to do.
 */
import { describe, expect, it } from 'vitest';
import { HDWallet, Roles, WalletSeeds } from '../src/index.js';
import vectors from './seedDerivation.json' with { type: 'json' };

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const masterSeedOf = (vector: (typeof vectors)[number]): Buffer => Buffer.from(vector.masterSeed, 'hex');

/** The first address of the first account, which is what a wallet with no reason to choose otherwise uses. */
const firstAddress = vectors.find((vector) => vector.account === 0 && vector.addressIndex === 0);
if (firstAddress === undefined) throw new Error('the vectors no longer cover the first address');

const masterSeed = masterSeedOf(firstAddress);

/** The walk every consumer in this repository has been writing out by hand. */
const byHand = (role: (typeof Roles)[keyof typeof Roles], account = 0, index = 0): string => {
  const result = HDWallet.fromSeed(masterSeed);
  if (result.type !== 'seedOk') throw new Error('seed rejected');
  const derived = result.hdWallet.selectAccount(account).selectRole(role).deriveKeyAt(index);
  if (derived.type !== 'keyDerived') throw new Error('derivation out of bounds');
  return hex(derived.key);
};

describe('the seeds one master seed derives to', () => {
  it.each(vectors)(
    'derives the specified seeds from $masterSeed at account $account, address index $addressIndex',
    (vector) => {
      const seeds = WalletSeeds.fromMasterSeed(masterSeedOf(vector), {
        account: vector.account,
        addressIndex: vector.addressIndex,
      });

      expect({
        unshielded: hex(seeds.unshielded),
        dust: hex(seeds.dust),
        shielded: hex(seeds.shielded),
      }).toStrictEqual(vector.walletSeeds);
    },
  );

  it.each(vectors)(
    'derives the specified ECDSA unshielded seed from $masterSeed at account $account, address index $addressIndex',
    (vector) => {
      const seeds = WalletSeeds.fromMasterSeed(masterSeedOf(vector), {
        account: vector.account,
        addressIndex: vector.addressIndex,
        unshieldedRole: Roles.EcdsaUnshielded,
      });

      expect(hex(seeds.unshielded)).toBe(vector.seedsByRole.EcdsaUnshielded.seed);
      // The other two are the same wallet whichever way its unshielded side signs.
      expect(hex(seeds.dust)).toBe(vector.walletSeeds.dust);
      expect(hex(seeds.shielded)).toBe(vector.walletSeeds.shielded);
    },
  );

  it('places each seed at the role the specification assigns it', () => {
    // Read the other way round: the vectors state a path per role, and this is the claim that the three seeds are
    // taken from roles 0, 2 and 3 of that path rather than merely being three different values.
    expect(firstAddress.seedsByRole.UnshieldedExternal.path).toBe(`m/44'/2400'/0'/${Roles.NightExternal}/0`);
    expect(firstAddress.seedsByRole.Dust.path).toBe(`m/44'/2400'/0'/${Roles.Dust}/0`);
    expect(firstAddress.seedsByRole.Shielded.path).toBe(`m/44'/2400'/0'/${Roles.Zswap}/0`);
    expect(firstAddress.seedsByRole.EcdsaUnshielded.path).toBe(`m/44'/2400'/0'/${Roles.EcdsaUnshielded}/0`);
  });

  it('agrees with the tree this package already exposed, so the two entry points cannot drift apart', () => {
    // Kept beside the vectors rather than replaced by them: the vectors anchor `WalletSeeds` to the specification, and
    // `tests.test.ts` anchors `HDWallet` to an independent BIP-32 implementation. This is the seam between the two,
    // which neither of those covers.
    const seeds = WalletSeeds.fromMasterSeed(masterSeed);

    expect(hex(seeds.shielded)).toBe(byHand(Roles.Zswap));
    expect(hex(seeds.unshielded)).toBe(byHand(Roles.NightExternal));
    expect(hex(seeds.dust)).toBe(byHand(Roles.Dust));
  });

  it('does not hold the master seed open once it has what it needs', () => {
    // The private material inside the BIP32 tree is wiped before this returns; an application that reads the master
    // seed afterwards is reading its own buffer, which is the only copy the SDK never controlled.
    const before = hex(masterSeed);

    const seeds = WalletSeeds.fromMasterSeed(masterSeed);

    expect(hex(masterSeed)).toBe(before);
    expect(seeds.shielded).not.toBe(masterSeed);
  });
});

describe('a master seed the tree cannot be walked from', () => {
  it('says so, rather than deriving from nothing', () => {
    expect(() => WalletSeeds.fromMasterSeed(new Uint8Array(0))).toThrow();
  });

  it('says so for an index outside the tree', () => {
    expect(() => WalletSeeds.fromMasterSeed(masterSeed, { addressIndex: -1 })).toThrow();
  });
});
