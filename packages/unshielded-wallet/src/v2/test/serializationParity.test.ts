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
// What an unshielded snapshot carries besides its key.
//
// The serialization tests next door are about identity: which key encodings are accepted, that an address must derive
// from its key, that a legacy bare-string key reads as schnorr. Their fixture already holds a UTXO on each side of the
// available/pending split — but nothing asserts that either survives the round trip, so the money the snapshot exists
// to carry is the one thing not checked.
//
// Every value below is chosen so a plausible bug cannot satisfy it by accident: a value larger than a double can hold
// exactly, so a numeric encoding shows up as a wrong number rather than a passing test; both dust-registration states,
// so a field defaulted on the way back is caught in one direction or the other; and a sync cursor whose two indices
// differ, so a tip derived from the applied position is not mistaken for a carried one.
import { beforeAll, describe, expect, it } from 'vitest';
import { Either } from 'effect';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { HashMap } from 'effect';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
import { CoreWallet } from '../CoreWallet.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { generateMockUtxoWithMeta } from './testUtils.js';

const networkId = NetworkId.NetworkId.Undeployed;
const publicKey = PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret: Buffer.alloc(32, 3) }, networkId));

/** Larger than `Number.MAX_SAFE_INTEGER`, so a value that went through a double comes back wrong rather than equal. */
const BEYOND_DOUBLE = 9_007_199_254_740_993n;
const CTIME = new Date('2026-03-04T05:06:07.008Z');

const available = generateMockUtxoWithMeta({
  owner: publicKey.addressHex,
  intentHash: 'intent-available',
  outputNo: 0,
  value: BEYOND_DOUBLE,
  ctime: CTIME,
  registeredForDustGeneration: true,
});

const pending = generateMockUtxoWithMeta({
  owner: publicKey.addressHex,
  intentHash: 'intent-pending',
  outputNo: 1,
  value: 7n,
  ctime: CTIME,
  // The other registration state, so a field that came back defaulted is caught whichever way the default falls.
  registeredForDustGeneration: false,
});

const wallet = CoreWallet.restore(
  UnshieldedState.restore([available], [pending]),
  publicKey,
  // Deliberately different: a snapshot that rebuilt the tip from the applied position would satisfy an equal pair.
  { highestTransactionId: 99n, appliedId: 42n },
  ProtocolVersion.MinSupportedVersion,
  networkId,
);

const capability = makeDefaultV2SerializationCapability();

// Built in `beforeAll` rather than at module scope so that a snapshot which stops deserializing is reported as a
// failing test rather than as a suite that would not load.
let restored: CoreWallet;

beforeAll(() => {
  const result = capability.deserialize(capability.serialize(wallet));

  expect(Either.isRight(result)).toBe(true);
  if (Either.isRight(result)) {
    restored = result.right;
  }
});

const only = (utxos: HashMap.HashMap<string, ReturnType<typeof generateMockUtxoWithMeta>>) => {
  const values = [...HashMap.values(utxos)];
  expect(values.length).toBe(1);
  return values[0];
};

describe('what an unshielded snapshot carries besides its key', () => {
  it('keeps the available and the pending UTXO on their own sides of the split', () => {
    // Both sides asserted, and separately: a restore that merged them would still hold two UTXOs in total, and a
    // wallet that believes a pending UTXO is available offers to spend money it has already committed.
    expect(HashMap.size(restored.state.availableUtxos)).toBe(1);
    expect(HashMap.size(restored.state.pendingUtxos)).toBe(1);
    expect(only(restored.state.availableUtxos).utxo.intentHash).toBe('intent-available');
    expect(only(restored.state.pendingUtxos).utxo.intentHash).toBe('intent-pending');
  });

  it('keeps a value larger than a double can hold, as a bigint', () => {
    const carried = only(restored.state.availableUtxos);

    expect(carried.utxo.value).toBe(BEYOND_DOUBLE);
    expect(typeof carried.utxo.value).toBe('bigint');
  });

  it('keeps the creation time as a Date, and the dust registration state of each side', () => {
    const carriedAvailable = only(restored.state.availableUtxos);
    const carriedPending = only(restored.state.pendingUtxos);

    expect(carriedAvailable.meta.ctime).toBeInstanceOf(Date);
    expect(carriedAvailable.meta.ctime.getTime()).toBe(CTIME.getTime());
    expect(carriedAvailable.meta.registeredForDustGeneration).toBe(true);
    expect(carriedPending.meta.registeredForDustGeneration).toBe(false);
  });

  it('keeps every remaining field of the UTXO, not merely the ones named above', () => {
    const carried = only(restored.state.availableUtxos);

    expect(carried.utxo.owner).toBe(publicKey.addressHex);
    expect(carried.utxo.type).toBe(available.utxo.type);
    expect(carried.utxo.outputNo).toBe(0);
  });

  it('keeps the identity, the network and the protocol version', () => {
    expect(restored.publicKey.addressHex).toBe(publicKey.addressHex);
    expect(restored.publicKey.address).toBe(publicKey.address);
    expect(restored.networkId).toBe(networkId);
    expect(restored.protocolVersion).toBe(ProtocolVersion.MinSupportedVersion);
  });

  it('keeps the applied position, and rebuilds the source tip from it rather than carrying it', () => {
    // Pinning today's answer rather than asking for a better one. The snapshot has no field for the source tip, so a
    // restored wallet reports a gap of zero and calls itself caught up until its first sync update arrives. Whether
    // the tip should be persisted is a live question; that it currently is not is what this records.
    expect(restored.progress.appliedId).toBe(42n);
    expect(restored.progress.highestTransactionId).toBe(42n);
  });
});
