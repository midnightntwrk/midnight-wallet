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
import { Either } from 'effect';
import { type SignatureVerifyingKey } from '@midnight-ntwrk/ledger-v9';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { CoreWallet } from '../CoreWallet.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { type PublicKey } from '../../KeyStore.js';
import { OtherWalletError } from '../WalletError.js';
import { generateMockUtxoWithMeta } from './testUtils.js';

const verifyingKeyHex = 'b1d9a4cbb84e1d5b9e90c70ce64b2f62da8408b07ce62ba4dbf3a47d2fcc6e92';
const addressHex = '0d8ec0e228b1c24304549043491c4e3e67a75c47f04a25a6510a1eaded90b79b';
const bech32Address = 'mn_addr_undeployed1gkasr3z3vwyscy2jpp53nzr37v7n4r3lsfgj6v5g584dakjzt0xqun4d4r';

const makePublicKey = (publicKey: SignatureVerifyingKey): PublicKey => ({
  publicKey,
  addressHex,
  address: bech32Address,
});

// Type cast required because: JSON.parse returns `any`; the tests assert on the raw wire format of the snapshot
const parseSnapshot = (serialized: string): { publicKey: { publicKey: unknown } } =>
  JSON.parse(serialized) as { publicKey: { publicKey: unknown } };

const makeWallet = (publicKey: PublicKey): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.restore(
      [generateMockUtxoWithMeta({ owner: addressHex, intentHash: 'intent-available', outputNo: 0 })],
      [generateMockUtxoWithMeta({ owner: addressHex, intentHash: 'intent-pending', outputNo: 1 })],
    ),
    publicKey,
    { highestTransactionId: 5n, appliedId: 5n },
    ProtocolVersion.MinSupportedVersion,
    'undeployed',
  );

describe('default v1 serialization capability', () => {
  const capability = makeDefaultV1SerializationCapability();

  it('serializes the verifying key with its tag and round-trips a schnorr key', () => {
    const publicKey = makePublicKey({ tag: 'schnorr', value: verifyingKeyHex });
    const wallet = makeWallet(publicKey);

    const serialized = capability.serialize(wallet);
    const rawSnapshot = parseSnapshot(serialized);

    expect(rawSnapshot.publicKey.publicKey).toEqual({ tag: 'schnorr', value: verifyingKeyHex });

    const restored = capability.deserialize(serialized);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey).toEqual(publicKey);
      expect(UnshieldedState.toArrays(restored.right.state)).toEqual(UnshieldedState.toArrays(wallet.state));
      expect(restored.right.networkId).toBe(wallet.networkId);
      expect(restored.right.protocolVersion).toBe(wallet.protocolVersion);
    }
  });

  it('round-trips an ecdsa key preserving the tag', () => {
    const publicKey = makePublicKey({ tag: 'ecdsa', value: verifyingKeyHex });
    const wallet = makeWallet(publicKey);

    const serialized = capability.serialize(wallet);
    const rawSnapshot = parseSnapshot(serialized);

    expect(rawSnapshot.publicKey.publicKey).toEqual({ tag: 'ecdsa', value: verifyingKeyHex });

    const restored = capability.deserialize(serialized);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey.publicKey).toEqual({ tag: 'ecdsa', value: verifyingKeyHex });
    }
  });

  it('deserializes a legacy snapshot with a plain-string key as schnorr', () => {
    const legacySnapshot = JSON.stringify({
      publicKey: {
        publicKey: verifyingKeyHex,
        addressHex,
        address: bech32Address,
      },
      state: {
        availableUtxos: [
          {
            utxo: {
              value: '100',
              owner: addressHex,
              type: 'type1',
              intentHash: 'intent-available',
              outputNo: 0,
            },
            meta: {
              ctime: '2026-01-01T00:00:00.000Z',
              registeredForDustGeneration: true,
            },
          },
        ],
        pendingUtxos: [],
      },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(legacySnapshot);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey.publicKey).toEqual({ tag: 'schnorr', value: verifyingKeyHex });
      expect(UnshieldedState.toArrays(restored.right.state).availableUtxos).toHaveLength(1);
    }
  });

  it('rejects a snapshot with an unknown signature kind', () => {
    const tampered = JSON.stringify({
      publicKey: {
        publicKey: { tag: 'ed25519', value: verifyingKeyHex },
        addressHex,
        address: bech32Address,
      },
      state: { availableUtxos: [], pendingUtxos: [] },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(tampered);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(OtherWalletError);
    }
  });
});
