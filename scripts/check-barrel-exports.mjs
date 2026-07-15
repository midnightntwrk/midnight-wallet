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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Barrel packages re-export from sibling packages and require every src/ entry
// to have a matching `exports` key (and vice versa). Implementation packages
// have selective exports and aren't checked here.
const BARREL_PACKAGES = ['packages/wallet-sdk'];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} srcDir
 * @returns {string[]}
 */
const listSourceFiles = (srcDir) => {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'test' || entry.name === '__tests__') continue;
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        out.push(full);
      }
    }
  };
  walk(srcDir);
  return out;
};

// src/index.ts            -> "."
// src/foo.ts              -> "./foo"
// src/foo/index.ts        -> "./foo"
// src/foo/bar.ts          -> "./foo/bar"
/**
 * @param {string} srcDir
 * @param {string} file
 * @returns {string}
 */
const exportsKeyFor = (srcDir, file) => {
  const rel = path.relative(srcDir, file).split(path.sep).join('/');
  const noExt = rel.replace(/\.ts$/, '');
  const normalized = noExt.endsWith('/index') ? noExt.slice(0, -'/index'.length) : noExt;
  if (normalized === 'index' || normalized === '') return '.';
  return `./${normalized}`;
};

let drift = 0;

for (const pkgRel of BARREL_PACKAGES) {
  const pkgDir = path.join(repoRoot, pkgRel);
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  const srcDir = path.join(pkgDir, 'src');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  if (!pkgJson.exports || typeof pkgJson.exports !== 'object') {
    console.error(`${pkgRel}: no "exports" field in package.json`);
    drift++;
    continue;
  }

  const declared = new Set(Object.keys(pkgJson.exports));
  const expected = new Set(listSourceFiles(srcDir).map((f) => exportsKeyFor(srcDir, f)));

  const missing = [...expected].filter((k) => !declared.has(k)).sort();
  const orphaned = [...declared].filter((k) => !expected.has(k)).sort();

  if (missing.length || orphaned.length) {
    console.error(`\n${pkgRel}: exports drift detected`);
    if (missing.length) {
      console.error('  src files without an exports entry:');
      for (const k of missing) console.error(`    ${k}`);
    }
    if (orphaned.length) {
      console.error('  exports entries without a matching src file:');
      for (const k of orphaned) console.error(`    ${k}`);
    }
    drift++;
  } else {
    console.log(`${pkgRel}: ${expected.size} exports in sync with src/`);
  }
}

process.exit(drift ? 1 : 0);
