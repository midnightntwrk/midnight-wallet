/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DateTime, HashSet, Order, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import * as PendingTransactions from '../pendingTransactions.js';

type FakeTransaction = Readonly<{ ids: readonly string[] }>;

const txTrait: PendingTransactions.TransactionTrait<FakeTransaction> = {
  isTx: (data): data is FakeTransaction => typeof data === 'object' && data !== null && 'ids' in data,
  serialize: (tx) => Buffer.from(JSON.stringify(tx), 'utf-8'),
  deserialize: (bytes) => JSON.parse(Buffer.from(bytes).toString('utf-8')) as FakeTransaction,
  ids: (tx) => tx.ids,
  firstId: (tx) => tx.ids[0],
  areAllTxIdsIncluded: (tx, ids) => tx.ids.every((id) => ids.includes(id)),
  isOneIncludedInOther: (tx, otherTx) => {
    const a = HashSet.fromIterable(tx.ids);
    const b = HashSet.fromIterable(otherTx.ids);
    const smaller = Order.min(Order.number)(HashSet.size(a), HashSet.size(b));
    return HashSet.size(HashSet.intersection(a, b)) === smaller;
  },
  hasTTLExpired: () => false,
};

const at = (iso: string): DateTime.Utc => DateTime.unsafeMake(iso);

const TTL = new Date('2026-01-01T01:00:00.000Z');
const CREATED_AT = at('2026-01-01T00:00:00.000Z');

const reservation = (overrides: Partial<PendingTransactions.Reservation> = {}): PendingTransactions.Reservation => ({
  identifiers: ['id-a'],
  intentHashes: ['intent-a'],
  inputs: { unshielded: ['4b0f#0'] },
  ttl: TTL,
  createdAt: CREATED_AT,
  expired: false,
  ...overrides,
});

describe('Reservations', () => {
  // A reservation records a transaction that has been balanced but not yet proven: its identifiers, the coins it
  // booked, and when the ledger stops accepting it. It never holds the transaction itself, which carries key material.
  const empty = PendingTransactions.empty<FakeTransaction>();

  describe('adding and clearing', () => {
    it('starts with none', () => {
      expect(empty.reservations).toEqual([]);
    });

    it('keeps a reservation without touching the tracked transactions', () => {
      const state = PendingTransactions.addReservation(empty, reservation());

      expect(state.reservations).toEqual([reservation()]);
      expect(state.all).toEqual([]);
    });

    it('replaces one that shares an identifier, so re-balancing does not double up', () => {
      const first = reservation({ inputs: { unshielded: ['4b0f#0'] } });
      const second = reservation({ inputs: { unshielded: ['4b0f#1'] } });

      const state = pipe(PendingTransactions.addReservation(empty, first), (s) =>
        PendingTransactions.addReservation(s, second),
      );

      expect(state.reservations).toEqual([second]);
    });

    it('keeps reservations that share no identifier', () => {
      const mine = reservation({ identifiers: ['id-a'] });
      const other = reservation({ identifiers: ['id-b'] });

      const state = pipe(PendingTransactions.addReservation(empty, mine), (s) =>
        PendingTransactions.addReservation(s, other),
      );

      expect(state.reservations).toEqual([mine, other]);
    });

    it('clears the reservation holding a given identifier', () => {
      const mine = reservation({ identifiers: ['id-a'] });
      const other = reservation({ identifiers: ['id-b'] });
      const state = pipe(PendingTransactions.addReservation(empty, mine), (s) =>
        PendingTransactions.addReservation(s, other),
      );

      const cleared = PendingTransactions.clearReservation(state, ['id-a']);

      expect(cleared.reservations).toEqual([other]);
    });

    it('ignores an identifier no reservation holds', () => {
      const state = PendingTransactions.addReservation(empty, reservation());

      expect(PendingTransactions.clearReservation(state, ['id-unknown']).reservations).toEqual([reservation()]);
    });
  });

  describe('expiry', () => {
    it('marks a reservation the ledger would no longer accept', () => {
      const state = PendingTransactions.addReservation(empty, reservation());

      const expired = PendingTransactions.expireReservations(state, at('2026-01-01T01:00:00.001Z'));

      expect(expired.reservations).toEqual([reservation({ expired: true })]);
    });

    it('marks one at exactly its expiry, since the ledger rejects it from that instant', () => {
      const state = PendingTransactions.addReservation(empty, reservation());

      const expired = PendingTransactions.expireReservations(state, at('2026-01-01T01:00:00.000Z'));

      expect(expired.reservations).toEqual([reservation({ expired: true })]);
    });

    it('leaves one a millisecond short of its expiry', () => {
      const state = PendingTransactions.addReservation(empty, reservation());

      const swept = PendingTransactions.expireReservations(state, at('2026-01-01T00:59:59.999Z'));

      expect(swept.reservations).toEqual([reservation({ expired: false })]);
    });

    it('reports only the expired ones, which is what a caller releases coins for', () => {
      const stale = reservation({ identifiers: ['id-stale'], ttl: new Date('2026-01-01T00:30:00.000Z') });
      const live = reservation({ identifiers: ['id-live'], ttl: new Date('2026-01-01T02:00:00.000Z') });
      const state = pipe(PendingTransactions.addReservation(empty, stale), (s) =>
        PendingTransactions.addReservation(s, live),
      );

      const swept = PendingTransactions.expireReservations(state, at('2026-01-01T01:00:00.000Z'));

      expect(PendingTransactions.allExpiredReservations(swept)).toEqual([{ ...stale, expired: true }]);
    });
  });

  describe('giving way to the transaction itself', () => {
    // Once the full transaction is tracked, the reservation standing in for it is redundant: the transaction carries
    // the same identifiers and its own expiry, and the release paths already act on it.
    it('drops a reservation when a transaction sharing an identifier is added', () => {
      const state = PendingTransactions.addReservation(empty, reservation({ identifiers: ['id-a'] }));

      const withTx = PendingTransactions.addPendingTransaction(
        state,
        { ids: ['id-a', 'id-extra'] },
        CREATED_AT,
        txTrait,
      );

      expect(withTx.reservations).toEqual([]);
      expect(withTx.all).toHaveLength(1);
    });

    it('leaves a reservation the transaction has nothing to do with', () => {
      const mine = reservation({ identifiers: ['id-a'] });
      const state = PendingTransactions.addReservation(empty, mine);

      const withTx = PendingTransactions.addPendingTransaction(state, { ids: ['id-other'] }, CREATED_AT, txTrait);

      expect(withTx.reservations).toEqual([mine]);
    });

    it('drops a reservation when the transaction sharing its identifier is cleared', () => {
      // Clearing happens on an explicit revert and on a confirmed spend; either way the coins are no longer reserved.
      const state = PendingTransactions.addReservation(empty, reservation({ identifiers: ['id-a'] }));

      const cleared = PendingTransactions.clear(state, { ids: ['id-a'] }, txTrait);

      expect(cleared.reservations).toEqual([]);
    });
  });
});
