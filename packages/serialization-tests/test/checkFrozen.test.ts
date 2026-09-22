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
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The gate that stops a failing compatibility test being "fixed" by rewriting the evidence.
 *
 * Every other check in this package is a test; this one is a script run by a CI job of its own, because it needs git
 * history rather than a test runner. That is exactly why it is the one check nothing was holding to account: a script
 * that silently stopped flagging anything would leave the whole corpus editable and every suite above it green, and the
 * failure would be invisible until someone edited a fixture and nobody noticed.
 *
 * So it is exercised here the way CI exercises it — as a process, against a real repository, asserting the exit code a
 * workflow actually branches on. The repository is built for each case in a temporary directory, so nothing here
 * depends on the state of the one this file lives in.
 *
 * The exit codes carry distinct meanings and are asserted as such: `0` nothing to report, `1` a published fixture
 * changed, `2` git could not answer. The script separates the last two deliberately — a git that could not run is not
 * the same answer as a fixture that changed, and a CI job that treated them alike would pass on a broken checkout.
 */

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-frozen.mjs');

/** A path inside the corpus the script guards, and one outside it. */
const FROZEN_FIXTURE = 'packages/serialization-tests/fixtures/shielded/v1/facade-1.0.0.json';
const BASELINE = 'packages/serialization-tests/fixtures/_baseline/v1/shielded.json';
const UNRELATED = 'packages/shielded-wallet/src/v1/Serialization.ts';

const repos: string[] = [];

afterEach(() => {
  repos.splice(0).forEach((repo) => rmSync(repo, { recursive: true, force: true }));
});

const git = (repo: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

const write = (repo: string, path: string, contents: string): void => {
  mkdirSync(join(repo, dirname(path)), { recursive: true });
  writeFileSync(join(repo, path), contents);
};

/**
 * A repository holding a corpus, with `main` at the state every case branches from.
 *
 * Committed on a branch named `main` so the script's own default base ref is the one under test, and with identity and
 * signing settled locally so the test does not depend on the machine's git configuration.
 */
const repoWithACorpus = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'check-frozen-'));
  repos.push(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  write(repo, FROZEN_FIXTURE, '{ "serialized": "what 1.0.0 wrote" }\n');
  write(repo, BASELINE, '{ "serialized": "what this build writes" }\n');
  write(repo, UNRELATED, 'export const unchanged = true;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'the corpus as it stands');
  git(repo, 'checkout', '--quiet', '-b', 'a-branch');
  return repo;
};

/** Commit whatever the case has just done, so the script has a branch to diff against `main`. */
const commit = (repo: string, message: string): void => {
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', message);
};

/** Run the script exactly as the CI job runs it, and report what a workflow would branch on. */
const runCheck = (repo: string, base = 'main'): { readonly status: number; readonly output: string } => {
  const result = spawnSync(process.execPath, [SCRIPT, base], { cwd: repo, encoding: 'utf8' });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
};

describe('the frozen-fixture check', () => {
  it('passes a branch that changed nothing', () => {
    const repo = repoWithACorpus();

    expect(runCheck(repo).status).toBe(0);
  });

  // How the corpus is meant to grow: a release is captured and filed under its own name.
  it('passes a branch that adds a fixture', () => {
    const repo = repoWithACorpus();
    write(repo, 'packages/serialization-tests/fixtures/shielded/v2/facade-5.0.0.json', '{ "serialized": "new" }\n');
    commit(repo, 'capture a new release');

    expect(runCheck(repo).status).toBe(0);
  });

  it('fails a branch that edits a published fixture, naming the file', () => {
    const repo = repoWithACorpus();
    write(repo, FROZEN_FIXTURE, '{ "serialized": "something more convenient" }\n');
    commit(repo, 'make the failing test pass');

    const { status, output } = runCheck(repo);

    expect(status).toBe(1);
    expect(output).toContain(FROZEN_FIXTURE);
  });

  it('fails a branch that deletes a published fixture', () => {
    const repo = repoWithACorpus();
    rmSync(join(repo, FROZEN_FIXTURE));
    commit(repo, 'drop the inconvenient evidence');

    expect(runCheck(repo).status).toBe(1);
  });

  // Moving a fixture out of the corpus loses the record as surely as editing it, which is why the script reads both
  // sides of a rename rather than only the destination.
  it('fails a branch that moves a published fixture out of the corpus', () => {
    const repo = repoWithACorpus();
    git(repo, 'mv', FROZEN_FIXTURE, 'packages/serialization-tests/fixtures-old.json');
    commit(repo, 'tidy the fixtures away');

    expect(runCheck(repo).status).toBe(1);
  });

  // The baseline records what the current code writes and is meant to be recaptured, so editing it is ordinary work.
  it('passes a branch that re-records the drift baseline', () => {
    const repo = repoWithACorpus();
    write(repo, BASELINE, '{ "serialized": "what this build writes now" }\n');
    commit(repo, 'yarn capture');

    expect(runCheck(repo).status).toBe(0);
  });

  it('passes a branch that changes code outside the corpus', () => {
    const repo = repoWithACorpus();
    write(repo, UNRELATED, 'export const unchanged = false;\n');
    commit(repo, 'an ordinary change');

    expect(runCheck(repo).status).toBe(0);
  });

  // The distinction the script is careful about: a git that could not answer must not read as a clean run. A CI job
  // that treated 2 as 0 would pass on a checkout too shallow to find the base, which is the shape of checkout every
  // other job in this repo uses.
  it('reports a base ref it cannot resolve as a git failure, not as a pass and not as a violation', () => {
    const repo = repoWithACorpus();
    write(repo, FROZEN_FIXTURE, '{ "serialized": "edited" }\n');
    commit(repo, 'edit a fixture');

    const { status, output } = runCheck(repo, 'origin/a-branch-that-does-not-exist');

    expect(status).toBe(2);
    expect(output).toContain('Could not find a merge base');
  });
});
