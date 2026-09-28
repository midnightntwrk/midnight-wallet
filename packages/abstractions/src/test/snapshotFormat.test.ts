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
import { versionField } from '../SnapshotFormat.js';

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
