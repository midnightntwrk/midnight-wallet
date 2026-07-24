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

// Generates a human-readable QA test-evidence README from one or more Vitest
// JSON reports.
//
// Each release run produces one Vitest JSON per (environment, suite). This
// script merges them into a single evidence document: a metadata table
// (versions + QA sign-off placeholder), a Test Execution Summary table
// (Environment | Suite | Passed | Failed | Skipped | Total), a per-file results
// table, per-test detail, a skipped-tests list, and a reproduction guide.
//
// Usage:
//   node generate-evidence.mjs <env>:<suite>:<jsonPath> [more runs...] \
//     --version 1.2.0 [--out <dir>] [--qa-contact "Name <email>"] \
//     [--networks "undeployed, preview"] [--node-version 1.0.0] \
//     [--ledger-version 8.1.0]
//
// Example:
//   node packages/e2e-tests/scripts/generate-evidence.mjs \
//     undeployed:e2e:packages/e2e-tests/reports/undeployed.json \
//     remote:smoke:packages/e2e-tests/reports/remote-smoke.json \
//     --version 1.2.0 --networks "undeployed, preview"

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// --- argument parsing -------------------------------------------------------

const parseArgs = (argv) =>
  argv.reduce(
    (acc, token, i, all) => {
      if (token.startsWith('--')) {
        const key = token.slice(2);
        const value = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true';
        return { ...acc, flags: { ...acc.flags, [key]: value } };
      }
      // A value already consumed by the preceding flag is skipped here.
      const isFlagValue = i > 0 && all[i - 1].startsWith('--');
      return isFlagValue ? acc : { ...acc, runs: [...acc.runs, token] };
    },
    { runs: [], flags: {} },
  );

const { runs: runSpecs, flags } = parseArgs(process.argv.slice(2));

if (runSpecs.length === 0 || !flags.version) {
  console.error(
    'Usage: generate-evidence.mjs <env>:<suite>:<jsonPath> [...] --version <v> [--out <dir>] ' +
      '[--qa-contact "..."] [--networks "..."] [--node-version <v>] [--ledger-version <v>]',
  );
  process.exit(1);
}

// --- vitest JSON parsing (pure) --------------------------------------------

const STATUS_EMOJI = {
  passed: '✅',
  failed: '❌',
  pending: '⏭️',
  skipped: '⏭️',
  todo: '📝',
};

const fmtDuration = (ms) => {
  if (ms === undefined || Number.isNaN(ms)) return 'n/a';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${mins}m ${rem}s`;
};

// Parse one `<env>:<suite>:<path>` spec into a structured run summary.
const parseRun = (spec) => {
  const firstColon = spec.indexOf(':');
  const secondColon = spec.indexOf(':', firstColon + 1);
  if (firstColon < 0 || secondColon < 0) {
    throw new Error(`Invalid run spec "${spec}" — expected <env>:<suite>:<jsonPath>`);
  }
  const env = spec.slice(0, firstColon);
  const suite = spec.slice(firstColon + 1, secondColon);
  const jsonPath = spec.slice(secondColon + 1);

  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));

  const files = (report.testResults ?? []).map((file) => {
    const tests = (file.assertionResults ?? []).map((a) => ({
      title: a.title ?? a.fullName ?? '(unnamed)',
      status: a.status,
      duration: a.duration,
    }));
    const count = (status) => tests.filter((t) => t.status === status).length;
    return {
      name: basename(file.name),
      durationMs: file.endTime && file.startTime ? file.endTime - file.startTime : undefined,
      total: tests.length,
      passed: count('passed'),
      failed: count('failed'),
      skipped: count('pending') + count('skipped'),
      todo: count('todo'),
      tests,
    };
  });

  return {
    env,
    suite,
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: report.numPendingTests ?? 0,
    todo: report.numTodoTests ?? 0,
    success: report.success ?? report.numFailedTests === 0,
    files,
  };
};

const parsedRuns = runSpecs.map(parseRun);

const totals = parsedRuns.reduce(
  (acc, r) => ({
    total: acc.total + r.total,
    passed: acc.passed + r.passed,
    failed: acc.failed + r.failed,
    skipped: acc.skipped + r.skipped,
    todo: acc.todo + r.todo,
  }),
  { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
);

const overallSuccess = parsedRuns.every((r) => r.success);

// --- metadata resolution ----------------------------------------------------

const resolveLedgerVersion = () => {
  if (flags['ledger-version']) return flags['ledger-version'];
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages', 'e2e-tests', 'package.json'), 'utf8'));
    const dep = pkg.devDependencies?.['@midnight-ntwrk/ledger-v8'] ?? pkg.dependencies?.['@midnight-ntwrk/ledger-v8'];
    return dep ? dep.replace(/^[\^~]/, '') : 'n/a';
  } catch {
    return 'n/a';
  }
};

const meta = {
  date: flags.date ?? new Date().toISOString().slice(0, 10),
  qaContact: flags['qa-contact'] ?? '_to be filled in by QA_',
  version: flags.version,
  ledgerVersion: resolveLedgerVersion(),
  nodeVersion: flags['node-version'] ?? 'n/a',
  networks: flags.networks ?? parsedRuns.map((r) => r.env).join(', '),
};

// --- markdown rendering (pure) ----------------------------------------------

const suiteLabel = (r) => (r.suite === 'e2e' ? 'e2e (all)' : r.suite);

const metadataTable = [
  '| Field | Value |',
  '| --- | --- |',
  `| Date | ${meta.date} |`,
  `| QA Contact | ${meta.qaContact} |`,
  `| Wallet SDK version | \`${meta.version}\` |`,
  `| Ledger version | \`${meta.ledgerVersion}\` |`,
  `| Node version | \`${meta.nodeVersion}\` |`,
  `| Networks | ${meta.networks} |`,
  `| QA Sign-off | ⏳ pending |`,
].join('\n');

