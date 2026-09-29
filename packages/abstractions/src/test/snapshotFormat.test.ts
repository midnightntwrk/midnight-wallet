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
import { Either, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_WRITERS,
  V1_SNAPSHOT_WRITER,
  V2_SNAPSHOT_WRITER,
  isSnapshotWriter,
  versionField,
  writtenByField,
  readSnapshot,
  SnapshotRestoreError,
} from '../SnapshotFormat.js';

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) => Schema.decodeUnknownEither(schema)(value);

describe('the version field of a snapshot', () => {
  const Snapshot = Schema.Struct({ version: versionField('shielded', 'v1'), payload: Schema.String });

  it('accepts the version it was declared with', () => {
    expect(decode(Snapshot, { version: 'v1', payload: 'x' })).toEqual(Either.right({ version: 'v1', payload: 'x' }));
  });

  it('reads a snapshot with no version as the declared one', () => {
    expect(decode(Snapshot, { payload: 'x' })).toEqual(Either.right({ version: 'v1', payload: 'x' }));
  });

  it('refuses any other version, naming the surface, the version found and the version it reads', () => {
    const refused = decode(Snapshot, { version: 'v2', payload: 'x' });

    expect(Either.isLeft(refused)).toBe(true);
    expect(String(Either.isLeft(refused) ? refused.left.message : '')).toContain(
      'Refusing a shielded snapshot written in format version "v2": this build reads v1 and does not downgrade.',
    );
  });

  it('spells the article for a surface that starts with a vowel', () => {
    const Unshielded = Schema.Struct({ version: versionField('unshielded', 'v2') });
    const refused = decode(Unshielded, { version: 'v3' });

    expect(String(Either.isLeft(refused) ? refused.left.message : '')).toContain('Refusing an unshielded snapshot');
  });
});

describe('the writtenBy field of a snapshot', () => {
  const Snapshot = Schema.Struct({ writtenBy: writtenByField() });

  it('names the two variants by their ordinals', () => {
    expect(SNAPSHOT_WRITERS).toEqual(['v1', 'v2']);
    expect(V1_SNAPSHOT_WRITER).toBe('v1');
    expect(V2_SNAPSHOT_WRITER).toBe('v2');
  });

  it('accepts either writer and a snapshot that names none', () => {
    expect(decode(Snapshot, { writtenBy: 'v1' })).toEqual(Either.right({ writtenBy: 'v1' }));
    expect(decode(Snapshot, { writtenBy: 'v2' })).toEqual(Either.right({ writtenBy: 'v2' }));
    expect(decode(Snapshot, {})).toEqual(Either.right({}));
  });

  // The writer is a routing hint, not part of the shape: a later variant naming itself must not turn a format this
  // build reads into one it refuses, or adding a variant would be a de-facto format bump for every older reader.
  it('carries a writer it does not know through, for routing to decide', () => {
    expect(decode(Snapshot, { writtenBy: 'v3' })).toEqual(Either.right({ writtenBy: 'v3' }));
  });

  it('tells the writers this build knows apart from any other value', () => {
    expect(isSnapshotWriter('v1')).toBe(true);
    expect(isSnapshotWriter('v2')).toBe(true);
    expect(isSnapshotWriter('v3')).toBe(false);
    expect(isSnapshotWriter('')).toBe(false);
    expect(isSnapshotWriter(1)).toBe(false);
    expect(isSnapshotWriter(undefined)).toBe(false);
  });
});

