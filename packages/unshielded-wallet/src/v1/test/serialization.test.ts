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
import { NetworkId, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { CoreWallet } from '../CoreWallet.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { OtherWalletError, SchemeMismatchError } from '../WalletError.js';
import { generateMockUtxoWithMeta } from './testUtils.js';

const networkId = NetworkId.NetworkId.Undeployed;

// Real, scheme-consistent public keys (key encoding matches its tag, and the
// address derives from the key) so deserialization's scheme-consistency guards
// accept them. Both come from the same scalar to keep the fixtures compact.
const secret = Buffer.alloc(32, 3);
const schnorrPK = PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret }, networkId));
const ecdsaPK = PublicKey.fromKeyStore(createKeystore({ kind: 'ecdsa', secret }, networkId));

// Type cast required because: JSON.parse returns `any`; the tests assert on the raw wire format of the snapshot
const parseSnapshot = (serialized: string): { publicKey: { publicKey: unknown } } =>
  JSON.parse(serialized) as { publicKey: { publicKey: unknown } };

const makeWallet = (publicKey: PublicKey): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.restore(
      [generateMockUtxoWithMeta({ owner: publicKey.addressHex, intentHash: 'intent-available', outputNo: 0 })],
      [generateMockUtxoWithMeta({ owner: publicKey.addressHex, intentHash: 'intent-pending', outputNo: 1 })],
    ),
    publicKey,
    { highestTransactionId: 5n, appliedId: 5n },
    ProtocolVersion.MinSupportedVersion,
    'undeployed',
  );

describe('default v1 serialization capability', () => {
  const capability = makeDefaultV1SerializationCapability();

  it('serializes the verifying key with its tag and round-trips a schnorr key', () => {
    const wallet = makeWallet(schnorrPK);

    const serialized = capability.serialize(wallet);
    const rawSnapshot = parseSnapshot(serialized);

    expect(rawSnapshot.publicKey.publicKey).toEqual({ tag: 'schnorr', value: schnorrPK.publicKey.value });

    const restored = capability.deserialize(serialized);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey).toEqual(schnorrPK);
      expect(UnshieldedState.toArrays(restored.right.state)).toEqual(UnshieldedState.toArrays(wallet.state));
      expect(restored.right.networkId).toBe(wallet.networkId);
      expect(restored.right.protocolVersion).toBe(wallet.protocolVersion);
    }
  });

  it('round-trips an ecdsa key preserving the tag', () => {
    const wallet = makeWallet(ecdsaPK);

    const serialized = capability.serialize(wallet);
    const rawSnapshot = parseSnapshot(serialized);

    expect(rawSnapshot.publicKey.publicKey).toEqual({ tag: 'ecdsa', value: ecdsaPK.publicKey.value });

    const restored = capability.deserialize(serialized);

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey.publicKey).toEqual({ tag: 'ecdsa', value: ecdsaPK.publicKey.value });
    }
  });

  it('deserializes a legacy snapshot with a plain-string key as schnorr', () => {
    const legacySnapshot = JSON.stringify({
      publicKey: {
        publicKey: schnorrPK.publicKey.value,
        addressHex: schnorrPK.addressHex,
        address: schnorrPK.address,
      },
      state: {
        availableUtxos: [
          {
            utxo: {
              value: '100',
              owner: schnorrPK.addressHex,
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
      expect(restored.right.publicKey.publicKey).toEqual({ tag: 'schnorr', value: schnorrPK.publicKey.value });
      expect(UnshieldedState.toArrays(restored.right.state).availableUtxos).toHaveLength(1);
    }
  });

  it('rejects a snapshot with an unknown signature kind', () => {
    const tampered = JSON.stringify({
      publicKey: {
        publicKey: { tag: 'ed25519', value: schnorrPK.publicKey.value },
        addressHex: schnorrPK.addressHex,
        address: schnorrPK.address,
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

  // Deserialization is a trust boundary: a relabelled or spliced snapshot must
  // be rejected, not silently accepted (#402 AC #4 — ECDSA-MM-09 / MM-01/02).
  it('rejects an ecdsa-tagged key carrying a schnorr-length value (ECDSA-MM-09)', () => {
    const tampered = JSON.stringify({
      publicKey: {
        // ecdsa keys are 33-byte SEC1 (66 hex); this 32-byte (64 hex) value is a schnorr key relabelled as ecdsa
        publicKey: { tag: 'ecdsa', value: schnorrPK.publicKey.value },
        addressHex: schnorrPK.addressHex,
        address: schnorrPK.address,
      },
      state: { availableUtxos: [], pendingUtxos: [] },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(tampered);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(SchemeMismatchError);
      expect((restored.left as SchemeMismatchError).at).toBe('deserialization');
    }
  });

  it('rejects a snapshot whose address does not derive from its key (ECDSA-MM-01/02)', () => {
    const spliced = JSON.stringify({
      publicKey: {
        // a valid schnorr key, but bundled with the ecdsa key's address
        publicKey: { tag: 'schnorr', value: schnorrPK.publicKey.value },
        addressHex: ecdsaPK.addressHex,
        address: ecdsaPK.address,
      },
      state: { availableUtxos: [], pendingUtxos: [] },
      protocolVersion: '0',
      appliedId: '5',
      networkId: 'undeployed',
    });

    const restored = capability.deserialize(spliced);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(SchemeMismatchError);
      expect((restored.left as SchemeMismatchError).at).toBe('construction');
    }
  });
});
