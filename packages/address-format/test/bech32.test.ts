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
import { describe, expect, it } from 'vitest';
import {
  mainnet,
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  ShieldedEncryptionSecretKey,
  UnshieldedAddress,
  DustAddress,
} from '../src/index.js';
import addresses from './addresses.json' with { type: 'json' };

describe('Bech32 addresses', () => {
  describe('Test vectors from midnight-architecture', () => {
    it('ShieldedAddress - Bech32 representation should match its Hex representation', () => {
      addresses.forEach((item) => {
        const networkId = item.networkId ?? mainnet;
        const decoded = MidnightBech32m.parse(item.shieldedAddress.bech32m).decode(ShieldedAddress, networkId);

        expect(item.shieldedAddress.hex).toEqual(`${decoded.coinPublicKeyString()}${decoded.encryptionPublicKeyString()}`);
      });
    });

    it('ShieldedCoinPublicKey - Bech32 representation should match its Hex representation', () => {
      addresses.forEach((item) => {
        const networkId = item.networkId ?? mainnet;
        const decoded = MidnightBech32m.parse(item.shieldedCPK.bech32m).decode(ShieldedCoinPublicKey, networkId);

        expect(item.shieldedCPK.hex).toEqual(Buffer.from(decoded.data).toString('hex'));
      });
    });

    it('ShieldedEncryptionSecretKey - Bech32 representation should decode correctly', () => {
      addresses.forEach((item) => {
        const networkId = item.networkId ?? mainnet;
        const decoded = MidnightBech32m.parse(item.shieldedESK.bech32m).decode(ShieldedEncryptionSecretKey, networkId);

        const eskHEX = Buffer.from(decoded.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize()).toString('hex');
        expect(item.shieldedESK.hex).toEqual(eskHEX);
      });
    });

    it('DustAddress - Bech32 representation should match its Hex representation', () => {
      addresses.forEach((item) => {
        const networkId = item.networkId ?? mainnet;
        const decoded = MidnightBech32m.parse(item.dustAddress.bech32m).decode(DustAddress, networkId);

        expect(item.dustAddress.hex).toEqual(decoded.serialize().toString('hex'));
      });
    });

    it('UnshieldedAddress - Bech32 representation should match its Hex representation', () => {
      const addressesWithUnshielded = addresses.filter((item) => item.unshieldedAddress.bech32m !== null);
      addressesWithUnshielded.forEach((item) => {
        const networkId = item.networkId ?? mainnet;
        const decoded = MidnightBech32m.parse(item.unshieldedAddress.bech32m!).decode(UnshieldedAddress, networkId);

        expect(item.unshieldedAddress.hex).toEqual(Buffer.from(decoded.data).toString('hex'));
      });
    });
  });

  describe('MidnightBech32m.encode/decode roundtrip', () => {
    const testCases: Array<{ networkId: typeof mainnet | string; name: string }> = [
      { networkId: mainnet, name: 'mainnet' },
      { networkId: 'testnet', name: 'testnet' },
      { networkId: 'devnet', name: 'devnet' },
      { networkId: 'my-private-net', name: 'my-private-net' },
    ];

    describe('ShieldedCoinPublicKey', () => {
      const testData = Buffer.from('064e092a80b33bee23404c46cfc48fec75a2356a9b01178dd6a62c29f5896f67', 'hex');
      const cpk = new ShieldedCoinPublicKey(testData);

      testCases.forEach(({ networkId, name }) => {
        it(`should encode and decode with ${name}`, () => {
          const encoded = MidnightBech32m.encode(networkId, cpk);
          const decoded = encoded.decode(ShieldedCoinPublicKey, networkId);

          expect(decoded.equals(cpk)).toBe(true);
        });

        it(`should parse encoded string and decode with ${name}`, () => {
          const bech32m = MidnightBech32m.encode(networkId, cpk).asString();
          const decoded = MidnightBech32m.parse(bech32m).decode(ShieldedCoinPublicKey, networkId);

          expect(decoded.equals(cpk)).toBe(true);
        });
      });
    });

    describe('ShieldedEncryptionPublicKey', () => {
      const testData = Buffer.from('0300063c7753854aea18aa11f04d77b3c7eaa0918e4aa98d5eaf0704d8f4c2fc', 'hex');
      const epk = new ShieldedEncryptionPublicKey(testData);

      testCases.forEach(({ networkId, name }) => {
        it(`should encode and decode with ${name}`, () => {
          const encoded = MidnightBech32m.encode(networkId, epk);
          const decoded = encoded.decode(ShieldedEncryptionPublicKey, networkId);

          expect(decoded.equals(epk)).toBe(true);
        });

        it(`should parse encoded string and decode with ${name}`, () => {
          const bech32m = MidnightBech32m.encode(networkId, epk).asString();
          const decoded = MidnightBech32m.parse(bech32m).decode(ShieldedEncryptionPublicKey, networkId);

          expect(decoded.equals(epk)).toBe(true);
        });
      });
    });

    describe('ShieldedAddress', () => {
      const cpkData = Buffer.from('064e092a80b33bee23404c46cfc48fec75a2356a9b01178dd6a62c29f5896f67', 'hex');
      const epkData = Buffer.from('0300063c7753854aea18aa11f04d77b3c7eaa0918e4aa98d5eaf0704d8f4c2fc', 'hex');
      const shieldedAddr = new ShieldedAddress(
        new ShieldedCoinPublicKey(cpkData),
        new ShieldedEncryptionPublicKey(epkData),
      );

      testCases.forEach(({ networkId, name }) => {
        it(`should encode and decode with ${name}`, () => {
          const encoded = MidnightBech32m.encode(networkId, shieldedAddr);
          const decoded = encoded.decode(ShieldedAddress, networkId);

          expect(decoded.equals(shieldedAddr)).toBe(true);
        });

        it(`should parse encoded string and decode with ${name}`, () => {
          const bech32m = MidnightBech32m.encode(networkId, shieldedAddr).asString();
          const decoded = MidnightBech32m.parse(bech32m).decode(ShieldedAddress, networkId);

          expect(decoded.equals(shieldedAddr)).toBe(true);
        });
      });
    });

    describe('UnshieldedAddress', () => {
      const testData = Buffer.from('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', 'hex');
      const unshieldedAddr = new UnshieldedAddress(testData);

      testCases.forEach(({ networkId, name }) => {
        it(`should encode and decode with ${name}`, () => {
          const encoded = MidnightBech32m.encode(networkId, unshieldedAddr);
          const decoded = encoded.decode(UnshieldedAddress, networkId);

          expect(decoded.equals(unshieldedAddr)).toBe(true);
        });

        it(`should parse encoded string and decode with ${name}`, () => {
          const bech32m = MidnightBech32m.encode(networkId, unshieldedAddr).asString();
          const decoded = MidnightBech32m.parse(bech32m).decode(UnshieldedAddress, networkId);

          expect(decoded.equals(unshieldedAddr)).toBe(true);
        });
      });
    });

    describe('DustAddress', () => {
      const dustAddr = new DustAddress(123456789012345678901234567890n);

      testCases.forEach(({ networkId, name }) => {
        it(`should encode and decode with ${name}`, () => {
          const encoded = MidnightBech32m.encode(networkId, dustAddr);
          const decoded = encoded.decode(DustAddress, networkId);

          expect(decoded.equals(dustAddr)).toBe(true);
        });

        it(`should parse encoded string and decode with ${name}`, () => {
          const bech32m = MidnightBech32m.encode(networkId, dustAddr).asString();
          const decoded = MidnightBech32m.parse(bech32m).decode(DustAddress, networkId);

          expect(decoded.equals(dustAddr)).toBe(true);
        });
      });
    });
  });
});
