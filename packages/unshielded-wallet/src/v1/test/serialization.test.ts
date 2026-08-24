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
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Array as Arr, Order, pipe, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { UnshieldedState, type UtxoWithMeta } from '../UnshieldedState.js';
import { generateMockUtxoWithMeta, utxoHash } from './testUtils.js';

// A wallet that carries state across an SDK upgrade does it by serialize → restore, so every field the snapshot claims
// to carry has to survive that round trip on a wallet that actually holds UTxOs. The pre-existing coverage only ever
// round-tripped an empty wallet, which cannot distinguish "carried" from "rebuilt empty".

const networkId = NetworkId.NetworkId.Undeployed;
const secretKeyHex = '0000000000000000000000000000000000000000000000000000000000000001';

const makePublicKey = (): PublicKey =>
  PublicKey.fromKeyStore(createKeystore(Buffer.from(secretKeyHex, 'hex'), networkId));

const isJsonArray = Schema.is(Schema.Array(Schema.Unknown));
const isJsonObject = Schema.is(Schema.Record({ key: Schema.String, value: Schema.Unknown }));

/**
 * Leaf paths of a decoded snapshot, in `a.b[].c` form, so one assertion can pin the envelope's whole field structure.
 * An array contributes the paths of its first element, which is enough for a homogeneous collection.
 */
const keyPaths = (value: unknown, prefix = ''): readonly string[] =>
  isJsonArray(value)
    ? value.length === 0
      ? [`${prefix}[]`]
      : keyPaths(value[0], `${prefix}[]`)
    : isJsonObject(value)
      ? Object.entries(value).flatMap(([key, nested]) => keyPaths(nested, prefix === '' ? key : `${prefix}.${key}`))
      : [prefix];

/** Field-by-field projection, so an assertion names the values it carries rather than delegating to class equality. */
const project = (utxos: readonly UtxoWithMeta[]) =>
  pipe(
    Arr.fromIterable(utxos),
    Arr.sortBy((a: UtxoWithMeta, b: UtxoWithMeta) =>
      utxoHash(a) < utxoHash(b) ? -1 : utxoHash(a) > utxoHash(b) ? 1 : 0,
    ),
    Arr.map((u) => ({
      value: u.utxo.value,
      owner: u.utxo.owner,
      type: u.utxo.type,
      intentHash: u.utxo.intentHash,
      outputNo: u.utxo.outputNo,
      ctime: u.meta.ctime,
      registeredForDustGeneration: u.meta.registeredForDustGeneration,
    })),
  );

// Pinned rather than random: ctime is encoded as a date and the value as a decimal string, and both have to come back
// as the same bigint/Date instance types, not as a string that merely prints the same.
const availableUtxos: readonly UtxoWithMeta[] = [
  generateMockUtxoWithMeta({
    intentHash: 'aa'.repeat(32),
    outputNo: 0,
    value: 150_000_000_000n,
    owner: 'owner1',
    type: 'type1',
    ctime: new Date('2026-08-01T00:00:00.000Z'),
    registeredForDustGeneration: true,
  }),
  generateMockUtxoWithMeta({
    intentHash: 'bb'.repeat(32),
    outputNo: 7,
    value: 1n,
    owner: 'owner1',
    type: 'type2',
    ctime: new Date('2026-08-02T12:34:56.000Z'),
    registeredForDustGeneration: false,
  }),
];

const pendingUtxos: readonly UtxoWithMeta[] = [
  generateMockUtxoWithMeta({
    intentHash: 'cc'.repeat(32),
    outputNo: 3,
    value: 9_007_199_254_740_993n, // beyond Number.MAX_SAFE_INTEGER, so a lossy number encoding would show up here
    owner: 'owner1',
    type: 'type1',
    ctime: new Date('2026-08-03T23:59:59.000Z'),
    registeredForDustGeneration: true,
  }),
];

const fundedWallet = (): CoreWallet =>
  CoreWallet.restore(
    UnshieldedState.restore(availableUtxos, pendingUtxos),
    makePublicKey(),
    { appliedId: 42n, highestTransactionId: 99n },
    ProtocolVersion.ProtocolVersion(7n),
    networkId,
  );

