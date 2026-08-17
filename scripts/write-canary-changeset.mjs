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

// Writes a temporary changeset that patch-bumps EVERY publishable package so a
// canary snapshot covers the whole SDK as one coherent set from a single commit.
// `changeset version --snapshot` otherwise versions only packages named in a
// changeset (plus their dependents), which would leave the `canary` dist-tag
// inconsistent across packages.
//
// Run ONLY in the canary CD job; the checkout is discarded afterwards. Existing
// real changesets are left in place — their semver bump (minor/major) still
// wins over this patch.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'));
const ignore = new Set(config.ignore ?? []);

// Same publishable set as scripts/publish-alias.mjs (non-private workspaces),
// minus changeset-ignored names so `changeset version` doesn't choke on them.
const names = execFileSync('yarn', ['workspaces', 'list', '--json'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .filter((ws) => ws.location !== '.')
  .flatMap((ws) => {
    const pkg = JSON.parse(readFileSync(resolve(ws.location, 'package.json'), 'utf8'));
    return pkg.private || ignore.has(pkg.name) ? [] : [pkg.name];
  });

if (names.length === 0) {
  console.log('No publishable packages found — not writing a canary changeset.');
  process.exit(0);
}

const frontmatter = names.map((name) => `'${name}': patch`).join('\n');
writeFileSync(
  '.changeset/zzz-canary-all-packages.md',
  `---\n${frontmatter}\n---\n\nCanary snapshot of all packages.\n`,
);
console.log(`Wrote canary changeset covering ${names.length} package(s).`);
