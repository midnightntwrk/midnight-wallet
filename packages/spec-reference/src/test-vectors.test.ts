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
import { describe, test } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { generateTestVectors, seeds } from './test-vectors.js';

const options = {
  dir: process.env['TEST_VECTORS_DIR'] ?? path.resolve(import.meta.dirname, '..', 'test-vectors'),
};

describe('Test vectors against reference implementation', () => {
  const vectorEntries = Object.entries(generateTestVectors(seeds));

  test.for(vectorEntries)('%s', ([name, values], { expect }) => {
    const pathToLoad = path.resolve(options.dir, `${name}.json`);
    const fromFile: unknown = JSON.parse(fs.readFileSync(pathToLoad, 'utf-8'));

    expect(values).toEqual(fromFile);
  });
});
