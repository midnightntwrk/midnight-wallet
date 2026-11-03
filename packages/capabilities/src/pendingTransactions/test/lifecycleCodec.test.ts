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

// The lifecycle records are stored in format v2. A store written in v1 is upgraded on read, and what v1 never stored
// beside a pending item (its identifiers, intent hashes, inputs and TTL) the reader takes from the transaction, with the
// trait registered for the version the item was stamped with.
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DateTime, Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Lifecycle from '../lifecycle.js';
import type * as PendingTransactions from '../pendingTransactions.js';

type LedgerTx = Readonly<{ ledger: 'v8' | 'v9'; ids: readonly string[] }>;

/** How long after it was created each ledger's fake transaction lives, so a TTL shows which trait computed it. */
const LIFETIME_MS: Record<LedgerTx['ledger'], number> = { v8: 60 * 60 * 1000, v9: 2 * 60 * 60 * 1000 };

/**
 * A trait that reads only its own ledger's transactions, and prefixes every fact it reads with its ledger, so a test
 * can tell which trait a record's facts came from.
 */
const ledgerTrait = (ledger: LedgerTx['ledger']): PendingTransactions.TransactionTrait<LedgerTx> => ({
  isTx: (data): data is LedgerTx =>
    typeof data === 'object' && data !== null && 'ledger' in data && 'ids' in data && data.ledger === ledger,
  serialize: (tx) => Buffer.from(JSON.stringify(tx), 'utf-8'),
  deserialize: (bytes) => {
    const tx = JSON.parse(Buffer.from(bytes).toString('utf-8')) as LedgerTx;
    if (tx.ledger !== ledger) throw new Error(`not a ${ledger} transaction`);
    return tx;
  },
  ids: (tx) => tx.ids,
  firstId: (tx) => tx.ids[0],
  areAllTxIdsIncluded: (tx, ids) => tx.ids.every((id) => ids.includes(id)),
  isOneIncludedInOther: () => false,
  hasTTLExpired: () => false,
  intentHashes: (tx) => tx.ids.map((id) => `${ledger}-intent-${id}`),
  inputs: (tx) => ({ unshielded: tx.ids.map((id) => `${ledger}-coin-${id}#0`) }),
  ttl: (_tx, createdAt) => new Date(DateTime.toEpochMillis(createdAt) + LIFETIME_MS[ledger]),
});

const V9_FORK = ProtocolVersion.ProtocolVersion(2_000_000n);
const V8_VERSION = ProtocolVersion.ProtocolVersion(1_000n);
const V9_VERSION = ProtocolVersion.ProtocolVersion(2_000_001n);

const traits: PendingTransactions.VersionedTransactionTrait<LedgerTx> = Either.getOrThrow(
  ProtocolVersion.makeRegistryFromActivations([
    { sinceVersion: ProtocolVersion.MinSupportedVersion, value: ledgerTrait('v8') },
    { sinceVersion: V9_FORK, value: ledgerTrait('v9') },
  ]),
);

const at = (iso: string): DateTime.Utc => DateTime.unsafeMake(iso);

const CREATED_AT = at('2026-01-01T00:00:00.000Z');
const SUBMITTED_AT = at('2026-01-01T00:02:00.000Z');
const TTL = new Date('2026-01-01T01:00:00.000Z');

const hexOf = (tx: LedgerTx): string => Buffer.from(JSON.stringify(tx), 'utf-8').toString('hex');

/** A record holding its transaction, with the facts the trait for its ledger reads off it. */
const heldRecord = (
  tx: LedgerTx,
  protocolVersion: ProtocolVersion.ProtocolVersion,
  state: Lifecycle.LifecycleState,
  submittedAt: Option.Option<DateTime.Utc> = Option.none(),
): Lifecycle.LifecycleRecord<LedgerTx> => ({
  identifiers: tx.ids,
  intentHashes: tx.ids.map((id) => `${tx.ledger}-intent-${id}`),
  inputs: { unshielded: tx.ids.map((id) => `${tx.ledger}-coin-${id}#0`) },
  ttl: TTL,
  protocolVersion: Option.some(protocolVersion),
  tx: Option.some(tx),
  createdAt: CREATED_AT,
  submittedAt,
  state,
});

