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

/** The record the facts describe, as it stands in `state` since `createdAt`. */
const recordOf = (
  given: Lifecycle.TransactionFacts<FakeTransaction>,
  createdAt: DateTime.Utc,
  state: Lifecycle.LifecycleState,
): Lifecycle.LifecycleRecord<FakeTransaction> => ({
  identifiers: given.identifiers,
  intentHashes: given.intentHashes,
  inputs: given.inputs,
  ttl: given.ttl,
  protocolVersion: Option.some(given.protocolVersion),
  tx: Option.some(given.tx),
  createdAt,
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

    expect(state.records).toStrictEqual([
      recordOf(final, BALANCED_AT, Lifecycle.LifecycleState.Finalized({ finalizedAt: FINALIZED_AT })),
    ]);
  });

  it('should begin a record at finalized for a transaction the facade did not balance', () => {
    const final = facts('finalized', ['id-a']);

    const state = Lifecycle.finalized(empty, final, FINALIZED_AT);

    expect(state.records).toStrictEqual([
      recordOf(final, FINALIZED_AT, Lifecycle.LifecycleState.Finalized({ finalizedAt: FINALIZED_AT })),
    ]);
  });

  it('should fold every record the finalized transaction covers into one, because merging parts makes one transaction', () => {
    const balancing = Lifecycle.balanced(empty, facts('erased', ['id-a']), BALANCED_AT);
    const both = Lifecycle.finalized(balancing, facts('finalized', ['id-b']), FINALIZED_AT);
    const merged = facts('finalized', ['id-a', 'id-b']);
    const mergedAt = at('2026-01-01T00:01:30.000Z');

    const state = Lifecycle.finalized(both, merged, mergedAt);

    expect(state.records).toStrictEqual([
      recordOf(merged, BALANCED_AT, Lifecycle.LifecycleState.Finalized({ finalizedAt: mergedAt })),
    ]);
  });

  it('should move a finalized record to submitted at the time it was submitted, not the time it was finalized', () => {
    const final = facts('finalized', ['id-a']);

    const state = Lifecycle.submitted(Lifecycle.finalized(empty, final, FINALIZED_AT), final, SUBMITTED_AT);

    expect(state.records).toStrictEqual([
      recordOf(final, FINALIZED_AT, Lifecycle.LifecycleState.Submitted({ submittedAt: SUBMITTED_AT })),
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
      recordOf(final, BALANCED_AT, Lifecycle.LifecycleState.Submitted({ submittedAt: SUBMITTED_AT })),
    ]);
  });

  it('should begin a record at submitted for an adopted transaction', () => {
    const final = facts('finalized', ['id-a']);

    const state = Lifecycle.submitted(empty, final, SUBMITTED_AT);

    expect(state.records).toStrictEqual([
      recordOf(final, SUBMITTED_AT, Lifecycle.LifecycleState.Submitted({ submittedAt: SUBMITTED_AT })),
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
