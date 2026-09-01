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
import { Either, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { UnshieldedState } from '../UnshieldedState.js';
import { generateMockUtxoWithMeta } from './testUtils.js';

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
    { appliedId: 0n, highestTransactionId: 0n },
    ProtocolVersion.ProtocolVersion(1n),
    NetworkId.NetworkId.Undeployed,
  );

describe('Unshielded wallet coins and balances', () => {
  const capability = makeDefaultCoinsAndBalancesCapability();

  // `pendingCoins` shows which coins are booked but nothing about the booking itself, so a consumer holding an
  // outstanding booking has no way to tell that it is outstanding. `getBookings` reports the reservation alongside the
  // coin, so a caller can spot one whose expiry has passed and release it with `facade.revert`.
  describe('getBookings', () => {
    const booking = {
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    };

    it('reports no bookings when nothing is booked', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-api-none', outputNo: 0 });

      expect(capability.getBookings(walletWith(UnshieldedState.restore([u], [])))).toEqual([]);
    });

    it('reports the booked coin together with its reservation', () => {
      const u = generateMockUtxoWithMeta({ intentHash: 'h-api-one', outputNo: 0, value: 3000n });
      const state = getOrThrow(UnshieldedState.spend(UnshieldedState.restore([u], []), u, booking));

      const bookings = capability.getBookings(walletWith(state));

      expect(bookings.length).toEqual(1);
      expect(bookings[0].utxo.utxo.intentHash).toEqual('h-api-one');

      expect(bookings[0].expiresAt).toEqual(booking.expiresAt);
    });

    it('reports nothing for a snapshot that recorded a coin as pending', () => {
      // A booking does not survive a restart (ADR 0008), so a restored coin is never reported as booked and both dates
      // on a Booking are always present.
      const legacy = generateMockUtxoWithMeta({ intentHash: 'h-api-legacy', outputNo: 0 });

      expect(capability.getBookings(walletWith(UnshieldedState.restore([], [legacy])))).toEqual([]);
    });
  });
});
