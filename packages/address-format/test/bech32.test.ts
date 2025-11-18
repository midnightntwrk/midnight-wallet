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
import { describe, expect, it } from 'vitest';
import {
  mainnet,
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionSecretKey,
} from '../src/index.js';
import addresses from './addresses.json' with { type: 'json' };

describe('Bech32 addresses', () => {
  it('ShieldedAddress - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item, _) => {
      const shA = ShieldedAddress.codec.decode(
        item.networkId ?? mainnet,
        MidnightBech32m.parse(item.shieldedAddress.bech32m),
      );

      expect(item.shieldedAddress.hex).toEqual(`${shA.coinPublicKeyString()}${shA.encryptionPublicKeyString()}`);
    });
  });

  /**
   * addresses.json needs to be updated with the correct format for this test to pass
   */
  it.skip('ShieldedEncryptionSecretKey - Bech32 representation should match its Hex representation', () => {
    const zswapNetworkIds = ['dev', 'test', null];
    const filteredAddresses = addresses.filter((item) => zswapNetworkIds.includes(item.networkId));
    filteredAddresses.forEach((item, _) => {
      const shESK = ShieldedEncryptionSecretKey.codec.decode(
        'undeployed',
        MidnightBech32m.parse(item.shieldedESK.bech32m),
      );

      const eskHEXRaw = shESK.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize();
      const eskHEX = Buffer.from(eskHEXRaw.subarray(1)).toString('hex');

      expect(item.shieldedESK.hex).toEqual(eskHEX);
    });
  });

  it('ShieldedCoinPublicKey - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item, _) => {
      const shCPK = ShieldedCoinPublicKey.codec.decode(
        item.networkId ?? mainnet,
        MidnightBech32m.parse(item.shieldedCPK.bech32m),
      );

      expect(item.shieldedCPK.hex).toEqual(Buffer.from(shCPK.data).toString('hex'));
    });
  });
});
