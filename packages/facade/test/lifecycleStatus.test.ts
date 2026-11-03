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

/**
 * What an application sees of each transaction the wallet keeps a lifecycle record for.
 *
 * @remarks
 *   One entry per record, read off the record: its state as a tagged status an application can exhaust, the finalized
 *   transaction once there is one, and when it was submitted once it was. A record stays until its TTL has passed,
 *   ended or not, so an application tells the transactions still awaiting an answer from the rest with `isAwaiting`
 *   rather than by the list being empty.
 */
import { NetworkId, ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { Lifecycle } from '@midnightntwrk/wallet-sdk-capabilities/transactionLifecycle';
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import { DateTime, Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { isAwaiting, type LifecycleEntry, lifecycleEntriesOf } from '../src/index.js';
import { type LifecycleTx } from '../src/transaction.js';

const authoredFor = ProtocolVersion.MinSupportedVersion;
const chainNow = ProtocolVersion.ProtocolVersion(2_000_000n);
const createdAt = DateTime.unsafeMake(1_700_000_000_000);
const submittedAt = DateTime.unsafeMake(1_700_000_060_000);
const identifiers = ['an-identifier'];

const aTransaction = (form: LifecycleTx['form'] = 'Finalized'): LifecycleTx => ({
  protocolVersion: authoredFor,
  transaction: ledgerV8.Transaction.fromParts(NetworkId.NetworkId.Undeployed),
  form,
});

const aRecord = (
  state: Lifecycle.LifecycleState,
  overrides: Partial<Lifecycle.LifecycleRecord<LifecycleTx>> = {},
): Lifecycle.LifecycleRecord<LifecycleTx> => ({
  identifiers,
  intentHashes: [],
  inputs: { unshielded: [] },
  ttl: new Date(1_700_003_600_000),
  protocolVersion: Option.some(authoredFor),
  tx: Option.some(aTransaction()),
  createdAt,
  submittedAt: Option.none(),
  state,
  ...overrides,
});

const onlyEntryOf = (record: Lifecycle.LifecycleRecord<LifecycleTx>): LifecycleEntry => {
  const entries = lifecycleEntriesOf({ records: [record] });
  expect(entries).toHaveLength(1);
  return entries[0];
};

/** The ledger transaction an entry's handle carries, so a test can tell it is the very one the record holds. */
const carriedBy = (entry: LifecycleEntry): Option.Option<unknown> =>
  Option.map(entry.transaction, (handle) =>
    Either.getOrThrow(
      WalletTransaction.unwrapWithin<unknown>(
        handle,
        ProtocolVersion.epochOf(handle.protocolVersion, ProtocolVersion.MinSupportedVersion),
      ),
    ),
  );

describe('a balanced transaction', () => {
  it('is balanced, with no transaction yet, because the record holds it with its proofs erased', () => {
    const entry = onlyEntryOf(aRecord(Lifecycle.LifecycleState.Balanced()));

    expect(entry).toStrictEqual({
      identifiers,
      transaction: Option.none(),
      submittedAt: Option.none(),
      authoredFor: Option.some(authoredFor),
      status: { _tag: 'Balanced' },
    });
  });
});

describe('a finalized transaction', () => {
  it('is finalized, not submitted, and carries the finalized transaction the record holds, stamped as the record says', () => {
    const held = aTransaction();
    const entry = onlyEntryOf(aRecord(Lifecycle.LifecycleState.Finalized(), { tx: Option.some(held) }));

    expect(entry.status).toStrictEqual({ _tag: 'Finalized' });
    expect(entry.submittedAt).toStrictEqual(Option.none());
    expect(Option.map(entry.transaction, (handle) => [handle.stage, handle.protocolVersion])).toStrictEqual(
      Option.some(['Finalized', authoredFor]),
    );
    expect(Option.getOrThrow(carriedBy(entry))).toBe(held.transaction);
  });

  it('carries no transaction when its record does not hold one, as a record kept from an older format may not', () => {
    const entry = onlyEntryOf(aRecord(Lifecycle.LifecycleState.Finalized(), { tx: Option.none() }));

    expect(entry.transaction).toStrictEqual(Option.none());
    expect(entry.identifiers).toStrictEqual(identifiers);
  });
});

describe('a submitted transaction', () => {
  it('is submitted, and says when it was submitted', () => {
    const held = aTransaction();
    const entry = onlyEntryOf(
      aRecord(Lifecycle.LifecycleState.Submitted(), { tx: Option.some(held), submittedAt: Option.some(submittedAt) }),
    );

    expect(entry.status).toStrictEqual({ _tag: 'Submitted' });
    expect(entry.submittedAt).toStrictEqual(Option.some(submittedAt));
    expect(Option.getOrThrow(carriedBy(entry))).toBe(held.transaction);
  });
});

describe('a transaction the chain confirmed', () => {
  it('is confirmed, and still says when it was submitted', () => {
    const entry = onlyEntryOf(aRecord(Lifecycle.LifecycleState.Confirmed(), { submittedAt: Option.some(submittedAt) }));

    expect(entry.status).toStrictEqual({ _tag: 'Confirmed' });
    expect(entry.submittedAt).toStrictEqual(Option.some(submittedAt));
  });
});

describe('a transaction that will never be included', () => {
  it('is rejected as refused, with the segments the chain reported, when the chain failed it', () => {
    const segments = [{ id: 0, success: false }];

    expect(
      onlyEntryOf(aRecord(Lifecycle.LifecycleState.Rejected({ verdict: { status: 'FAILURE', segments } }))).status,
    ).toStrictEqual({ _tag: 'Rejected', reason: { _tag: 'Refused', segments } });
  });

  it('is rejected as refused when only some segments succeeded, which is still not a transaction that happened', () => {
    const segments = [
      { id: 0, success: true },
      { id: 1, success: false },
    ];

    expect(
      onlyEntryOf(aRecord(Lifecycle.LifecycleState.Rejected({ verdict: { status: 'PARTIAL_SUCCESS', segments } })))
        .status,
    ).toStrictEqual({ _tag: 'Rejected', reason: { _tag: 'Refused', segments } });
  });

  it('is rejected because its TTL passed, with no segments, when it was submitted and the chain never included it', () => {
    expect(
      onlyEntryOf(aRecord(Lifecycle.LifecycleState.Rejected({ verdict: { status: 'TTL_PASSED' } }))).status,
    ).toStrictEqual({ _tag: 'Rejected', reason: { _tag: 'TTLPassed' } });
  });

  it('is expired when its TTL passed before it was submitted', () => {
    expect(onlyEntryOf(aRecord(Lifecycle.LifecycleState.Expired())).status).toStrictEqual({ _tag: 'Expired' });
  });

  it('is reverted when the wallet gave its coins back', () => {
    expect(onlyEntryOf(aRecord(Lifecycle.LifecycleState.Reverted())).status).toStrictEqual({ _tag: 'Reverted' });
  });
});

describe('a transaction that ended', () => {
  const ENDS = [
    Lifecycle.LifecycleState.Confirmed(),
    Lifecycle.LifecycleState.Orphaned({ authoredFor, chainNow }),
    Lifecycle.LifecycleState.Expired(),
    Lifecycle.LifecycleState.Reverted(),
  ];

  it.each(ENDS)(
    'carries no transaction when it ended $_tag while only balanced, because the record holds it with its proofs erased',
    (state) => {
      expect(onlyEntryOf(aRecord(state, { tx: Option.some(aTransaction('Erased')) })).transaction).toStrictEqual(
        Option.none(),
      );
    },
  );

  it.each(ENDS)('carries the finalized transaction when it ended $_tag after it was finalized', (state) => {
    const held = aTransaction('Finalized');

    expect(Option.getOrThrow(carriedBy(onlyEntryOf(aRecord(state, { tx: Option.some(held) }))))).toBe(held.transaction);
  });

  // A finalized transaction is submitted, and only a submitted one is refused, so these states say the record holds it
  // finalized whatever form the bytes it was read back from suggest.
  it.each([
    Lifecycle.LifecycleState.Finalized(),
    Lifecycle.LifecycleState.Submitted(),
    Lifecycle.LifecycleState.Rejected({ verdict: { status: 'TTL_PASSED' } }),
  ])('carries the transaction while $_tag even when it was read back proof-erased', (state) => {
    const held = aTransaction('Erased');

    expect(Option.getOrThrow(carriedBy(onlyEntryOf(aRecord(state, { tx: Option.some(held) }))))).toBe(held.transaction);
  });
});

describe('the handle an entry carries', () => {
  it('is stamped with the version its record was built for, even when the transaction was read back at the start of its epoch', () => {
    const builtFor = ProtocolVersion.ProtocolVersion(1n);
    const readBack = { ...aTransaction(), protocolVersion: ProtocolVersion.MinSupportedVersion };

    const entry = onlyEntryOf(
      aRecord(Lifecycle.LifecycleState.Submitted(), {
        tx: Option.some(readBack),
        protocolVersion: Option.some(builtFor),
      }),
    );

    expect(Option.map(entry.transaction, (handle) => handle.protocolVersion)).toStrictEqual(Option.some(builtFor));
    expect(entry.authoredFor).toStrictEqual(Option.some(builtFor));
  });
});

describe('a transaction a protocol upgrade left behind', () => {
  it('is orphaned, and says which version it was authored for and which the chain reached', () => {
    expect(onlyEntryOf(aRecord(Lifecycle.LifecycleState.Orphaned({ authoredFor, chainNow }))).status).toStrictEqual({
      _tag: 'Orphaned',
      authoredFor,
      chainNow,
    });
  });
});

describe('the transactions an application waits on', () => {
  it.each([
    { state: Lifecycle.LifecycleState.Balanced(), awaiting: true },
    { state: Lifecycle.LifecycleState.Finalized(), awaiting: true },
    { state: Lifecycle.LifecycleState.Submitted(), awaiting: true },
    { state: Lifecycle.LifecycleState.Confirmed(), awaiting: false },
    { state: Lifecycle.LifecycleState.Rejected({ verdict: { status: 'TTL_PASSED' } }), awaiting: false },
    { state: Lifecycle.LifecycleState.Orphaned({ authoredFor, chainNow }), awaiting: false },
    { state: Lifecycle.LifecycleState.Expired(), awaiting: false },
    { state: Lifecycle.LifecycleState.Reverted(), awaiting: false },
  ])(
    'are awaiting an answer when $state._tag is $awaiting, because only a live record can still move',
    ({ state, awaiting }) => {
      expect(isAwaiting(onlyEntryOf(aRecord(state)))).toBe(awaiting);
    },
  );
});

describe('the records', () => {
  it('give one entry each, in the order the wallet keeps them', () => {
    const entries = lifecycleEntriesOf({
      records: [
        aRecord(Lifecycle.LifecycleState.Submitted(), { identifiers: ['first'] }),
        aRecord(Lifecycle.LifecycleState.Confirmed(), { identifiers: ['second'] }),
      ],
    });

    expect(entries.map((entry) => entry.identifiers)).toStrictEqual([['first'], ['second']]);
  });

  it('give an empty list when there are none', () => {
    expect(lifecycleEntriesOf(Lifecycle.empty())).toStrictEqual([]);
  });
});
