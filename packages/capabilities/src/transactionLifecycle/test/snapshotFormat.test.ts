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

// The pending-transactions store moves from a list of pending items plus a list of reservations (v1) to one lifecycle
// record per transaction (v2). The step is a pure function on the decoded JSON, run before any schema, so it is tested
// as one, with no ledger involved. What v1 never stored, the step leaves out for the reader to derive; it never
// invents it.
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_FORMAT_VERSIONS,
  V1_SNAPSHOT_FORMAT_VERSION,
  V2_SNAPSHOT_FORMAT_VERSION,
  upgradeSnapshotV1ToV2,
} from '../SnapshotFormat.js';

const ITEM = { tx: 'aa01', creationTime: '2026-01-01T00:01:00.000Z', protocolVersion: '3' };

const RESERVATION = {
  identifiers: ['id-b'],
  intentHashes: ['intent-b'],
  inputs: { unshielded: ['intent-z#0'], shielded: ['nullifier-b'] },
  ttl: '2026-01-01T01:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  expired: false,
};

const v1Store = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 'v1',
  transactions: [ITEM],
  reservations: [RESERVATION],
  ...overrides,
});

const SUBMITTED_RECORD = {
  tx: 'aa01',
  createdAt: '2026-01-01T00:01:00.000Z',
  protocolVersion: '3',
  state: { _tag: 'Submitted' },
};

const BALANCED_RECORD = {
  identifiers: ['id-b'],
  intentHashes: ['intent-b'],
  inputs: { unshielded: ['intent-z#0'], shielded: ['nullifier-b'] },
  ttl: '2026-01-01T01:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  state: { _tag: 'Balanced' },
};

describe('the pending transactions format versions', () => {
  it('should name v1 as the store of pending items and reservations, and v2 as the current version', () => {
    expect(V1_SNAPSHOT_FORMAT_VERSION).toBe('v1');
    expect(V2_SNAPSHOT_FORMAT_VERSION).toBe('v2');
    expect(SNAPSHOT_FORMAT_VERSION).toBe('v2');
    expect(SNAPSHOT_FORMAT_VERSIONS).toStrictEqual(['v1', 'v2']);
  });

  // A bump moves `SNAPSHOT_FORMAT_VERSION` on. The v1 → v2 step is frozen, so it must still stamp v2; if it read the
  // current version instead, the step after it would never run on an old store.
  it('should have the v1 to v2 step stamp v2 by name, not whatever version is current', () => {
    expect(SNAPSHOT_FORMAT_VERSIONS.at(-1)).toBe(SNAPSHOT_FORMAT_VERSION);
    expect(upgradeSnapshotV1ToV2(v1Store())).toMatchObject({ version: V2_SNAPSHOT_FORMAT_VERSION });
  });
});

describe('upgrading the pending transactions store from v1 to v2', () => {
  it('should turn every pending item and every reservation into one record each, pending items first', () => {
    expect(upgradeSnapshotV1ToV2(v1Store())).toStrictEqual({
      version: 'v2',
      records: [SUBMITTED_RECORD, BALANCED_RECORD],
    });
  });

  it('should make a pending item a submitted record with no submission time, because v1 kept only when it was finalized', () => {
    expect(upgradeSnapshotV1ToV2(v1Store({ reservations: [] }))).toStrictEqual({
      version: 'v2',
      records: [SUBMITTED_RECORD],
    });
  });

  it('should leave the version out of a record whose pending item was never stamped with one', () => {
    const { protocolVersion: _protocolVersion, ...unstamped } = ITEM;
    const { protocolVersion: _recordVersion, ...unstampedRecord } = SUBMITTED_RECORD;

    expect(upgradeSnapshotV1ToV2(v1Store({ transactions: [unstamped], reservations: [] }))).toStrictEqual({
      version: 'v2',
      records: [unstampedRecord],
    });
  });

  it('should make a reservation a balanced record with no transaction and no version, because v1 never stored them', () => {
    expect(upgradeSnapshotV1ToV2(v1Store({ transactions: [] }))).toStrictEqual({
      version: 'v2',
      records: [BALANCED_RECORD],
    });
  });

  it('should keep a reservation that booked nothing shielded without shielded inputs', () => {
    const unshieldedOnly = { ...RESERVATION, inputs: { unshielded: ['intent-z#0'] } };

    expect(upgradeSnapshotV1ToV2(v1Store({ transactions: [], reservations: [unshieldedOnly] }))).toStrictEqual({
      version: 'v2',
      records: [{ ...BALANCED_RECORD, inputs: { unshielded: ['intent-z#0'] } }],
    });
  });

  it('should make a reservation already marked expired an expired record, because that end was recorded', () => {
    expect(
      upgradeSnapshotV1ToV2(v1Store({ transactions: [], reservations: [{ ...RESERVATION, expired: true }] })),
    ).toStrictEqual({
      version: 'v2',
      records: [{ ...BALANCED_RECORD, state: { _tag: 'Expired' } }],
    });
  });

  it('should read a store written before reservations existed as having none', () => {
    const { reservations: _reservations, ...beforeReservations } = v1Store();

    expect(upgradeSnapshotV1ToV2(beforeReservations)).toStrictEqual({ version: 'v2', records: [SUBMITTED_RECORD] });
  });

  it('should turn an empty store into one with no records', () => {
    expect(upgradeSnapshotV1ToV2(v1Store({ transactions: [], reservations: [] }))).toStrictEqual({
      version: 'v2',
      records: [],
    });
  });

  it('should carry every top-level field it does not know, unchanged, so a later release that wrote them still finds them', () => {
    const extra = { laterField: { nested: [1, 2] }, note: 'kept' };

    expect(upgradeSnapshotV1ToV2(v1Store(extra))).toStrictEqual({
      version: 'v2',
      records: [SUBMITTED_RECORD, BALANCED_RECORD],
      ...extra,
    });
  });

  it('should leave a v2 store as it is, so applying the step twice is applying it once', () => {
    const once = upgradeSnapshotV1ToV2(v1Store({ laterField: 'kept' }));

    expect(upgradeSnapshotV1ToV2(once)).toStrictEqual(once);
  });

  it.each([
    ['a version it does not own', { version: 'v9', transactions: [ITEM] }],
    ['no version at all', { transactions: [ITEM] }],
    ['an array', [ITEM]],
    ['a string', 'v1'],
    ['null', null],
  ])('should hand back %s as it came, for the schema after it to refuse', (_what, json) => {
    expect(upgradeSnapshotV1ToV2(json)).toStrictEqual(json);
  });
});
