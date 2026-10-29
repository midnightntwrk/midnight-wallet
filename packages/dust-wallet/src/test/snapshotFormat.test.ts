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

// The one upgrade step a dust snapshot has: `v1`, which records no pending Dust, to `v2`, which requires
// `pendingDust`. A pure function on the decoded JSON, run before any schema — so it is tested as one, with no wallet,
// no ledger and no keys involved.
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_FORMAT_VERSIONS,
  V1_SNAPSHOT_FORMAT_VERSION,
  V2_SNAPSHOT_FORMAT_VERSION,
  upgradeSnapshotV1ToV2,
} from '../SnapshotFormat.js';

const v1Snapshot = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 'v1',
  publicKey: { publicKey: '1234' },
  state: 'abcd',
  protocolVersion: '0',
  networkId: 'undeployed',
  ...overrides,
});

const pendingCoin = {
  initialValue: '0',
  owner: '1',
  nonce: '2',
  seq: 0,
  ctime: '2026-01-01T00:00:00.500Z',
  backingNight: 'bb'.repeat(32),
  mtIndex: '1',
  nullifier: '3',
};

describe('the dust snapshot format versions', () => {
  it('names v1 as the format without pending Dust and v2 as the current version', () => {
    expect(V1_SNAPSHOT_FORMAT_VERSION).toBe('v1');
    expect(V2_SNAPSHOT_FORMAT_VERSION).toBe('v2');
    expect(SNAPSHOT_FORMAT_VERSION).toBe('v2');
    expect(SNAPSHOT_FORMAT_VERSIONS).toEqual(['v1', 'v2']);
  });

  // A bump moves `SNAPSHOT_FORMAT_VERSION` to `v3`. The `v1 → v2` step is frozen, so it must still stamp `v2`; if it
  // read the current version instead, the `v2 → v3` step keyed on `v2` would never run on an old snapshot.
  it('has the v1 to v2 step stamp v2 by name, not whatever version is current', () => {
    expect(SNAPSHOT_FORMAT_VERSIONS.at(-1)).toBe(SNAPSHOT_FORMAT_VERSION);
    expect(upgradeSnapshotV1ToV2(v1Snapshot())).toMatchObject({ version: V2_SNAPSHOT_FORMAT_VERSION });
  });
});

describe('upgrading a dust snapshot from v1 to v2', () => {
  it('adds an empty pendingDust and stamps the new version, because a v1 snapshot recorded no pending Dust', () => {
    expect(upgradeSnapshotV1ToV2(v1Snapshot())).toEqual(v1Snapshot({ version: 'v2', pendingDust: [] }));
  });

  it('treats a snapshot with no version as v1', () => {
    const { version: _version, ...unversioned } = v1Snapshot();

    expect(upgradeSnapshotV1ToV2(unversioned)).toEqual({ ...unversioned, version: 'v2', pendingDust: [] });
  });

  it('keeps a pendingDust that is already there, so the step fills in what is missing and never overwrites', () => {
    const withPending = v1Snapshot({ pendingDust: [pendingCoin] });

    expect(upgradeSnapshotV1ToV2(withPending)).toEqual({ ...withPending, version: 'v2' });
  });

  it('is idempotent: applying it twice is applying it once', () => {
    const once = upgradeSnapshotV1ToV2(v1Snapshot());

    expect(upgradeSnapshotV1ToV2(once)).toEqual(once);
  });

  it('preserves every other field, known or not, untouched', () => {
    const upgraded = upgradeSnapshotV1ToV2(v1Snapshot({ somethingNewer: { kept: true } }));

    expect(upgraded).toMatchObject({
      somethingNewer: { kept: true },
      state: 'abcd',
      publicKey: { publicKey: '1234' },
      protocolVersion: '0',
      networkId: 'undeployed',
    });
  });

  it('does not touch a version it does not own, so the schema after it is what refuses it', () => {
    const newer = v1Snapshot({ version: 'v3' });

    expect(upgradeSnapshotV1ToV2(newer)).toEqual(newer);
  });

  it('hands anything that is not an object straight back for the schema to refuse', () => {
    expect(upgradeSnapshotV1ToV2('not a snapshot')).toBe('not a snapshot');
    expect(upgradeSnapshotV1ToV2(null)).toBeNull();
    expect(upgradeSnapshotV1ToV2([1, 2])).toEqual([1, 2]);
  });
});
