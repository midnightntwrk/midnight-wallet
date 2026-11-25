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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SMOKE_SNIPPETS, withSmokeTag } from './smokeSnippets.js';

const snippetsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'snippets');

describe('the snippets the pull-request smoke lane runs', () => {
  it('should each name a snippet that exists and needs a network, because a name matching none drops it from the lane without failing', () => {
    const networked = fs
      .readdirSync(snippetsDir)
      .map((file) => file.split('.'))
      .filter((parts) => !parts.includes('no-net'))
      .map(([name]) => name);

    expect([...SMOKE_SNIPPETS].filter((name) => !networked.includes(name))).toEqual([]);
  });

  it('should tag at least one snippet, and each listed snippet only, @smoke, because the lane selects by that tag alone', () => {
    expect(SMOKE_SNIPPETS.size).toBeGreaterThan(0);
    expect([...SMOKE_SNIPPETS].map((name) => withSmokeTag({ name }).title)).toEqual(
      [...SMOKE_SNIPPETS].map((name) => `${name} @smoke`),
    );
    expect(withSmokeTag({ name: 'not-a-smoke-snippet' }).title).toBe('not-a-smoke-snippet');
  });
});
