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
import { describe, it, expect } from 'vitest';
import { upgradeV1ToV2, upgradeToCurrentFormat } from '../TransactionHistoryFormat.js';

/**
 * The first format: a bare array, no envelope. Entries carry no `lifecycle`, because the field did not exist when this
 * shape was written. Kept minimal on purpose — the step works on encoded JSON before any entry schema runs, so the
 * wallet sections a real payload also carries are beside the point here.
 */
const firstFormat = [
  { hash: '0xaaa', protocolVersion: 1, status: 'SUCCESS', identifiers: ['identifier-1'], fees: '1234' },
  { hash: '0xbbb', protocolVersion: 1, status: 'FAILURE' },
];

describe('the v1 to v2 upgrade step', () => {
  it('should wrap a bare array in a v2 envelope', () => {
    const upgraded = upgradeV1ToV2(firstFormat);

    expect(upgraded).toMatchObject({ version: 'v2' });
    expect((upgraded as { entries: readonly unknown[] }).entries).toHaveLength(2);
  });

  it('should give every entry a finalized lifecycle with no block', () => {
    const upgraded = upgradeV1ToV2(firstFormat) as { entries: readonly { lifecycle: unknown }[] };

    expect(upgraded.entries.map((entry) => entry.lifecycle)).toEqual([
      { status: 'finalized' },
      { status: 'finalized' },
    ]);
  });

  it('should default a missing identifiers list to empty and keep one that was written', () => {
    const upgraded = upgradeV1ToV2(firstFormat) as { entries: readonly { identifiers: unknown }[] };

    expect(upgraded.entries.map((entry) => entry.identifiers)).toEqual([['identifier-1'], []]);
  });

  it('should carry every other field through untouched', () => {
    const upgraded = upgradeV1ToV2(firstFormat) as { entries: readonly Record<string, unknown>[] };

    expect(upgraded.entries[0]).toMatchObject({
      hash: '0xaaa',
      protocolVersion: 1,
      status: 'SUCCESS',
      fees: '1234',
    });
    expect(upgraded.entries[1]).toMatchObject({ hash: '0xbbb', protocolVersion: 1, status: 'FAILURE' });
  });

  it('should leave a lifecycle that is already present exactly as it was', () => {
    const alreadyHasOne = [
      {
        hash: '0xccc',
        identifiers: ['identifier-2'],
        lifecycle: { status: 'finalized', finalizedBlock: { hash: '0xblock', height: 99, timestamp: 1 } },
      },
    ];

    const upgraded = upgradeV1ToV2(alreadyHasOne) as { entries: readonly { lifecycle: unknown }[] };

    expect(upgraded.entries[0]?.lifecycle).toEqual({
      status: 'finalized',
      finalizedBlock: { hash: '0xblock', height: 99, timestamp: 1 },
    });
  });

  it('should produce the same result when applied to its own output', () => {
    const once = upgradeV1ToV2(firstFormat) as { entries: readonly unknown[] };

    const twice = upgradeV1ToV2(once.entries);

    expect(twice).toEqual(once);
  });
});

describe('running a stored payload through every upgrade step', () => {
  it('should bring the first format all the way to the current one', () => {
    expect(upgradeToCurrentFormat(firstFormat)).toEqual({
      version: 'v2',
      entries: [
        {
          hash: '0xaaa',
          protocolVersion: 1,
          status: 'SUCCESS',
          identifiers: ['identifier-1'],
          fees: '1234',
          lifecycle: { status: 'finalized' },
        },
        {
          hash: '0xbbb',
          protocolVersion: 1,
          status: 'FAILURE',
          identifiers: [],
          lifecycle: { status: 'finalized' },
        },
      ],
    });
  });

  it('should leave a payload that is already in the current format untouched', () => {
    const current = {
      version: 'v2',
      entries: [{ hash: '0xddd', identifiers: [], lifecycle: { status: 'pending', submittedAt: 1 } }],
    };

    expect(upgradeToCurrentFormat(current)).toEqual(current);
  });
});
