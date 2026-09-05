#!/usr/bin/env node
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
// @ts-check
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Each side of a protocol boundary is named by ledger version (v8/v9) or by wallet variant (V1/V2), never by where
// it sits relative to a fork — see "Naming the two sides of a fork" in CLAUDE.md. This walks every tracked
// file and fails on the words that decision retires, in identifiers and prose alike, because both drift the same way.
//
// Waivers, for the few places that have to quote a retired name (the CLAUDE.md section, a changeset's before/after table):
//   - a line containing `fork-vocabulary: allow` is skipped;
//   - the lines between `fork-vocabulary: allow-start` and `fork-vocabulary: allow-end` are skipped.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-fork-vocabulary.mjs';

/**
 * The retired words. Unanchored at the start so one buried in a camel-cased identifier is found too.
 *
 * @type {readonly { pattern: RegExp; instead: string }[]}
 */
const RETIRED = [
  { pattern: /pre[-_ ]?fork/i, instead: 'the ledger version (v8) or the variant (V1)' },
  { pattern: /post[-_ ]?fork/i, instead: 'the ledger version (v9) or the variant (V2)' },
  { pattern: /before[-_ ]?fork(?!ing\b|ed\b)|before the fork/i, instead: 'below `forks.v9`, or the ledger version (v8)' },
  { pattern: /after[-_ ]?fork(?!ing\b|ed\b)|after the fork/i, instead: 'from `forks.v9`, or the ledger version (v9)' },
  { pattern: /current[-_ ]?ledger/i, instead: 'ledger-v9; "current" is wrong the day after the next fork' },
  // Phrases only: `newLedger` as a parameter is relative to the block just applied, and `new ledger.X()` is a constructor.
  {
    pattern: /\b(?:old|new|legacy) ledger version\b|\bthe (?:old|new|legacy) ledger\b/i,
    instead: 'ledger-v8 or ledger-v9',
  },
];

const ALLOW_LINE = /fork-vocabulary:\s*allow(?![-\w])/;
const ALLOW_START = /fork-vocabulary:\s*allow-start/;
const ALLOW_END = /fork-vocabulary:\s*allow-end/;

/**
 * Released history and generated or vendored files are not ours to reword.
 *
 * @param {string} file
 * @returns {boolean}
 */
const isExcluded = (file) =>
  file === SELF ||
  file.endsWith('CHANGELOG.md') ||
  file.startsWith('release-notes/') ||
  file.startsWith('.yarn/') ||
  file.endsWith('.lock');

/**
 * @param {Buffer} bytes
 * @returns {boolean}
 */
const isBinary = (bytes) => bytes.subarray(0, 8000).includes(0);

/** @typedef {{ file: string; line: number; column: number; text: string; instead: string }} Hit */

/**
 * @param {string} file
 * @param {string} text
 * @returns {readonly Hit[]}
 */
const hitsIn = (file, text) =>
  text.split('\n').reduce(
    (/** @type {{ allowing: boolean; hits: readonly Hit[] }} */ state, line, index) => {
      if (ALLOW_END.test(line)) return { ...state, allowing: false };
      if (state.allowing || ALLOW_START.test(line) || ALLOW_LINE.test(line)) {
        return { ...state, allowing: state.allowing || ALLOW_START.test(line) };
      }
      const found = RETIRED.flatMap(({ pattern, instead }) => {
        const match = pattern.exec(line);
        return match === null ? [] : [{ file, line: index + 1, column: match.index + 1, text: match[0], instead }];
      });
      return { ...state, hits: [...state.hits, ...found] };
    },
    { allowing: false, hits: [] },
  ).hits;

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf-8' })
  .split('\0')
  .filter((file) => file !== '' && !isExcluded(file));

const hits = trackedFiles.flatMap((file) => {
  const bytes = fs.readFileSync(path.join(repoRoot, file));
  return isBinary(bytes) ? [] : hitsIn(file, bytes.toString('utf-8'));
});

if (hits.length === 0) {
  console.log(`fork vocabulary: no retired name in ${trackedFiles.length} tracked files`);
  process.exit(0);
}

hits.forEach(({ file, line, column, text, instead }) =>
  console.error(`${file}:${line}:${column}  "${text}"  — say ${instead}`),
);
console.error(
  `\n${hits.length} retired fork-relative name(s) in ${new Set(hits.map((hit) => hit.file)).size} file(s). ` +
    'Name the side by ledger version (v8/v9) or by variant (V1/V2); see "Naming the two sides of a fork" in CLAUDE.md.',
);
process.exit(1);