describe('reading a snapshot', () => {
  const Snapshot = Schema.Struct({ version: versionField('shielded', 'v1'), payload: Schema.String });
  const read = readSnapshot({ surface: 'shielded', reads: ['v1'], schema: Snapshot });
  const refusal = (serialized: string): SnapshotRestoreError =>
    Either.match(read(serialized), {
      onLeft: (error) => error,
      onRight: () => {
        throw new Error('expected a refusal');
      },
    });

  it('reads a snapshot in a version it accepts, and one that declares none as the oldest accepted', () => {
    expect(read(JSON.stringify({ version: 'v1', payload: 'x' }))).toEqual(
      Either.right({ version: 'v1', payload: 'x' }),
    );
    expect(read(JSON.stringify({ payload: 'x' }))).toEqual(Either.right({ version: 'v1', payload: 'x' }));
  });

  it('refuses a string that is not JSON as unparseable', () => {
    const error = refusal('not json');

    expect(error).toBeInstanceOf(SnapshotRestoreError);
    expect(error).toMatchObject({ surface: 'shielded', reason: 'unparseable', detectedVersion: 'unrecognised' });
    expect(error.message).toContain('Could not restore the shielded snapshot (format unrecognised, unparseable)');
  });

  it('refuses a version it does not read as unknown, naming the version found and the one it reads', () => {
    const error = refusal(JSON.stringify({ version: 'v2', payload: 'x' }));

    expect(error).toMatchObject({ surface: 'shielded', reason: 'unknown-version', detectedVersion: 'v2' });
    expect(error.message).toContain(
      'Refusing a shielded snapshot written in format version "v2": this build reads v1 and does not downgrade.',
    );
    expect(String(error)).toContain('unknown-version');
  });

  it('refuses contents that fail the schema as an invalid shape, against the version the snapshot declared', () => {
    const error = refusal(JSON.stringify({ version: 'v1', payload: 42 }));

    expect(error).toMatchObject({ surface: 'shielded', reason: 'invalid-shape', detectedVersion: 'v1' });
    expect(error.message).toContain('payload');
  });

  it('runs the upgrade step on an older accepted version before the schema sees it', () => {
    const Newer = Schema.Struct({
      version: versionField('unshielded', 'v2'),
      key: Schema.Struct({ tag: Schema.String }),
    });
    const readNewer = readSnapshot({
      surface: 'unshielded',
      reads: ['v1', 'v2'],
      schema: Newer,
      upgrade: (json) =>
        typeof json === 'object' && json !== null && 'key' in json && typeof json.key === 'string'
          ? { ...json, version: 'v2', key: { tag: json.key } }
          : json,
    });

    expect(readNewer(JSON.stringify({ version: 'v1', key: 'schnorr' }))).toEqual(
      Either.right({ version: 'v2', key: { tag: 'schnorr' } }),
    );
    expect(Either.isLeft(readNewer(JSON.stringify({ version: 'v3', key: { tag: 'x' } })))).toBe(true);
  });

  it('refuses a non-string version as unknown, naming what it found', () => {
    const error = refusal(JSON.stringify({ version: 2, payload: 'x' }));

    expect(error).toMatchObject({ surface: 'shielded', reason: 'unknown-version', detectedVersion: '2' });
  });

  it('refuses JSON that is not an object as unrecognised', () => {
    expect(refusal('[]')).toMatchObject({
      surface: 'shielded',
      reason: 'unrecognised',
      detectedVersion: 'unrecognised',
    });
    expect(refusal('null')).toMatchObject({
      surface: 'shielded',
      reason: 'unrecognised',
      detectedVersion: 'unrecognised',
    });
  });

  it('does not run the upgrade step on the current version', () => {
    const Newer = Schema.Struct({
      version: versionField('unshielded', 'v2'),
      key: Schema.Struct({ tag: Schema.String }),
    });
    const readNewer = readSnapshot({
      surface: 'unshielded',
      reads: ['v1', 'v2'],
      schema: Newer,
      upgrade: () => {
        throw new Error('the upgrade step ran on a snapshot already in the current version');
      },
    });

    expect(readNewer(JSON.stringify({ version: 'v2', key: { tag: 'schnorr' } }))).toEqual(
      Either.right({ version: 'v2', key: { tag: 'schnorr' } }),
    );
  });
});
