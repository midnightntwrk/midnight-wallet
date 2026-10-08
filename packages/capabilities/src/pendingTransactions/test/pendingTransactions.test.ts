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

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DateTime, Either, HashSet, Order, Option, pipe, Schema } from 'effect';
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

const traits = PendingTransactions.singleTrait(txTrait);

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

    it('leaves one at exactly its expiry, since a block stamped with that instant still accepts it', () => {
      const state = PendingTransactions.addReservation(empty, reservation());

      const swept = PendingTransactions.expireReservations(state, at('2026-01-01T01:00:00.000Z'));

      expect(swept.reservations).toEqual([reservation()]);
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
        traits,
        Option.none(),
      );

      expect(withTx.reservations).toEqual([]);
      expect(withTx.all).toHaveLength(1);
    });

    it('leaves a reservation the transaction has nothing to do with', () => {
      const mine = reservation({ identifiers: ['id-a'] });
      const state = PendingTransactions.addReservation(empty, mine);

      const withTx = PendingTransactions.addPendingTransaction(
        state,
        { ids: ['id-other'] },
        CREATED_AT,
        traits,
        Option.none(),
      );

      expect(withTx.reservations).toEqual([mine]);
    });

    it('drops a reservation when the transaction sharing its identifier is cleared', () => {
      // Clearing happens on an explicit revert and on a confirmed spend; either way the coins are no longer reserved.
      const state = PendingTransactions.addReservation(empty, reservation({ identifiers: ['id-a'] }));

      const cleared = PendingTransactions.clear(state, { ids: ['id-a'] }, traits);

      expect(cleared.reservations).toEqual([]);
    });
  });

  describe('persistence', () => {
    const withOneOfEach = pipe(
      PendingTransactions.addPendingTransaction(empty, { ids: ['id-tx'] }, CREATED_AT, traits, Option.none()),
      (s) => PendingTransactions.addReservation(s, reservation({ identifiers: ['id-reserved'] })),
    );

    const roundTrip = (state: PendingTransactions.PendingTransactions<FakeTransaction>) =>
      PendingTransactions.deserialize<FakeTransaction>(PendingTransactions.serialize(state, traits), traits);

    it('brings a reservation back with every field it was stored with', () => {
      // A reservation is the only record that a coin is spoken for, so losing one on restart strands that coin.
      const restored = roundTrip(withOneOfEach);

      expect(Either.getOrThrow(restored).reservations).toEqual([reservation({ identifiers: ['id-reserved'] })]);
    });

    it('still brings back the tracked transactions', () => {
      const restored = Either.getOrThrow(roundTrip(withOneOfEach));

      expect(restored.all.map((item) => item.tx)).toEqual([{ ids: ['id-tx'] }]);
    });

    it('reads a snapshot written before reservations existed, with none of them', () => {
      // Such a snapshot records transactions only; a wallet restoring it has no reservations to speak of.
      const v1 = JSON.stringify({
        version: 'v1',
        transactions: [
          {
            tx: Buffer.from(JSON.stringify({ ids: ['id-old'] }), 'utf-8').toString('hex'),
            creationTime: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      const restored = Either.getOrThrow(PendingTransactions.deserialize<FakeTransaction>(v1, traits));

      expect(restored.all.map((item) => item.tx)).toEqual([{ ids: ['id-old'] }]);
      expect(restored.reservations).toEqual([]);
    });

    it('refuses a snapshot whose version it does not know', () => {
      const unknown = JSON.stringify({ version: 'v99', transactions: [] });

      expect(Either.isLeft(PendingTransactions.deserialize<FakeTransaction>(unknown, traits))).toBe(true);
    });
  });
});

describe('Coins a spend still accounts for', () => {
  // Restored bookings are released once sync reaches the tip, and this is the set that survives that release. A
  // reservation covers a transaction that was never submitted; a tracked transaction covers one that was, because
  // registering it drops the reservation standing in for it. Either alone leaves half the window open.
  const empty = PendingTransactions.empty<FakeTransaction>();
  const unshieldedInputsOf = (tx: FakeTransaction): readonly string[] => tx.ids.map((id) => `${id}#0`);

  it('covers the coins of a reservation, for a transaction never submitted', () => {
    const state = PendingTransactions.addReservation(empty, reservation({ inputs: { unshielded: ['4b0f#0'] } }));

    expect(PendingTransactions.coveredUnshieldedIds(state, unshieldedInputsOf)).toEqual(['4b0f#0']);
  });

  it('covers the coins of a tracked transaction, whose reservation registering it dropped', () => {
    const submitted: FakeTransaction = { ids: ['4b0f'] };
    const state = PendingTransactions.addPendingTransaction(empty, submitted, CREATED_AT, traits, Option.none());

    expect(state.reservations).toEqual([]);
    expect(PendingTransactions.coveredUnshieldedIds(state, unshieldedInputsOf)).toEqual(['4b0f#0']);
  });

  it('covers both at once, without repeating a coin two of them name', () => {
    const shared = PendingTransactions.addReservation(
      empty,
      reservation({ identifiers: ['other'], inputs: { unshielded: ['4b0f#0', 'aa11#0'] } }),
    );
    const state = PendingTransactions.addPendingTransaction(
      shared,
      { ids: ['4b0f'] },
      CREATED_AT,
      traits,
      Option.none(),
    );

    expect([...PendingTransactions.coveredUnshieldedIds(state, unshieldedInputsOf)].toSorted()).toEqual([
      '4b0f#0',
      'aa11#0',
    ]);
  });

  it('covers nothing when nothing is tracked and nothing is reserved', () => {
    expect(PendingTransactions.coveredUnshieldedIds(empty, unshieldedInputsOf)).toEqual([]);
  });
});

describe('Staying readable by an older reader', () => {
  // Reservations were added to a format that was already in the field. Adding them as an optional member of the same
  // version, rather than a new one, keeps a store written here readable by a package version that predates them: it
  // sees the version it knows and ignores the member it does not.
  const empty = PendingTransactions.empty<FakeTransaction>();

  /** The schema as it stood before reservations existed, which is what an older reader applies. */
  const olderReaderSchema = Schema.Struct({
    version: Schema.Literal('v1'),
    transactions: Schema.Array(Schema.Struct({ tx: Schema.Uint8ArrayFromHex, creationTime: Schema.DateTimeUtc })),
  });

  it('writes a snapshot an older reader still accepts', () => {
    const state = pipe(
      PendingTransactions.addPendingTransaction(empty, { ids: ['id-a'] }, CREATED_AT, traits, Option.none()),
      (s) => PendingTransactions.addReservation(s, reservation()),
    );

    const written: unknown = JSON.parse(PendingTransactions.serialize(state, traits));

    expect(Either.isRight(Schema.decodeUnknownEither(olderReaderSchema)(written))).toBe(true);
  });

  it('round-trips the reservations for a reader that does know them', () => {
    const state = PendingTransactions.addReservation(empty, reservation());

    const restored = Either.getOrThrow(
      PendingTransactions.deserialize<FakeTransaction>(PendingTransactions.serialize(state, traits), traits),
    );

    expect(restored.reservations).toEqual([reservation()]);
  });
});

describe('Sweeping when nothing has changed', () => {
  // The sweep runs on a timer, so it visits a state where nothing has expired far more often than one where something
  // has. Handing back the state it was given, rather than a rebuilt copy, is what lets a caller tell the two apart.
  const empty = PendingTransactions.empty<FakeTransaction>();

  it('hands back the very same state when no reservation reaches its expiry', () => {
    const state = PendingTransactions.addReservation(empty, reservation());

    expect(PendingTransactions.expireReservations(state, at('2026-01-01T00:30:00.000Z'))).toBe(state);
  });

  it('hands back the very same state when every reservation is already expired', () => {
    const state = PendingTransactions.addReservation(empty, reservation({ expired: true }));

    expect(PendingTransactions.expireReservations(state, at('2026-01-01T02:00:00.000Z'))).toBe(state);
  });

  it('hands back the very same state when there are no reservations at all', () => {
    expect(PendingTransactions.expireReservations(empty, at('2026-01-01T02:00:00.000Z'))).toBe(empty);
  });

  it('builds a new state when a reservation does reach its expiry', () => {
    const state = PendingTransactions.addReservation(empty, reservation());

    const swept = PendingTransactions.expireReservations(state, at('2026-01-01T01:00:00.001Z'));

    expect(swept).not.toBe(state);
    expect(swept.reservations).toEqual([reservation({ expired: true })]);
  });
});

describe('Reservations across a two-version trait registry', () => {
  // A fork-aware wallet registers one trait per ledger version, and a transaction is identified by the trait that
  // recognises it, never by the version the chain has reached. A reservation records the identifiers that trait reads,
  // so finding the reservation a transaction stands for must ask the recognising trait too: asking the trait for the
  // chain's version would read nothing from a ledger-v8 transaction the wallet tracks from `forks.v9`, and leave its
  // reservation holding coins the transaction already accounts for.
  type LedgerTx = Readonly<{ ledger: 'v8' | 'v9' | 'v10'; ids: readonly string[] }>;

  /** A trait that reads only its own ledger's transactions, and reads no identifiers from anything else. */
  const ledgerTrait = (ledger: LedgerTx['ledger']): PendingTransactions.TransactionTrait<LedgerTx> => {
    const owns = (tx: LedgerTx): boolean => tx.ledger === ledger;
    return {
      isTx: (data): data is LedgerTx =>
        typeof data === 'object' && data !== null && 'ledger' in data && 'ids' in data && data.ledger === ledger,
      serialize: (tx) => Buffer.from(JSON.stringify(tx), 'utf-8'),
      deserialize: (bytes) => JSON.parse(Buffer.from(bytes).toString('utf-8')) as LedgerTx,
      ids: (tx) => (owns(tx) ? tx.ids : []),
      firstId: (tx) => tx.ids[0],
      areAllTxIdsIncluded: (tx, ids) => owns(tx) && tx.ids.every((id) => ids.includes(id)),
      isOneIncludedInOther: (tx, otherTx) =>
        owns(tx) &&
        owns(otherTx) &&
        (tx.ids.every((id) => otherTx.ids.includes(id)) || otherTx.ids.every((id) => tx.ids.includes(id))),
      hasTTLExpired: () => false,
    };
  };

  const V9_FORK = ProtocolVersion.ProtocolVersion(2_000_000n);
  const V8_VERSION = ProtocolVersion.ProtocolVersion(1_000n);
  const V9_VERSION = ProtocolVersion.ProtocolVersion(2_000_001n);

  const twoVersionTraits: PendingTransactions.VersionedTransactionTrait<LedgerTx> = Either.getOrThrow(
    ProtocolVersion.makeRegistryFromActivations([
      { sinceVersion: ProtocolVersion.MinSupportedVersion, value: ledgerTrait('v8') },
      { sinceVersion: V9_FORK, value: ledgerTrait('v9') },
    ]),
  );

  const empty = PendingTransactions.empty<LedgerTx>();
  const v8Tx: LedgerTx = { ledger: 'v8', ids: ['v8-id'] };
  const v9Tx: LedgerTx = { ledger: 'v9', ids: ['v9-id'] };

  it('clears the reservation of a ledger-v8 transaction when that transaction is registered while the chain is from forks.v9', () => {
    const state = PendingTransactions.addReservation(empty, reservation({ identifiers: v8Tx.ids }));

    const withTx = PendingTransactions.addPendingTransaction(
      state,
      v8Tx,
      CREATED_AT,
      twoVersionTraits,
      Option.some(V9_VERSION),
    );

    expect(withTx.reservations).toEqual([]);
    expect(withTx.all.map((item) => item.tx)).toEqual([v8Tx]);
  });

  it('clears the reservation and the tracked ledger-v8 transaction when that transaction is cleared', () => {
    const state = pipe(
      PendingTransactions.addPendingTransaction(empty, v8Tx, CREATED_AT, twoVersionTraits, Option.some(V8_VERSION)),
      (s) => PendingTransactions.addReservation(s, reservation({ identifiers: v8Tx.ids })),
    );

    const cleared = PendingTransactions.clear(state, v8Tx, twoVersionTraits);

    expect(cleared.reservations).toEqual([]);
    expect(cleared.all).toEqual([]);
  });

  it('expires reservations by TTL alone, whichever trait would recognise their transactions', () => {
    // A reservation past its TTL stands for a transaction the ledger will no longer accept, under either ledger
    // version, so the sweep has no reason to know which trait reads it.
    const v8Reservation = reservation({ identifiers: v8Tx.ids, inputs: { unshielded: ['v8-coin#0'] } });
    const v9Reservation = reservation({ identifiers: v9Tx.ids, inputs: { unshielded: ['v9-coin#0'] } });
    const state = pipe(PendingTransactions.addReservation(empty, v8Reservation), (s) =>
      PendingTransactions.addReservation(s, v9Reservation),
    );

    const swept = PendingTransactions.expireReservations(state, at('2026-01-01T01:00:00.001Z'));

    expect(PendingTransactions.allExpiredReservations(swept)).toEqual([
      { ...v8Reservation, expired: true },
      { ...v9Reservation, expired: true },
    ]);
  });

  it('keeps a reservation when the transaction registered is one no trait in the registry recognises', () => {
    // A transaction no registered trait owns has no identifiers the wallet can read, so it cannot be the spend any
    // reservation stands for — even one whose recorded identifiers it happens to carry. The transaction itself is
    // still tracked: registering refuses nothing.
    const unrecognised: LedgerTx = { ledger: 'v10', ids: ['shared-id'] };
    const held = reservation({ identifiers: ['shared-id'] });
    const state = PendingTransactions.addReservation(empty, held);

    const withTx = PendingTransactions.addPendingTransaction(
      state,
      unrecognised,
      CREATED_AT,
      twoVersionTraits,
      Option.some(V9_VERSION),
    );

    expect(withTx.reservations).toEqual([held]);
    expect(withTx.all.map((item) => item.tx)).toEqual([unrecognised]);
  });
});
