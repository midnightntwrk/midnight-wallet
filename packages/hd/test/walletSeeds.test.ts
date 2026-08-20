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
 *   The values below are pinned against the derivation as it stands today, not against a published specification. The
 *   spec-reference test vectors cover the hop _after_ this one — a per-wallet seed to keys and addresses — and take the
 *   per-wallet seed as given. Nothing published states what a master seed derives to per role, so what these vectors
 *   protect is that the naming changed nothing.
 */
import { describe, expect, it } from 'vitest';
import { HDWallet, Roles, WalletSeeds } from '../src/index.js';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const masterSeed = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex');

/** The walk every consumer in this repository has been writing out by hand. */
const byHand = (role: (typeof Roles)[keyof typeof Roles], account = 0, index = 0): string => {
  const result = HDWallet.fromSeed(masterSeed);
  if (result.type !== 'seedOk') throw new Error('seed rejected');
  const derived = result.hdWallet.selectAccount(account).selectRole(role).deriveKeyAt(index);
  if (derived.type !== 'keyDerived') throw new Error('derivation out of bounds');
  return hex(derived.key);
};

describe('the seeds one master seed derives to', () => {
  it('gives each wallet the seed that wallet has always been given', () => {
    const seeds = WalletSeeds.fromMasterSeed(masterSeed);

    expect(hex(seeds.shielded)).toBe(byHand(Roles.Zswap));
    expect(hex(seeds.unshielded)).toBe(byHand(Roles.NightExternal));
    expect(hex(seeds.dust)).toBe(byHand(Roles.Dust));
  });

  it('derives the values it derives today, so naming the walk changed nothing', () => {
    const seeds = WalletSeeds.fromMasterSeed(masterSeed);

    expect(hex(seeds.shielded)).toBe('9690d4013e42e6739d9496f836b2cbd4339451c02a00624b86e9fb15cc4197a8');
    expect(hex(seeds.unshielded)).toBe('22b8e577b3f638b2b361f36fd62d7138ed489d9afe3da5f7c325e2d0a95ae043');
    expect(hex(seeds.dust)).toBe('b9b76cce66828aa6bd798abbb15b012331a6aa1e5f99e678724c37463b5775a1');
  });

  it('follows the account and address index it is asked for', () => {
    const seeds = WalletSeeds.fromMasterSeed(masterSeed, { account: 2, addressIndex: 5 });

    expect(hex(seeds.shielded)).toBe(byHand(Roles.Zswap, 2, 5));
    expect(hex(seeds.unshielded)).toBe(byHand(Roles.NightExternal, 2, 5));
    expect(hex(seeds.dust)).toBe(byHand(Roles.Dust, 2, 5));
  });

  it('derives the unshielded seed from whichever signing scheme the wallet will use', () => {
    const ecdsa = WalletSeeds.fromMasterSeed(masterSeed, { unshieldedRole: Roles.EcdsaUnshielded });

    expect(hex(ecdsa.unshielded)).toBe(byHand(Roles.EcdsaUnshielded));
    // The other two are the same wallet whichever way its unshielded side signs.
    expect(hex(ecdsa.shielded)).toBe(byHand(Roles.Zswap));
    expect(hex(ecdsa.dust)).toBe(byHand(Roles.Dust));
  });

  it('does not hold the master seed open once it has what it needs', () => {
    // The private material inside the BIP32 tree is wiped before this returns; an application that reads the master
    // seed afterwards is reading its own buffer, which is the only copy the SDK never controlled.
    const seeds = WalletSeeds.fromMasterSeed(masterSeed);

    expect(hex(masterSeed)).toBe('0000000000000000000000000000000000000000000000000000000000000001');
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