/** A record that never held its transaction: what a v1 reservation becomes. */
const bareRecord = (state: Lifecycle.LifecycleState): Lifecycle.LifecycleRecord<LedgerTx> => ({
  identifiers: ['bare-id'],
  intentHashes: ['bare-intent'],
  inputs: { unshielded: ['bare-coin#0'], shielded: ['bare-nullifier'] },
  ttl: TTL,
  protocolVersion: Option.none(),
  tx: Option.none(),
  createdAt: CREATED_AT,
  submittedAt: Option.none(),
  state,
});

const { LifecycleState } = Lifecycle;

const restore = (serialized: string): Either.Either<Lifecycle.TransactionLifecycle<LedgerTx>, unknown> =>
  Lifecycle.deserialize(serialized, traits);

const parseObject = (serialized: string): Record<string, unknown> => JSON.parse(serialized) as Record<string, unknown>;

describe('Storing the lifecycle records', () => {
  it('should read back every record it wrote, in every state, exactly as it was', () => {
    const state: Lifecycle.TransactionLifecycle<LedgerTx> = {
      records: [
        heldRecord({ ledger: 'v9', ids: ['balanced'] }, V9_VERSION, LifecycleState.Balanced()),
        bareRecord(LifecycleState.Balanced()),
        heldRecord({ ledger: 'v8', ids: ['finalized'] }, V8_VERSION, LifecycleState.Finalized()),
        heldRecord(
          { ledger: 'v9', ids: ['submitted'] },
          V9_VERSION,
          LifecycleState.Submitted(),
          Option.some(SUBMITTED_AT),
        ),
        heldRecord(
          { ledger: 'v9', ids: ['confirmed'] },
          V9_VERSION,
          LifecycleState.Confirmed(),
          Option.some(SUBMITTED_AT),
        ),
        heldRecord(
          { ledger: 'v9', ids: ['refused'] },
          V9_VERSION,
          LifecycleState.Rejected({
            verdict: {
              status: 'PARTIAL_SUCCESS',
              segments: [
                { id: 0, success: true },
                { id: 1, success: false },
              ],
            },
          }),
          Option.some(SUBMITTED_AT),
        ),
        heldRecord(
          { ledger: 'v9', ids: ['timed-out'] },
          V9_VERSION,
          LifecycleState.Rejected({ verdict: { status: 'TTL_PASSED' } }),
          Option.some(SUBMITTED_AT),
        ),
        heldRecord(
          { ledger: 'v8', ids: ['orphaned'] },
          V8_VERSION,
          LifecycleState.Orphaned({ authoredFor: V8_VERSION, chainNow: V9_VERSION }),
        ),
        bareRecord(LifecycleState.Expired()),
        heldRecord({ ledger: 'v9', ids: ['reverted'] }, V9_VERSION, LifecycleState.Reverted()),
      ],
    };

    const restored = restore(Lifecycle.serialize(state, traits));

    expect(restored).toStrictEqual(Either.right(state));
  });

  it('should write format v2, holding the records and nothing else the state did not carry', () => {
    const state: Lifecycle.TransactionLifecycle<LedgerTx> = { records: [bareRecord(LifecycleState.Balanced())] };

    const written = parseObject(Lifecycle.serialize(state, traits));

    expect(Object.keys(written).sort()).toStrictEqual(['records', 'version']);
    expect(written['version']).toBe('v2');
  });

  it('should keep the facts a record stored over what its transaction reads, because the reader only fills a gap', () => {
    const tx: LedgerTx = { ledger: 'v9', ids: ['id-a'] };
    const stored = JSON.stringify({
      version: 'v2',
      records: [
        {
          tx: hexOf(tx),
          protocolVersion: String(V9_VERSION),
          identifiers: ['stored-id'],
          intentHashes: ['stored-intent'],
          inputs: { unshielded: ['stored-coin#0'] },
          ttl: '2026-01-01T00:30:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          state: { _tag: 'Finalized' },
        },
      ],
    });

    const restored = restore(stored);

    expect(restored).toStrictEqual(
      Either.right({
        records: [
          {
            identifiers: ['stored-id'],
            intentHashes: ['stored-intent'],
            inputs: { unshielded: ['stored-coin#0'] },
            ttl: new Date('2026-01-01T00:30:00.000Z'),
            protocolVersion: Option.some(V9_VERSION),
            tx: Option.some(tx),
            createdAt: CREATED_AT,
            submittedAt: Option.none(),
            state: LifecycleState.Finalized(),
          },
        ],
      }),
    );
  });

  it('should refuse a record that holds neither its transaction nor the facts it would be read from', () => {
    const stored = JSON.stringify({
      version: 'v2',
      records: [{ createdAt: '2026-01-01T00:00:00.000Z', state: { _tag: 'Balanced' } }],
    });

    expect(Either.isLeft(restore(stored))).toBe(true);
  });

  it('should refuse a format version it does not know, naming the version it found', () => {
    const stored = JSON.stringify({ version: 'v3', records: [] });

    const restored = restore(stored);

    expect(Either.isLeft(restored)).toBe(true);
    expect(String(Either.getLeft(restored).pipe(Option.getOrThrow))).toContain('"v3"');
  });
});

