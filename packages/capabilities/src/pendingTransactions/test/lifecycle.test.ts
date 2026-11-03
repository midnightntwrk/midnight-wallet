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
import { DateTime, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Lifecycle from '../lifecycle.js';
import type * as PendingTransactions from '../pendingTransactions.js';

/** A transaction is anything the facade can name; its form at each state is the facade's to choose. */
type FakeTransaction = Readonly<{ form: 'erased' | 'finalized'; ids: readonly string[] }>;

const at = (iso: string): DateTime.Utc => DateTime.unsafeMake(iso);

const BALANCED_AT = at('2026-01-01T00:00:00.000Z');
const FINALIZED_AT = at('2026-01-01T00:01:00.000Z');
const SUBMITTED_AT = at('2026-01-01T00:02:00.000Z');
const TTL = new Date('2026-01-01T01:00:00.000Z');
const V8 = ProtocolVersion.ProtocolVersion(3n);

const facts = (
  form: FakeTransaction['form'],
  ids: readonly string[],
  overrides: Partial<Lifecycle.TransactionFacts<FakeTransaction>> = {},
): Lifecycle.TransactionFacts<FakeTransaction> => ({
  tx: { form, ids },
  identifiers: ids,
  intentHashes: ids.map((id) => `intent-${id}`),
  inputs: { unshielded: ids.map((id) => `${id}#0`) },
  ttl: TTL,
  protocolVersion: V8,
  ...overrides,
});

/** The record the facts describe, as it stands in `state` since `createdAt`, submitted at `submittedAt` if ever. */
const recordOf = (
  given: Lifecycle.TransactionFacts<FakeTransaction>,
  createdAt: DateTime.Utc,
  state: Lifecycle.LifecycleState,
  submittedAt: Option.Option<DateTime.Utc> = Option.none(),
): Lifecycle.LifecycleRecord<FakeTransaction> => ({
  identifiers: given.identifiers,
  intentHashes: given.intentHashes,
  inputs: given.inputs,
  ttl: given.ttl,
  protocolVersion: Option.some(given.protocolVersion),
  tx: Option.some(given.tx),
  createdAt,
  submittedAt,
  state,
});

const empty = Lifecycle.empty<FakeTransaction>();

describe('A transaction moving from balanced to submitted', () => {
  it('should record a balanced transaction with its erased form, its own version and its TTL', () => {
    const erased = facts('erased', ['id-a']);

    const state = Lifecycle.balanced(empty, erased, BALANCED_AT);

    expect(state.records).toStrictEqual([recordOf(erased, BALANCED_AT, Lifecycle.LifecycleState.Balanced())]);
  });

  it('should replace a balanced record sharing an identifier, because balancing the same spend again supersedes it', () => {
    const first = facts('erased', ['id-a']);
    const again = facts('erased', ['id-a', 'id-b']);
    const later = at('2026-01-01T00:00:30.000Z');

    const state = Lifecycle.balanced(Lifecycle.balanced(empty, first, BALANCED_AT), again, later);

    expect(state.records).toStrictEqual([recordOf(again, later, Lifecycle.LifecycleState.Balanced())]);
  });

  it('should move a balanced record to finalized, storing the finalized form and keeping when the record began', () => {
    const final = facts('finalized', ['id-a']);

    const state = Lifecycle.finalized(
      Lifecycle.balanced(empty, facts('erased', ['id-a']), BALANCED_AT),
      final,
      FINALIZED_AT,
    );

    expect(state.records).toStrictEqual([recordOf(final, BALANCED_AT, Lifecycle.LifecycleState.Finalized())]);
  });

  it('should begin a record at finalized for a transaction the facade did not balance', () => {
    const final = facts('finalized', ['id-a']);

    const state = Lifecycle.finalized(empty, final, FINALIZED_AT);

    expect(state.records).toStrictEqual([recordOf(final, FINALIZED_AT, Lifecycle.LifecycleState.Finalized())]);
  });

  it('should fold every record the finalized transaction covers into one, because merging parts makes one transaction', () => {
    const balancing = Lifecycle.balanced(empty, facts('erased', ['id-a']), BALANCED_AT);
    const both = Lifecycle.finalized(balancing, facts('finalized', ['id-b']), FINALIZED_AT);
    const merged = facts('finalized', ['id-a', 'id-b']);
    const mergedAt = at('2026-01-01T00:01:30.000Z');

    const state = Lifecycle.finalized(both, merged, mergedAt);

    expect(state.records).toStrictEqual([recordOf(merged, BALANCED_AT, Lifecycle.LifecycleState.Finalized())]);
  });

  it('should move a finalized record to submitted at the time it was submitted, not the time it was finalized', () => {
    const final = facts('finalized', ['id-a']);

    const state = Lifecycle.submitted(Lifecycle.finalized(empty, final, FINALIZED_AT), final, SUBMITTED_AT);

    expect(state.records).toStrictEqual([
      recordOf(final, FINALIZED_AT, Lifecycle.LifecycleState.Submitted(), Option.some(SUBMITTED_AT)),
    ]);
  });

  it('should move a balanced record straight to submitted, for a transaction proven outside the facade', () => {
    const final = facts('finalized', ['id-a']);

    const state = Lifecycle.submitted(
      Lifecycle.balanced(empty, facts('erased', ['id-a']), BALANCED_AT),
      final,
      SUBMITTED_AT,
    );

    expect(state.records).toStrictEqual([
      recordOf(final, BALANCED_AT, Lifecycle.LifecycleState.Submitted(), Option.some(SUBMITTED_AT)),
    ]);
  });

  it('should begin a record at submitted for an adopted transaction', () => {
    const final = facts('finalized', ['id-a']);

    const state = Lifecycle.submitted(empty, final, SUBMITTED_AT);

    expect(state.records).toStrictEqual([
      recordOf(final, SUBMITTED_AT, Lifecycle.LifecycleState.Submitted(), Option.some(SUBMITTED_AT)),
    ]);
  });

  it('should leave every record that shares no identifier as it was', () => {
    const other = facts('erased', ['id-other']);
    const state = Lifecycle.finalized(
      Lifecycle.balanced(Lifecycle.balanced(empty, other, BALANCED_AT), facts('erased', ['id-a']), BALANCED_AT),
      facts('finalized', ['id-a']),
      FINALIZED_AT,
    );

    expect(state.records).toContainEqual(recordOf(other, BALANCED_AT, Lifecycle.LifecycleState.Balanced()));
    expect(state.records).toHaveLength(2);
  });

  it('should keep the version the transaction was built for at every state, never another', () => {
    const v9 = ProtocolVersion.ProtocolVersion(ProtocolVersion.V9NativeForkVersion + 1n);
    const final = facts('finalized', ['id-a'], { protocolVersion: v9 });

    const state = Lifecycle.submitted(
      Lifecycle.finalized(
        Lifecycle.balanced(empty, facts('erased', ['id-a'], { protocolVersion: v9 }), BALANCED_AT),
        final,
        FINALIZED_AT,
      ),
      final,
      SUBMITTED_AT,
    );

    expect(state.records.map((record) => record.protocolVersion)).toStrictEqual([Option.some(v9)]);
  });
});

const FORK = ProtocolVersion.V9NativeForkVersion;
const V9 = ProtocolVersion.ProtocolVersion(FORK + 1n);
const EPOCHS: ProtocolVersion.Registry<string> = {
  entries: [
    { range: ProtocolVersion.makeRange(ProtocolVersion.MinSupportedVersion, FORK), value: 'ledger-v8' },
    { range: ProtocolVersion.makeRange(FORK, ProtocolVersion.MaxSupportedVersion), value: 'ledger-v9' },
  ],
};
const REFUSED: PendingTransactions.FailedTransactionResult = {
  status: 'FAILURE',
  segments: [{ id: 0, success: false }],
};

/** A store holding one record of `id-a`, already in `state`. */
const holding = (
  state: Lifecycle.LifecycleState,
  overrides: Partial<Lifecycle.LifecycleRecord<FakeTransaction>> = {},
): Lifecycle.TransactionLifecycle<FakeTransaction> => ({
  records: [{ ...recordOf(facts('finalized', ['id-a']), BALANCED_AT, state), ...overrides }],
});

const LIVE_STATES: ReadonlyArray<Lifecycle.LifecycleState> = [
  Lifecycle.LifecycleState.Balanced(),
  Lifecycle.LifecycleState.Finalized(),
  Lifecycle.LifecycleState.Submitted(),
];

const FINAL_STATES: ReadonlyArray<Lifecycle.LifecycleState> = [
  Lifecycle.LifecycleState.Confirmed(),
  Lifecycle.LifecycleState.Rejected({ verdict: REFUSED }),
  Lifecycle.LifecycleState.Orphaned({ authoredFor: V8, chainNow: V9 }),
  Lifecycle.LifecycleState.Expired(),
  Lifecycle.LifecycleState.Reverted(),
];

/** The record in a one-record store, in its new state and otherwise as it was. */
const nowIn = (
  before: Lifecycle.TransactionLifecycle<FakeTransaction>,
  state: Lifecycle.LifecycleState,
): ReadonlyArray<Lifecycle.LifecycleRecord<FakeTransaction>> => before.records.map((record) => ({ ...record, state }));

describe('A transaction reaching its outcome', () => {
  it.each(LIVE_STATES)('should confirm a $_tag record once it is included, because inclusion is a fact', (live) => {
    const before = holding(live);

    expect(Lifecycle.confirmed(before, ['id-a']).records).toStrictEqual(
      nowIn(before, Lifecycle.LifecycleState.Confirmed()),
    );
  });

  it('should reject a submitted record with the verdict the chain reported', () => {
    const before = holding(Lifecycle.LifecycleState.Submitted());

    expect(Lifecycle.rejected(before, ['id-a'], REFUSED).records).toStrictEqual(
      nowIn(before, Lifecycle.LifecycleState.Rejected({ verdict: REFUSED })),
    );
  });

  it.each(LIVE_STATES.slice(0, 2))(
    'should leave a $_tag record as it was on a rejection, because no chain was asked to include it',
    (unsubmitted) => {
      const before = holding(unsubmitted);

      expect(Lifecycle.rejected(before, ['id-a'], REFUSED)).toStrictEqual(before);
    },
  );

  it.each(LIVE_STATES)('should orphan a $_tag record built for an epoch the chain has left', (live) => {
    const before = holding(live);

    expect(Lifecycle.orphanBeyond(before, EPOCHS, V9).records).toStrictEqual(
      nowIn(before, Lifecycle.LifecycleState.Orphaned({ authoredFor: V8, chainNow: V9 })),
    );
  });

  it('should leave a record of the epoch the chain is in as it was', () => {
    const before = holding(Lifecycle.LifecycleState.Submitted(), {
      protocolVersion: Option.some(V9),
    });

    expect(Lifecycle.orphanBeyond(before, EPOCHS, V9)).toStrictEqual(before);
  });

  it('should never orphan a record whose version was never known, because that is no evidence it was left behind', () => {
    const before = holding(Lifecycle.LifecycleState.Balanced(), { protocolVersion: Option.none(), tx: Option.none() });

    expect(Lifecycle.orphanBeyond(before, EPOCHS, V9)).toStrictEqual(before);
  });

  it.each(LIVE_STATES)('should revert a $_tag record', (live) => {
    const before = holding(live);

    expect(Lifecycle.reverted(before, ['id-a']).records).toStrictEqual(
      nowIn(before, Lifecycle.LifecycleState.Reverted()),
    );
  });

  it('should move only the records that share an identifier with the transaction', () => {
    const other = recordOf(facts('finalized', ['id-other']), BALANCED_AT, Lifecycle.LifecycleState.Submitted());
    const before: Lifecycle.TransactionLifecycle<FakeTransaction> = {
      records: [...holding(Lifecycle.LifecycleState.Submitted()).records, other],
    };

    expect(Lifecycle.confirmed(before, ['id-a']).records).toContainEqual(other);
    expect(Lifecycle.reverted(before, ['id-a']).records).toContainEqual(other);
    expect(Lifecycle.rejected(before, ['id-a'], REFUSED).records).toContainEqual(other);
  });
});

describe('A transaction in a final state', () => {
  const events: ReadonlyArray<
    readonly [
      string,
      (state: Lifecycle.TransactionLifecycle<FakeTransaction>) => Lifecycle.TransactionLifecycle<FakeTransaction>,
    ]
  > = [
    ['a rejection', (state) => Lifecycle.rejected(state, ['id-a'], REFUSED)],
    ['a fork crossing', (state) => Lifecycle.orphanBeyond(state, EPOCHS, V9)],
    ['a revert', (state) => Lifecycle.reverted(state, ['id-a'])],
    ['finalizing it', (state) => Lifecycle.finalized(state, facts('finalized', ['id-a']), FINALIZED_AT)],
    ['submitting it', (state) => Lifecycle.submitted(state, facts('finalized', ['id-a']), SUBMITTED_AT)],
  ];

  it.each(FINAL_STATES.flatMap((final) => events.map(([event, apply]) => [final._tag, event, final, apply] as const)))(
    'should stay %s after %s, because a final state never moves',
    (_tag, _event, final, apply) => {
      const before = holding(final);

      expect(apply(before)).toStrictEqual(before);
    },
  );

  // A block's time is within the TTL, so an inclusion sync reports late happened before the wallet gave up on the
  // transaction. These ends are the wallet's inference; the inclusion is a fact.
  it.each([
    Lifecycle.LifecycleState.Expired(),
    Lifecycle.LifecycleState.Rejected({ verdict: { status: 'TTL_PASSED' } }),
    Lifecycle.LifecycleState.Orphaned({ authoredFor: V8, chainNow: V9 }),
    Lifecycle.LifecycleState.Reverted(),
  ])(
    'should confirm a $_tag record once it is reported included, because the wallet only inferred that end',
    (inferred) => {
      const before = holding(inferred, { submittedAt: Option.some(SUBMITTED_AT) });

      expect(Lifecycle.confirmed(before, ['id-a']).records).toStrictEqual(
        nowIn(before, Lifecycle.LifecycleState.Confirmed()),
      );
    },
  );

  it.each([
    Lifecycle.LifecycleState.Confirmed(),
    Lifecycle.LifecycleState.Rejected({ verdict: REFUSED }),
    Lifecycle.LifecycleState.Rejected({
      verdict: {
        status: 'PARTIAL_SUCCESS',
        segments: [
          { id: 0, success: true },
          { id: 1, success: false },
        ],
      },
    }),
  ])('should stay $_tag after an inclusion is reported, because the chain itself reported how it ended', (reported) => {
    const before = holding(reported);

    expect(Lifecycle.confirmed(before, ['id-a'])).toStrictEqual(before);
  });

  it('should leave a record whose inferred end shares no identifier with the included transaction as it was', () => {
    const before = holding(Lifecycle.LifecycleState.Expired());

    expect(Lifecycle.confirmed(before, ['id-other'])).toStrictEqual(before);
  });

  it.each(FINAL_STATES.filter((final) => final._tag !== 'Confirmed'))(
    'should begin the spend anew when it is balanced again after it was $_tag, keeping one record per spend',
    (final) => {
      const again = facts('erased', ['id-a']);
      const later = at('2026-01-01T00:03:00.000Z');

      expect(Lifecycle.balanced(holding(final), again, later).records).toStrictEqual([
        recordOf(again, later, Lifecycle.LifecycleState.Balanced()),
      ]);
    },
  );

  it('should stay confirmed when the spend is balanced again, because its coins are already spent on chain', () => {
    const before = holding(Lifecycle.LifecycleState.Confirmed());

    expect(Lifecycle.balanced(before, facts('erased', ['id-a']), at('2026-01-01T00:03:00.000Z'))).toStrictEqual(before);
  });
});

// The ledger accepts an intent while its TTL is at or after the block's timestamp, so a TTL is passed only once `now`
// is strictly later than it.
const AT_TTL = DateTime.unsafeMake(TTL);
const PAST_TTL = at('2026-01-01T01:00:00.001Z');
const BEFORE_TTL = at('2026-01-01T00:59:59.999Z');

describe('A transaction whose TTL passes', () => {
  it.each(LIVE_STATES.slice(0, 2))('should expire a $_tag record, because it was never submitted', (unsubmitted) => {
    const before = holding(unsubmitted);

    expect(Lifecycle.expire(before, PAST_TTL).records).toStrictEqual(nowIn(before, Lifecycle.LifecycleState.Expired()));
  });

  it('should reject a submitted record, because no chain will include it any more', () => {
    const before = holding(Lifecycle.LifecycleState.Submitted());

    expect(Lifecycle.expire(before, PAST_TTL).records).toStrictEqual(
      nowIn(before, Lifecycle.LifecycleState.Rejected({ verdict: { status: 'TTL_PASSED' } })),
    );
  });

  it('should expire a record that never held its transaction, by the TTL it recorded', () => {
    const before = holding(Lifecycle.LifecycleState.Balanced(), { tx: Option.none(), protocolVersion: Option.none() });

    expect(Lifecycle.expire(before, PAST_TTL).records).toStrictEqual(nowIn(before, Lifecycle.LifecycleState.Expired()));
  });

  it.each([
    ['at', AT_TTL],
    ['before', BEFORE_TTL],
  ] as const)(
    'should hand back the same state %s the TTL instant, because the ledger still accepts the transaction',
    (_when, now) => {
      const before: Lifecycle.TransactionLifecycle<FakeTransaction> = {
        records: LIVE_STATES.map((live, index) => recordOf(facts('finalized', [`id-${index}`]), BALANCED_AT, live)),
      };

      expect(Lifecycle.expire(before, now)).toBe(before);
    },
  );

  it.each(FINAL_STATES)('should leave a $_tag record as it was, because a final state never moves', (final) => {
    const before = holding(final);

    expect(Lifecycle.expire(before, PAST_TTL)).toBe(before);
  });

  it('should end only the records whose TTL has passed', () => {
    const later = recordOf(
      facts('erased', ['id-later'], { ttl: new Date('2026-01-01T03:00:00.000Z') }),
      BALANCED_AT,
      Lifecycle.LifecycleState.Balanced(),
    );
    const before: Lifecycle.TransactionLifecycle<FakeTransaction> = {
      records: [...holding(Lifecycle.LifecycleState.Balanced()).records, later],
    };

    expect(Lifecycle.expire(before, PAST_TTL).records).toStrictEqual([
      { ...before.records[0], state: Lifecycle.LifecycleState.Expired() },
      later,
    ]);
  });
});

describe('A finished transaction leaving the store', () => {
  it.each(FINAL_STATES)(
    'should drop a $_tag record once its TTL has passed, because no verdict can conflict with it any more',
    (final) => {
      expect(Lifecycle.dropFinished(holding(final), PAST_TTL).records).toStrictEqual([]);
    },
  );

  it.each([
    ['at', AT_TTL],
    ['before', BEFORE_TTL],
  ] as const)(
    'should hand back the same state %s the TTL instant, so a confirmed transaction stays visible for its lifetime',
    (_when, now) => {
      const before: Lifecycle.TransactionLifecycle<FakeTransaction> = {
        records: FINAL_STATES.map((final, index) => recordOf(facts('finalized', [`id-${index}`]), BALANCED_AT, final)),
      };

      expect(Lifecycle.dropFinished(before, now)).toBe(before);
    },
  );

  it.each(LIVE_STATES)('should keep a $_tag record whatever its TTL, because ending it is expiry’s to do', (live) => {
    const before = holding(live);

    expect(Lifecycle.dropFinished(before, PAST_TTL)).toBe(before);
  });

  it('should drop only the final records whose TTL has passed', () => {
    const live = recordOf(facts('finalized', ['id-live']), BALANCED_AT, Lifecycle.LifecycleState.Balanced());
    const stillVisible = recordOf(
      facts('finalized', ['id-later'], { ttl: new Date('2026-01-01T03:00:00.000Z') }),
      BALANCED_AT,
      Lifecycle.LifecycleState.Confirmed(),
    );
    const before: Lifecycle.TransactionLifecycle<FakeTransaction> = {
      records: [...holding(Lifecycle.LifecycleState.Confirmed()).records, live, stillVisible],
    };

    expect(Lifecycle.dropFinished(before, PAST_TTL).records).toStrictEqual([live, stillVisible]);
  });

  it('should show an expired record once before dropping it, when expiry and the drop run in turn', () => {
    const before = holding(Lifecycle.LifecycleState.Finalized());

    const expired = Lifecycle.expire(before, PAST_TTL);
    const swept = Lifecycle.dropFinished(expired, PAST_TTL);

    expect(expired.records.map((record) => record.state._tag)).toStrictEqual(['Expired']);
    expect(swept.records).toStrictEqual([]);
  });
});

describe('Coins a live transaction still accounts for', () => {
  // Restored bookings are released once sync reaches the tip, and this is the set that survives that release.
  it.each(LIVE_STATES)('should cover the unshielded coins of a $_tag record', (live) => {
    expect(Lifecycle.coveredUnshieldedIds(holding(live))).toStrictEqual(['id-a#0']);
  });

  it.each(FINAL_STATES)(
    'should cover nothing for a $_tag record, because its coins are either spent on chain or free',
    (final) => {
      expect(Lifecycle.coveredUnshieldedIds(holding(final))).toStrictEqual([]);
    },
  );

  it('should cover the coins of a record that never held its transaction, by the inputs it recorded', () => {
    const upgraded = holding(Lifecycle.LifecycleState.Balanced(), {
      tx: Option.none(),
      protocolVersion: Option.none(),
    });

    expect(Lifecycle.coveredUnshieldedIds(upgraded)).toStrictEqual(['id-a#0']);
  });

  it('should name a coin once when two live records both spend it, and leave out shielded inputs', () => {
    const shared = recordOf(
      facts('finalized', ['id-b'], { inputs: { unshielded: ['id-a#0', 'id-b#0'], shielded: ['nullifier-b'] } }),
      BALANCED_AT,
      Lifecycle.LifecycleState.Submitted(),
    );
    const state: Lifecycle.TransactionLifecycle<FakeTransaction> = {
      records: [...holding(Lifecycle.LifecycleState.Balanced()).records, shared],
    };

    expect([...Lifecycle.coveredUnshieldedIds(state)].toSorted()).toStrictEqual(['id-a#0', 'id-b#0']);
  });

  it('should cover nothing when nothing is recorded', () => {
    expect(Lifecycle.coveredUnshieldedIds(empty)).toStrictEqual([]);
  });
});

describe('When a transaction was submitted', () => {
  const final = facts('finalized', ['id-a']);
  const sent = Lifecycle.submitted(Lifecycle.finalized(empty, final, FINALIZED_AT), final, SUBMITTED_AT);

  it.each([
    ['Confirmed', 'an inclusion', (state: typeof sent) => Lifecycle.confirmed(state, ['id-a'])],
    ['Rejected', 'a rejection', (state: typeof sent) => Lifecycle.rejected(state, ['id-a'], REFUSED)],
    ['Rejected', 'its TTL passing', (state: typeof sent) => Lifecycle.expire(state, PAST_TTL)],
    ['Orphaned', 'a fork crossing', (state: typeof sent) => Lifecycle.orphanBeyond(state, EPOCHS, V9)],
    ['Reverted', 'a revert', (state: typeof sent) => Lifecycle.reverted(state, ['id-a'])],
  ] as const)(
    'should still know when it was submitted once %s after %s, because the verdict replaces the state',
    (tag, _event, apply) => {
      const after = apply(sent);

      expect(after.records.map((record) => [record.state._tag, record.submittedAt])).toStrictEqual([
        [tag, Option.some(SUBMITTED_AT)],
      ]);
    },
  );

  it('should keep the first submission time when it is submitted again, because a submitted record does not move', () => {
    const again = Lifecycle.submitted(sent, final, at('2026-01-01T00:04:00.000Z'));

    expect(again.records.map((record) => record.submittedAt)).toStrictEqual([Option.some(SUBMITTED_AT)]);
  });

  it('should hold no submission time for a record that ended without being submitted', () => {
    const abandoned = Lifecycle.reverted(Lifecycle.finalized(empty, final, FINALIZED_AT), ['id-a']);

    expect(abandoned.records.map((record) => record.submittedAt)).toStrictEqual([Option.none()]);
  });

  it('should forget the submission time when the spend is balanced again after a rejection, because it begins anew', () => {
    const rebalanced = Lifecycle.balanced(
      Lifecycle.rejected(sent, ['id-a'], REFUSED),
      facts('erased', ['id-a']),
      at('2026-01-01T00:04:00.000Z'),
    );

    expect(rebalanced.records.map((record) => record.submittedAt)).toStrictEqual([Option.none()]);
  });
});
