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
//
// Deserialization is a trust boundary: a snapshot is whatever was handed back to us. The ledger-v9 variant checks
// there that a snapshot's address really derives from its verifying key, and reports a mismatch as the cross-scheme
// mix it is. Only the SCHEME LABELLING of that error is v9-only — ledger-v8 has a single signature scheme — so the v8
// variant makes the same assertion and reports it as an ordinary wallet error.
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { createKeystore, PublicKey } from '../KeyStore.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { UnshieldedState, UtxoWithMeta } from '../UnshieldedState.js';
import { OtherWalletError } from '../WalletError.js';

const networkId = NetworkId.NetworkId.Undeployed;

// Two real, self-consistent keys: each address derives from its own key, so only deliberate splicing can break the
// consistency the capability asserts.
const ownPK = PublicKey.fromKeyStore(createKeystore(Buffer.alloc(32, 3), networkId));
const foreignPK = PublicKey.fromKeyStore(createKeystore(Buffer.alloc(32, 7), networkId));

const utxoOf = (owner: ledger.UserAddress, intentHash: string, outputNo: number): UtxoWithMeta =>
  new UtxoWithMeta({
    utxo: { value: 42n, owner, type: ledger.nativeToken().raw, intentHash, outputNo },
    meta: { ctime: new Date(0), registeredForDustGeneration: false },
  });

const walletOf = (publicKey: PublicKey): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.restore(
      [utxoOf(publicKey.addressHex, 'intent-available', 0)],
      [utxoOf(publicKey.addressHex, 'intent-pending', 1)],
    ),
    publicKey,
    { highestTransactionId: 5n, appliedId: 5n },
    ProtocolVersion.MinSupportedVersion,
    networkId,
  );

const snapshotWithPublicKey = (publicKey: PublicKey['publicKey'], addressHex: string, address: string): string =>
  JSON.stringify({
    publicKey: { publicKey, addressHex, address },
    state: { availableUtxos: [], pendingUtxos: [] },
    protocolVersion: '0',
    appliedId: '5',
    networkId: 'undeployed',
  });

describe('default v1 serialization capability', () => {
  const capability = makeDefaultV1SerializationCapability();

  it('round-trips a wallet whose address derives from its key', () => {
    const wallet = walletOf(ownPK);

    const restored = capability.deserialize(capability.serialize(wallet));

    expect(Either.isRight(restored)).toBe(true);
    if (Either.isRight(restored)) {
      expect(restored.right.publicKey).toEqual(ownPK);
      expect(restored.right.progress.appliedId).toBe(5n);
      expect(restored.right.networkId).toBe(networkId);
    }
  });

  it('rejects a snapshot whose address does not derive from its key', () => {
    // A valid verifying key bundled with somebody else's address. Nothing in the schema can catch this: both fields
    // are well-formed strings, and only deriving one from the other shows they do not belong together.
    const spliced = snapshotWithPublicKey(ownPK.publicKey, foreignPK.addressHex, foreignPK.address);

    const restored = capability.deserialize(spliced);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(OtherWalletError);
      expect(restored.left.message).toContain('does not match its verifying key');
    }
  });

  it('rejects a snapshot whose verifying key cannot be decoded, without letting the ledger throw escape', () => {
    // The key decoder lives in wasm and traps on a malformed key. On a trust boundary that must fail closed as a
    // typed Left, never as an exception thrown out of `deserialize`.
    const malformed = snapshotWithPublicKey('not-a-key', ownPK.addressHex, ownPK.address);

    const restored = capability.deserialize(malformed);

    expect(Either.isLeft(restored)).toBe(true);
    if (Either.isLeft(restored)) {
      expect(restored.left).toBeInstanceOf(OtherWalletError);
      expect(restored.left.message).toContain('could not be decoded');
    }
  });
});