describe('V1 unshielded wallet serialization', () => {
  describe('round trip over a wallet holding UTxOs', () => {
    it('carries available and pending UTxOs, both dust-registration states, and values beyond safe-integer range', () => {
      const capability = makeDefaultV1SerializationCapability();
      const wallet = fundedWallet();

      const restored = pipe(capability.deserialize(capability.serialize(wallet)), EitherOps.getOrThrowLeft);
      const before = UnshieldedState.toArrays(wallet.state);
      const after = UnshieldedState.toArrays(restored.state);

      expect(project(after.availableUtxos)).toEqual(project(before.availableUtxos));
      expect(project(after.pendingUtxos)).toEqual(project(before.pendingUtxos));
      // Named separately: an implementation that merged pending into available would still satisfy a combined count.
      expect(after.availableUtxos).toHaveLength(2);
      expect(after.pendingUtxos).toHaveLength(1);
    });

    it('keeps UTxO values as bigints and ctime as a Date', () => {
      const capability = makeDefaultV1SerializationCapability();

      const restored = pipe(capability.deserialize(capability.serialize(fundedWallet())), EitherOps.getOrThrowLeft);
      const [first] = project(UnshieldedState.toArrays(restored.state).availableUtxos);

      expect(typeof first.value).toBe('bigint');
      expect(first.ctime).toBeInstanceOf(Date);
    });

    it('carries the public key triple, protocol version, network and applied id', () => {
      const capability = makeDefaultV1SerializationCapability();
      const wallet = fundedWallet();

      const restored = pipe(capability.deserialize(capability.serialize(wallet)), EitherOps.getOrThrowLeft);

      expect(restored.publicKey).toEqual(wallet.publicKey);
      expect(restored.protocolVersion).toBe(7n);
      expect(restored.networkId).toBe(networkId);
      expect(restored.progress.appliedId).toBe(42n);
    });

    it('rebuilds the highest transaction id from the applied id rather than carrying it', () => {
      // The snapshot holds one index, so the other half of sync progress is reconstructed as `appliedId`. The fixture
      // sets them apart (99 vs 42) to make that visible: a restored wallet believes the chain has nothing newer than
      // the point it stopped at, so its source gap is zero and it reports itself synced until the first sync update
      // arrives. Pinned rather than corrected — whether the field should be persisted is an open call, and this fails
      // the moment someone changes it either way.
      const capability = makeDefaultV1SerializationCapability();
      const wallet = fundedWallet();
      expect(wallet.progress.highestTransactionId).toBe(99n);

      const restored = pipe(capability.deserialize(capability.serialize(wallet)), EitherOps.getOrThrowLeft);

      expect(restored.progress.highestTransactionId).toBe(42n);
      expect(restored.progress.highestTransactionId).toBe(restored.progress.appliedId);
    });

    it('re-serializes to the same snapshot', () => {
      const capability = makeDefaultV1SerializationCapability();

      const first = capability.serialize(fundedWallet());
      const second = pipe(capability.deserialize(first), EitherOps.getOrThrowLeft, (restored) =>
        capability.serialize(restored),
      );

      expect(second).toEqual(first);
    });
  });

  describe('snapshot envelope', () => {
    // The envelope is a cross-release contract: a snapshot written by this SDK line has to be readable by the next one.
    // Pinning every leaf path makes a rename, a dropped field or a re-nesting a failing test rather than a silent read
    // of a default.
    it('pins the field names at every level', () => {
      const capability = makeDefaultV1SerializationCapability();
      const parsed: unknown = JSON.parse(capability.serialize(fundedWallet()));

      expect(Arr.sort(keyPaths(parsed), Order.string)).toEqual(
        Arr.sort(
          [
            'appliedId',
            'networkId',
            'protocolVersion',
            'publicKey.address',
            'publicKey.addressHex',
            'publicKey.publicKey',
            'state.availableUtxos[].meta.ctime',
            'state.availableUtxos[].meta.registeredForDustGeneration',
            'state.availableUtxos[].utxo.intentHash',
            'state.availableUtxos[].utxo.outputNo',
            'state.availableUtxos[].utxo.owner',
            'state.availableUtxos[].utxo.type',
            'state.availableUtxos[].utxo.value',
            'state.pendingUtxos[].meta.ctime',
            'state.pendingUtxos[].meta.registeredForDustGeneration',
            'state.pendingUtxos[].utxo.intentHash',
            'state.pendingUtxos[].utxo.outputNo',
            'state.pendingUtxos[].utxo.owner',
            'state.pendingUtxos[].utxo.type',
            'state.pendingUtxos[].utxo.value',
          ],
          Order.string,
        ),
      );
    });
  });
});
