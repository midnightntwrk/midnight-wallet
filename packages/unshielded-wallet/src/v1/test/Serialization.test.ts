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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either, HashMap, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { generateMockUtxoWithMeta, utxoHash } from './testUtils.js';

const getOrThrow = <E, A>(either: Either.Either<A, E>): A =>
  pipe(
    either,
    Either.getOrThrowWith((e) => new Error(`Unexpected error: ${JSON.stringify(e)}`)),
  );

const publicKey = PublicKey.fromKeyStore(
  createKeystore(Buffer.from(ledger.sampleSigningKey(), 'hex'), NetworkId.NetworkId.Undeployed),
);

const walletWith = (state: UnshieldedState): CoreWallet =>
  CoreWallet.restore(
    state,
    publicKey,
    { appliedId: 7n, highestTransactionId: 7n },
    ProtocolVersion.ProtocolVersion(1n),
    NetworkId.NetworkId.Undeployed,
  );

describe('Unshielded wallet serialization', () => {
  const capability = makeDefaultV1SerializationCapability();

  describe('bookings across a persist/restore cycle', () => {
    it('does not carry a booking across a persist/restore cycle', () => {
      // ADR 0008: a booking is the intent of a caller in this process, and that caller does not survive the restart.
      // The coin comes back owned and spendable, not reserved.
      const booking = {
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      };
      const u = generateMockUtxoWithMeta({ intentHash: 'h-persist', outputNo: 0 });

      const state = pipe(UnshieldedState.restore([u], []), (s) => UnshieldedState.spend(s, u, booking), getOrThrow);

      const restored = pipe(
        walletWith(state),
        (w) => capability.serialize(w),
        (serialized) => capability.deserialize(serialized),
        getOrThrow,
      );

      expect(HashMap.size(restored.state.bookings)).toEqual(0);
      expect(HashMap.has(UnshieldedState.availableUtxos(restored.state), utxoHash(u))).toBe(true);
      expect(HashMap.size(UnshieldedState.pendingUtxos(restored.state))).toEqual(0);
    });

    it('writes no booking detail into the snapshot', () => {
      // A booking is not part of a UTxO's persisted facts. The snapshot still lists a booked coin under pendingUtxos,
      // which an older reader understands, but carries nothing about the reservation itself.
      const u = generateMockUtxoWithMeta({ intentHash: 'h-detail', outputNo: 0 });
      const state = pipe(
        UnshieldedState.restore([u], []),
        (s) =>
          UnshieldedState.spend(s, u, {
            expiresAt: new Date('2026-01-01T01:00:00.000Z'),
          }),
        getOrThrow,
      );

      const snapshot = JSON.parse(capability.serialize(walletWith(state))) as {
        state: { pendingUtxos: { meta: Record<string, unknown> }[] };
      };

      expect(snapshot.state.pendingUtxos[0].meta).not.toHaveProperty('booking');
    });

    it('deserializes a snapshot whose pending utxo predates bookings', () => {
      // Snapshots written by an earlier SDK version have no booking field at all. They must still load, and the coin
      // they recorded as pending comes back owned and spendable like any other.
      const legacy = JSON.stringify({
        publicKey,
        state: {
          availableUtxos: [],
          pendingUtxos: [
            {
              utxo: {
                value: '3000000000',
                owner: publicKey.addressHex,
                type: 'night',
                intentHash: '421c4146',
                outputNo: 0,
              },
              meta: { ctime: '2026-01-01T00:00:00.000Z', registeredForDustGeneration: false },
            },
          ],
        },
        protocolVersion: '1',
        appliedId: '7',
        networkId: NetworkId.NetworkId.Undeployed,
      });

      const restored = pipe(capability.deserialize(legacy), getOrThrow);

      expect(HashMap.has(UnshieldedState.availableUtxos(restored.state), '421c4146#0')).toBe(true);
      expect(HashMap.size(restored.state.bookings)).toEqual(0);
    });

    it('repairs a snapshot holding the same utxo in both maps', () => {
      // The exact persisted shape reported in the issue: one intentHash+outputNo in availableUtxos and in
      // pendingUtxos at once, which every balance accessor then counts twice.
      const duplicated = {
        utxo: { value: '3000000000', owner: publicKey.addressHex, type: 'night', intentHash: '421c4146', outputNo: 0 },
        meta: { ctime: '2026-01-01T00:00:00.000Z', registeredForDustGeneration: false },
      };
      const corrupted = JSON.stringify({
        publicKey,
        state: { availableUtxos: [duplicated], pendingUtxos: [duplicated] },
        protocolVersion: '1',
        appliedId: '7',
        networkId: NetworkId.NetworkId.Undeployed,
      });

      const restored = pipe(capability.deserialize(corrupted), getOrThrow);

      // One coin, once, spendable: the two arrays union into a map keyed by intentHash#outputNo, so the duplicate
      // cannot survive decoding and there is no booking left to hold it back.
      expect(HashMap.size(restored.state.utxos)).toEqual(1);
      expect(HashMap.has(UnshieldedState.availableUtxos(restored.state), '421c4146#0')).toBe(true);
      expect(HashMap.size(restored.state.bookings)).toEqual(0);
    });
  });
});