const summaryTable = [
  '| Environment | Suite | Passed | Failed | Skipped | Total |',
  '| --- | --- | --- | --- | --- | --- |',
  ...parsedRuns.map((r) => `| ${r.env} | ${suiteLabel(r)} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.total} |`),
  `| **Total** | | **${totals.passed}** | **${totals.failed}** | **${totals.skipped}** | **${totals.total}** |`,
].join('\n');

const resultsByFileTable = [
  '| Environment | Suite | Test file | Passed | Failed | Skipped | Duration |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...parsedRuns.flatMap((r) =>
    r.files.map(
      (f) =>
        `| ${r.env} | ${suiteLabel(r)} | \`${f.name}\` | ${f.passed} | ${f.failed} | ${f.skipped} | ~${fmtDuration(f.durationMs)} |`,
    ),
  ),
].join('\n');

const detailSection = parsedRuns
  .map((r) => {
    const heading = `### ${r.env} — ${suiteLabel(r)}`;
    const fileBlocks = r.files
      .map((f) => {
        const testLines = f.tests
          .map((t) => {
            const emoji = STATUS_EMOJI[t.status] ?? '•';
            const suffix =
              t.status === 'passed' || t.status === 'failed' ? ` (${fmtDuration(t.duration)})` : ` — **${t.status}**`;
            return `- ${emoji} ${t.title}${suffix}`;
          })
          .join('\n');
        return `#### \`${f.name}\`\n${testLines}`;
      })
      .join('\n\n');
    return `${heading}\n\n${fileBlocks}`;
  })
  .join('\n\n');

const skipped = parsedRuns.flatMap((r) =>
  r.files.flatMap((f) =>
    f.tests
      .filter((t) => t.status === 'pending' || t.status === 'skipped')
      .map((t) => `- \`${t.title}\` (${r.env}/${suiteLabel(r)} — \`${f.name}\`)`),
  ),
);

const skippedSection =
  skipped.length > 0
    ? `## Skipped Tests (${skipped.length})\n\n${skipped.join('\n')}\n\n> Skipped entries are the suites' own conditional cases, not errors.`
    : '';

const executionGuide = `## Test Execution Guide

All commands run from the repository root.

\`\`\`shell
# Build the workspace first
yarn install && yarn turbo dist

# All undeployed tests (local docker network, prefunded wallets)
yarn turbo test-undeployed

# Smoke subset on a remote/deployed environment
NETWORK=<network> yarn turbo test-remote -- -t @smoke
\`\`\`

Remote suites require funded wallet seeds (\`E2E_TESTS_SEED\`, \`E2E_TESTS_SEED2\`,
\`E2E_TESTS_NT_SEED\`, \`E2E_TESTS_NT_SEED2\`) and a reachable \`NETWORK\`. See
\`packages/e2e-tests/README.md\` for suite descriptions and environment setup.

Regenerate this document from the raw Vitest JSON reports with
\`packages/e2e-tests/scripts/generate-evidence.mjs\`.`;

const document = `# Wallet SDK — QA Test Evidence (\`wallet-sdk@${meta.version}\`)

**Result:** ${overallSuccess ? '✅ **SUCCESS**' : '❌ **FAILURE**'}

## Release Metadata

${metadataTable}

## Test Execution Summary

${summaryTable}

> ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped across ${totals.total} total tests.

## Results by File

${resultsByFileTable}

## Detail

${detailSection}

${skippedSection ? `${skippedSection}\n\n` : ''}${executionGuide}
`;

// --- output (impure edge) ---------------------------------------------------

const outDir = flags.out ?? join(repoRoot, 'qa', 'evidence', `wallet-sdk-${meta.version}`);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'README.md');
writeFileSync(outPath, document);

console.log(`Wrote evidence: ${outPath}`);
console.log(
  `Summary: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped / ${totals.total} total ` +
    `(${overallSuccess ? 'SUCCESS' : 'FAILURE'})`,
);
