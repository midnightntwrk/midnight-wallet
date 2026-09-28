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

// Dev-time helper: dump the API surface of each historical train so generate.mjs
// can be written against facts instead of guesses. Not needed after fixtures exist.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = (alias) => path.join(HERE, 'node_modules', alias);

// Resolve a dependency exactly as the aliased package itself would (nested vs hoisted node_modules).
export const resolveFromPkg = (alias, dep) => createRequire(path.join(pkgDir(alias), 'dist', 'index.js')).resolve(dep);

const surface = async (alias, files) => {
  console.log(`\n===== ${alias}`);
  const pkgJson = JSON.parse(readFileSync(path.join(pkgDir(alias), 'package.json'), 'utf8'));
  const ledgerDep = Object.keys(pkgJson.dependencies ?? {}).find((d) => d.includes('ledger'));
  console.log(`  version: ${pkgJson.version}  ledger: ${ledgerDep}@${pkgJson.dependencies[ledgerDep]}`);
  for (const f of files) {
    const p = path.join(pkgDir(alias), 'dist', f);
    if (!existsSync(p)) {
      console.log(`  ${f}: (absent)`);
      continue;
    }
    try {
      const mod = await import(pathToFileURL(p));
      const names = Object.keys(mod);
      console.log(`  ${f}: ${names.join(', ')}`);
      for (const n of names) {
        const v = mod[n];
        if (typeof v === 'function' && /CoreWallet|State|Storage/.test(n)) {
          const statics = Object.getOwnPropertyNames(v).filter(
            (p2) => typeof v[p2] === 'function' && !['bind', 'call', 'apply'].includes(p2),
          );
          if (statics.length > 0) console.log(`    ${n} statics: ${statics.join(', ')}`);
        }
      }
    } catch (e) {
      console.log(`  ${f}: FAILED TO IMPORT (${String(e.message).slice(0, 120)})`);
    }
  }
};

// The aliases are the generator's own: version-named per package (`sh-3.0.2`, not a train label), declared in
// package.json. Reading them from there keeps this in step with `generate.mjs` without importing it, which would
// run the generator.
const ownPkg = JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8'));
const aliasesOf = (wallet) =>
  Object.keys(ownPkg.dependencies ?? {})
    .filter((alias) => alias.startsWith(`${wallet}-`))
    .filter((alias) => !process.argv[3] || alias === `${wallet}-${process.argv[3]}`);
const wallets = process.argv[2] ? [process.argv[2]] : ['sh', 'un', 'du'];
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const w of wallets) {
    for (const alias of aliasesOf(w)) {
      await surface(alias, ['v1/Serialization.js', 'v1/CoreWallet.js', 'v1/UnshieldedState.js', 'v1/Keys.js']);
    }
  }
}
