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
import { hdkey } from '@ethereumjs/wallet';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  generateMnemonicWords,
  generateRandomSeed,
  HDWallet,
  joinMnemonicWords,
  type Role,
  Roles,
  validateMnemonic,
} from '../src/index.js';

const MASTER_KEY_MIN_LENGTH = 16;
const MASTER_KEY_MAX_LENGTH = 64;

describe('HD Wallet', () => {
  function derive3rdPartyPrivateKey(seed: Uint8Array, account: number, role: number, index: number) {
    const thirdPartyWallet = hdkey.EthereumHDKey.fromMasterSeed(seed);
    const derivedKey = thirdPartyWallet.derivePath(`m/44'/2400'/${account}'/${role}/${index}`);
    return derivedKey.getWallet().getPrivateKey();
  }

  const validMnemonicLength = [16, 20, 24, 28, 32];
  const arbStrength = fc.constantFrom(...validMnemonicLength);

  it('Derivation from valid seed should be consistent', () => {
    const seedArb = fc.uint8Array({
      minLength: MASTER_KEY_MIN_LENGTH,
      maxLength: MASTER_KEY_MAX_LENGTH,
      size: 'max',
    });

    // account and index can be between 0 to 2^31
    const accountArb = fc.nat(2147483647);
    const indexArb = fc.nat(2147483647);

    const roleArb = fc.constantFrom(...Object.values(Roles));

    fc.assert(
      fc.property(seedArb, accountArb, indexArb, roleArb, (seed, account, index, role) => {
        const hdWalletResult = HDWallet.fromSeed(seed);
        if (hdWalletResult.type == 'seedError') {
          throw Error('Wrong seed!');
        }

        const derivationResult = hdWalletResult.hdWallet.selectAccount(account).selectRole(role).deriveKeyAt(index);

        if (derivationResult.type == 'keyOutOfBounds') {
          expect(() => derive3rdPartyPrivateKey(seed, account, role, index)).toThrow();
        } else {
          // Checks our implementation vs. @ethereumjs/wallet library.
          const thridPartyPK = derive3rdPartyPrivateKey(seed, account, role, index);
          const derivedOur = Buffer.from(derivationResult.key).toString('hex');
          const expectedOther = Buffer.from(thridPartyPK).toString('hex');

          expect(derivedOur).toEqual(expectedOther);
        }
      }),
    );
  });

  it('Invalid seed length should fail < 16', () => {
    const seedArb = fc.uint8Array({ maxLength: MASTER_KEY_MIN_LENGTH - 1, size: 'max' });
    fc.assert(
      fc.property(seedArb, (seed) => {
        expect(() => hdkey.EthereumHDKey.fromMasterSeed(seed)).toThrow();
        expect(() => HDKey.fromMasterSeed(seed)).toThrow();
      }),
    );
  });

  it('Invalid seed length should fail > 64', () => {
    const seedArb = fc.uint8Array({
      minLength: MASTER_KEY_MAX_LENGTH + 1,
      maxLength: 128,
      size: 'max',
    });
    fc.assert(
      fc.property(seedArb, (seed) => {
        expect(() => hdkey.EthereumHDKey.fromMasterSeed(seed)).toThrow();
        expect(() => HDKey.fromMasterSeed(seed)).toThrow();
      }),
    );
  });

  it('Generated mnemonic should always be valid', () => {
    fc.assert(
      fc.property(arbStrength, (strength) => {
        const mnemonic = generateMnemonicWords(strength * 8);
        expect(validateMnemonic(joinMnemonicWords(mnemonic))).toBeTruthy();
      }),
    );
  });

  describe('out-of-bounds derivation returns keyOutOfBounds instead of throwing', () => {
    const hdWallet = (() => {
      const result = HDWallet.fromSeed(
        Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
      );
      if (result.type !== 'seedOk') throw new Error('seed setup failed');
      return result.hdWallet;
    })();

    // BIP32 non-hardened child indices are integers in [0, 2^31)
    const invalidIndexArb = fc.oneof(
      fc.integer({ min: 2 ** 31, max: Number.MAX_SAFE_INTEGER }),
      fc.integer({ min: Number.MIN_SAFE_INTEGER, max: -1 }),
      fc.constantFrom(Number.NaN, 0.5, 1.5, Math.PI, Number.POSITIVE_INFINITY),
    );

    it('deriveKeyAt returns keyOutOfBounds for an invalid index', () => {
      fc.assert(
        fc.property(invalidIndexArb, (index) => {
          const result = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(index);
          expect(result).toEqual({ type: 'keyOutOfBounds' });
        }),
      );
    });

    it('deriveKeyAt returns keyOutOfBounds for an out-of-bounds account', () => {
      fc.assert(
        fc.property(invalidIndexArb, (account) => {
          const result = hdWallet.selectAccount(account).selectRole(Roles.NightExternal).deriveKeyAt(0);
          expect(result).toEqual({ type: 'keyOutOfBounds' });
        }),
      );
    });

    it('deriveKeyAt returns keyOutOfBounds for an invalid role smuggled past the type system', () => {
      // Type cast required because: reproducing an untyped JS caller passing a missing
      // Roles entry, which resolves to undefined at runtime
      const role = undefined as unknown as Role;
      const result = hdWallet.selectAccount(0).selectRole(role).deriveKeyAt(0);
      expect(result).toEqual({ type: 'keyOutOfBounds' });
    });

    it('deriveKeysAt reports every requested role as out of bounds for an invalid index', () => {
      const roles = [Roles.Zswap, Roles.Metadata, Roles.Dust] as const;
      const result = hdWallet
        .selectAccount(0)
        .selectRoles(roles)
        .deriveKeysAt(2 ** 31);
      expect(result).toEqual({ type: 'keyOutOfBounds', roles: [Roles.Zswap, Roles.Metadata, Roles.Dust] });
    });
  });

  it('Roundtrip from seed to mnemonic and back should give the same seed', () => {
    fc.assert(
      fc.property(arbStrength, (strength) => {
        const initialSeed = generateRandomSeed(strength * 8);
        const mnemonic = bip39.entropyToMnemonic(initialSeed, english);
        const regeneratedSeed = Buffer.from(bip39.mnemonicToEntropy(mnemonic, english).slice(0, 32)).toString('hex');

        expect(bip39.validateMnemonic(mnemonic, english)).toBeTruthy();
        expect(Buffer.from(initialSeed).toString('hex')).toEqual(regeneratedSeed);
      }),
    );
  });
});
