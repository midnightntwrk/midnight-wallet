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

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'generate-evidence.mjs');

/** Runs the generator as a subprocess over one report and returns the rendered document. */
const render = (report: unknown, extraArgs: readonly string[] = []): string => {
  const dir = mkdtempSync(join(tmpdir(), 'wallet-sdk-evidence-'));
  try {
    const reportPath = join(dir, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report));
    const outDir = join(dir, 'out');
    mkdirSync(outDir, { recursive: true });
    execFileSync(
      'node',
      [scriptPath, `preview:smoke:${reportPath}`, '--version', '1.2.1', '--out', outDir, ...extraArgs],
      { stdio: 'pipe' },
    );
    return readFileSync(join(outDir, 'README.md'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Shape captured from a real run: an import error aborts the suite before any
// test executes, so Vitest reports zero tests but success: false, and puts the
// cause on the file-level `message`.
const suiteFailureReport = {
  numTotalTests: 0,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  success: false,
  testResults: [
    {
      name: '/repo/packages/e2e-tests/src/tests/balanceConstant.remote.test.ts',
      startTime: 1785150554552,
      endTime: 1785150554552,
      status: 'failed',
      message: "Cannot find package '@midnightntwrk/ledger-v9' imported from /repo/packages/facade/dist/index.js",
      assertionResults: [],
    },
  ],
};

const passingReport = {
  numTotalTests: 2,
  numPassedTests: 1,
  numFailedTests: 0,
  numPendingTests: 1,
  numTodoTests: 0,
  success: true,
  testResults: [
    {
      name: '/repo/packages/e2e-tests/src/tests/tokenTransfer.undeployed.test.ts',
      startTime: 0,
      endTime: 45000,
      status: 'passed',
      assertionResults: [
        { title: 'transfers shielded tokens', status: 'passed', duration: 21000 },
        { title: 'handles dust exhaustion', status: 'pending', duration: null },
      ],
    },
  ],
};

// Shape captured from a real stagenet run: the tests executed and failed on
// assertions, with the cause in `failureMessages` (repeated per assertion).
const failingTestReport = {
  numTotalTests: 1,
  numPassedTests: 0,
  numFailedTests: 1,
  numPendingTests: 0,
  numTodoTests: 0,
  success: false,
  testResults: [
    {
      name: '/repo/packages/e2e-tests/src/tests/balanceConstant.remote.test.ts',
      startTime: 0,
      endTime: 24000,
      status: 'failed',
      assertionResults: [
        {
          title: 'Balance is constant when syncing from 0 @healthcheck',
          status: 'failed',
          duration: 24168,
          failureMessages: [
            'AssertionError: expected undefined to be 10000000n // Object.is equality\n    at eval (balanceConstant.ts:61)',
            'AssertionError: expected undefined to be 10000000n // Object.is equality\n    at eval (balanceConstant.ts:61)',
          ],
        },
      ],
    },
  ],
};

// Shape captured from a real crashed run: the Vitest worker died before any
// test executed. Vitest's JSON reporter has no field for unhandled errors, so
// it still claims success with zero failing tests -- only the process exit code
// reveals the failure.
const crashedRunReport = {
  numTotalTests: 2,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  success: true,
  testResults: [
    {
      name: '/repo/packages/e2e-tests/src/tests/balanceConstant.remote.test.ts',
      startTime: 0,
      endTime: 2000,
      status: 'passed',
      assertionResults: [
        { title: 'Balance is constant when syncing from 0 @healthcheck', status: 'pending', duration: null },
        {
          title: 'Balance is constant when syncing from a restored state @healthcheck',
          status: 'pending',
          duration: null,
        },
      ],
    },
  ],
};

describe('generate-evidence', () => {
  describe('suite-level failure (no tests executed)', () => {
    it('reports overall FAILURE', () => {
      expect(render(suiteFailureReport)).toContain('❌ **FAILURE**');
    });

    it('surfaces the underlying error message in the detail section', () => {
      expect(render(suiteFailureReport)).toContain(
        "Cannot find package '@midnightntwrk/ledger-v9' imported from /repo/packages/facade/dist/index.js",
      );
    });

    it('marks the file as a suite that failed to run', () => {
      const doc = render(suiteFailureReport);
      expect(doc).toContain('#### `balanceConstant.remote.test.ts`');
      expect(doc).toContain('Suite failed to run');
    });

    it('warns above the fold that a suite produced no tests', () => {
      expect(render(suiteFailureReport)).toContain('1 suite failed to run before executing any test');
    });

    it('leaves no empty detail block for the failed file', () => {
      const doc = render(suiteFailureReport);
      const heading = '#### `balanceConstant.remote.test.ts`';
      const after = doc.slice(doc.indexOf(heading) + heading.length);
      // Bound the body to this file's own block — up to the next heading of any
      // level — so the following top-level sections cannot pad it out.
      const nextHeading = after.search(/\n#{2,4} /);
      const body = (nextHeading === -1 ? after : after.slice(0, nextHeading)).trim();
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe('normal run', () => {
    it('renders per-test detail lines', () => {
      const doc = render(passingReport);
      expect(doc).toContain('- ✅ transfers shielded tokens (21.0s)');
      expect(doc).toContain('- ⏭️ handles dust exhaustion — **pending**');
    });

    it('does not emit suite-failure markers', () => {
      const doc = render(passingReport);
      expect(doc).not.toContain('Suite failed to run');
      expect(doc).not.toContain('failed to run before executing any test');
    });

    it('reports overall SUCCESS', () => {
      expect(render(passingReport)).toContain('✅ **SUCCESS**');
    });
  });

  describe('failed test detail', () => {
    it('renders the assertion failure reason under the failed test', () => {
      expect(render(failingTestReport)).toContain(
        'AssertionError: expected undefined to be 10000000n // Object.is equality',
      );
    });

    it('deduplicates a reason repeated across assertions', () => {
      const doc = render(failingTestReport);
      const occurrences = doc.split('AssertionError: expected undefined to be 10000000n').length - 1;
      expect(occurrences).toBe(1);
    });

    it('omits stack frames, keeping only the first line of each message', () => {
      expect(render(failingTestReport)).not.toContain('at eval (balanceConstant.ts:61)');
    });

    it('adds no reason lines for passing tests', () => {
      expect(render(passingReport)).not.toContain('AssertionError');
    });
  });

  describe('run that exited non-zero while reporting success', () => {
    it('reports FAILURE when the step outcome says the run failed', () => {
      expect(render(crashedRunReport, ['--outcomes', 'failure'])).toContain('❌ **FAILURE**');
    });

    it('warns that the counts are unreliable', () => {
      expect(render(crashedRunReport, ['--outcomes', 'failure'])).toContain(
        'exited non-zero but reported no failing tests',
      );
    });

    it('names the affected environment and suite on the warning line itself', () => {
      const doc = render(crashedRunReport, ['--outcomes', 'failure']);
      // Assert against the warning line specifically -- "preview/smoke" also
      // appears in the Skipped Tests list, which would pass a whole-document
      // match without the warning existing at all.
      const warning = doc.split('\n').find((l) => l.includes('exited non-zero but reported no failing tests'));
      expect(warning).toBeDefined();
      expect(warning).toContain('preview/smoke');
    });

    it('trusts the report when the step outcome says the run succeeded', () => {
      const doc = render(crashedRunReport, ['--outcomes', 'success']);
      expect(doc).toContain('✅ **SUCCESS**');
      expect(doc).not.toContain('exited non-zero');
    });

    it('falls back to the report when no outcome is supplied', () => {
      expect(render(crashedRunReport)).toContain('✅ **SUCCESS**');
    });

    it('does not misreport a genuinely failing run as unreliable', () => {
      const doc = render(failingTestReport, ['--outcomes', 'failure']);
      expect(doc).toContain('❌ **FAILURE**');
      expect(doc).not.toContain('exited non-zero but reported no failing tests');
    });
  });
});