describe('Reading a store written in v1', () => {
  it('should read a stamped pending item as submitted, with the facts the trait for its version reads off it', () => {
    const tx: LedgerTx = { ledger: 'v9', ids: ['id-a'] };
    const stored = JSON.stringify({
      version: 'v1',
      transactions: [{ tx: hexOf(tx), creationTime: '2026-01-01T00:00:00.000Z', protocolVersion: String(V9_VERSION) }],
    });

    const restored = restore(stored);

    // When it was submitted was never stored: v1 kept only when it was finalized, which is when the record began.
    expect(restored).toStrictEqual(
      Either.right({
        records: [
          {
            identifiers: ['id-a'],
            intentHashes: ['v9-intent-id-a'],
            inputs: { unshielded: ['v9-coin-id-a#0'] },
            ttl: new Date('2026-01-01T02:00:00.000Z'),
            protocolVersion: Option.some(V9_VERSION),
            tx: Option.some(tx),
            createdAt: CREATED_AT,
            submittedAt: Option.none(),
            state: LifecycleState.Submitted(),
          },
        ],
      }),
    );
  });

  it('should read an unstamped pending item with the oldest trait, and leave its version unknown', () => {
    const tx: LedgerTx = { ledger: 'v8', ids: ['id-a'] };
    const stored = JSON.stringify({
      version: 'v1',
      transactions: [{ tx: hexOf(tx), creationTime: '2026-01-01T00:00:00.000Z' }],
    });

    const restored = restore(stored);

    expect(restored).toStrictEqual(
      Either.right({
        records: [
          {
            identifiers: ['id-a'],
            intentHashes: ['v8-intent-id-a'],
            inputs: { unshielded: ['v8-coin-id-a#0'] },
            ttl: new Date('2026-01-01T01:00:00.000Z'),
            protocolVersion: Option.none(),
            tx: Option.some(tx),
            createdAt: CREATED_AT,
            submittedAt: Option.none(),
            state: LifecycleState.Submitted(),
          },
        ],
      }),
    );
  });

  it('should read a reservation as a record that never held its transaction, balanced or expired as it was', () => {
    const reservation = {
      identifiers: ['bare-id'],
      intentHashes: ['bare-intent'],
      inputs: { unshielded: ['bare-coin#0'], shielded: ['bare-nullifier'] },
      ttl: '2026-01-01T01:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const stored = JSON.stringify({
      version: 'v1',
      transactions: [],
      reservations: [
        { ...reservation, expired: false },
        { ...reservation, expired: true },
      ],
    });

    const restored = restore(stored);

    expect(restored).toStrictEqual(
      Either.right({ records: [bareRecord(LifecycleState.Balanced()), bareRecord(LifecycleState.Expired())] }),
    );
  });
});

describe('Carrying the top-level members this build does not declare', () => {
  it('should write back a member it does not know, whether the store was written in v1 or v2', () => {
    const fromV1 = JSON.stringify({ version: 'v1', transactions: [], laterMember: { kept: true } });
    const fromV2 = JSON.stringify({ version: 'v2', records: [], laterMember: { kept: true } });

    const rewrite = (serialized: string): Record<string, unknown> =>
      parseObject(Lifecycle.serialize(Either.getOrThrow(restore(serialized)), traits));

    expect(rewrite(fromV1)).toStrictEqual({ version: 'v2', records: [], laterMember: { kept: true } });
    expect(rewrite(fromV2)).toStrictEqual({ version: 'v2', records: [], laterMember: { kept: true } });
  });
});
