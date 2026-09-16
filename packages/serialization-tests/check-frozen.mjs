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

/*
 * Refuse any change to a fixture captured from a published release.
 *
 * Those files are the only record of what a shipped SDK actually wrote. If one can be edited, every compatibility test
 * above it can be made to pass by editing the evidence instead of fixing the code — which is exactly the failure this
 * whole package exists to prevent. A fixture is therefore append-only: new release folders may be added, existing ones
 * never touched.
 *
 * The drift baseline (_baseline) is deliberately exempt. It records what the current code writes and is meant
 * to be recaptured.
 *
 *     node check-frozen.mjs [baseRef]        # default base: origin/main
 */

import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'origin/main';
const FROZEN = /^packages\/serialization-tests\/fixtures\/(?!_baseline\/)/;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const mergeBase = (() => {
  try {
    return git('merge-base', BASE, 'HEAD');
  } catch {
    console.error(`Could not find a merge base with ${BASE}. Fetch it first, or pass a different base ref.`);
    process.exit(2);
  }
})();

const changed = git('diff', '--name-status', `${mergeBase}...HEAD`)
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => {
    const [status, ...paths] = line.split('\t');
    return { status: status[0], path: paths[paths.length - 1] };
  });

// An added file under a new release folder is how a fixture corpus grows; anything else is a change to the record.
const violations = changed.filter(({ status, path }) => FROZEN.test(path) && status !== 'A');

if (violations.length === 0) {
  console.log(`No published fixture was modified (compared against ${BASE}).`);
  process.exit(0);
}

console.error('Published fixtures are frozen, but this branch changes them:\n');
for (const { status, path } of violations) {
  console.error(`  ${status === 'D' ? 'deleted ' : 'modified'}  ${path}`);
}
console.error(`
Each of these records what a published release actually wrote, so it is the evidence the compatibility tests check
against. If a test fails, fix the code — editing the fixture makes the test pass and the bug ship.

If a payload was genuinely captured wrongly, say so explicitly in the pull request and have someone confirm it before
overriding this check.`);
process.exit(1);
