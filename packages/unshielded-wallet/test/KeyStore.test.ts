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
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { createKeystore } from '../src/KeyStore.js';

const networkId = NetworkId.NetworkId.Undeployed;
const secret = Buffer.alloc(32, 7);

describe('KeyStore', () => {
  it('produces a schnorr verifying key in BIP-340 x-only format', () => {
    const keystore = createKeystore({ kind: 'schnorr', secret }, networkId);
    const publicKey = keystore.getPublicKey();

    expect(publicKey.tag).toBe('schnorr');
    // BIP-340 x-only key: 32 bytes
    expect(publicKey.value).toHaveLength(64);
  });

  it('produces an ECDSA verifying key in SEC1 compressed format', () => {
    const keystore = createKeystore({ kind: 'ecdsa', secret }, networkId);
    const publicKey = keystore.getPublicKey();

    expect(publicKey.tag).toBe('ecdsa');
    // SEC1 compressed key: 33 bytes with a 02/03 parity prefix
    expect(publicKey.value).toHaveLength(66);
    expect(['02', '03']).toContain(publicKey.value.slice(0, 2));
  });

  it('derives disjoint addresses for schnorr and ECDSA keystores built from the same secret', () => {
    const schnorrKeystore = createKeystore({ kind: 'schnorr', secret }, networkId);
    const ecdsaKeystore = createKeystore({ kind: 'ecdsa', secret }, networkId);

    // The ledger domain-separates ECDSA address derivation, so even an identical
    // scalar can never own the same UTXOs under both signature schemes
    expect(ecdsaKeystore.getAddress()).not.toBe(schnorrKeystore.getAddress());
    expect(ecdsaKeystore.getBech32Address().asString()).not.toBe(schnorrKeystore.getBech32Address().asString());
  });

  it('signs with the keystore kind and signatures do not verify across schemes', () => {
    const schnorrKeystore = createKeystore({ kind: 'schnorr', secret }, networkId);
    const ecdsaKeystore = createKeystore({ kind: 'ecdsa', secret }, networkId);
    const data = Buffer.from('attack at dawn');

    const schnorrSignature = schnorrKeystore.signData(data);
    const ecdsaSignature = ecdsaKeystore.signData(data);

    expect(schnorrSignature.tag).toBe('schnorr');
    expect(ecdsaSignature.tag).toBe('ecdsa');

    expect(ledger.verifySignature(schnorrKeystore.getPublicKey(), data, schnorrSignature)).toBe(true);
    expect(ledger.verifySignature(ecdsaKeystore.getPublicKey(), data, ecdsaSignature)).toBe(true);

    expect(ledger.verifySignature(schnorrKeystore.getPublicKey(), data, ecdsaSignature)).toBe(false);
    expect(ledger.verifySignature(ecdsaKeystore.getPublicKey(), data, schnorrSignature)).toBe(false);
  });
});
