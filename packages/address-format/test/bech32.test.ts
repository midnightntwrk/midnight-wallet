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
  DustAddress,
  mainnet,
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionSecretKey,
  UnshieldedAddress,
} from '../src/index.js';
import addresses from './addresses.json' with { type: 'json' };

// The test vectors carry `networkId: null` for mainnet; the codecs use the `mainnet` symbol.
const networkOf = (item: (typeof addresses)[number]) => item.networkId ?? mainnet;

describe('Bech32 addresses', () => {
  it('ShieldedAddress - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item) => {
      const shA = ShieldedAddress.codec.decode(networkOf(item), MidnightBech32m.parse(item.shieldedAddress.bech32m));

      expect(item.shieldedAddress.hex).toEqual(`${shA.coinPublicKeyString()}${shA.encryptionPublicKeyString()}`);
    });
  });

  it('ShieldedEncryptionSecretKey - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item) => {
      const shESK = ShieldedEncryptionSecretKey.codec.decode(
        networkOf(item),
        MidnightBech32m.parse(item.shieldedESK.bech32m),
      );

      const eskHEX = Buffer.from(shESK.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize()).toString('hex');

      expect(item.shieldedESK.hex).toEqual(eskHEX);
    });
  });

  it('ShieldedCoinPublicKey - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item) => {
      const shCPK = ShieldedCoinPublicKey.codec.decode(
        networkOf(item),
        MidnightBech32m.parse(item.shieldedCPK.bech32m),
      );

      expect(item.shieldedCPK.hex).toEqual(Buffer.from(shCPK.data).toString('hex'));
    });
  });

  it('UnshieldedAddress - Bech32 representation should match its Hex representation', () => {
    // Some seeds have no derivable unshielded address; those vectors carry a null hex/bech32m pair.
    const withUnshielded = addresses.filter(
      (item): item is typeof item & { unshieldedAddress: { hex: string; bech32m: string } } =>
        item.unshieldedAddress.bech32m !== null,
    );
    expect(withUnshielded.length).toBeGreaterThan(0);

    withUnshielded.forEach((item) => {
      const address = UnshieldedAddress.codec.decode(
        networkOf(item),
        MidnightBech32m.parse(item.unshieldedAddress.bech32m),
      );

      expect(item.unshieldedAddress.hex).toEqual(address.hexString);
    });
  });

  it('DustAddress - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item) => {
      const dustAddress = DustAddress.codec.decode(networkOf(item), MidnightBech32m.parse(item.dustAddress.bech32m));

      expect(item.dustAddress.hex).toEqual(Buffer.from(dustAddress.serialize()).toString('hex'));
    });
  });
});
