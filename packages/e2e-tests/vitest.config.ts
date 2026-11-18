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
/// <reference types="vitest" />
import { configDefaults, defineConfig, type TestUserConfig } from 'vitest/config';

// The html reporter cannot serialize a bigint, and Vitest keeps a retried test's first-attempt error: when that error
// carries a bigint field (as InsufficientDustForFeeError does), the reporter throws and the run exits 1 although every
// test passed. A local run still writes the report, and can go red this way. CI leaves it out, because CI retries and no
// CI step reads it — except the fork lane, which never retries and uploads the whole reports/ directory for
// post-mortems, so its `test-fork` script asks for it with E2E_HTML_REPORT.
const htmlReporters: Extract<NonNullable<TestUserConfig['reporters']>, unknown[]> = process.env['CI'] === 'true' &&
process.env['E2E_HTML_REPORT'] !== 'true'
  ? []
  : [['html', { outputFile: './reports/html/index.html' }]];

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
    setupFiles: ['../../setup-env.ts', './src/tests/setup-retry-logging.ts'],
    environment: 'node',
    hookTimeout: 3_600_000,
    testTimeout: 3_600_000,
    retry: 1,
    globals: true,
    reporters: [
      'default',
      ['junit', { outputFile: './reports/test-report.xml' }],
      ['json', { outputFile: './reports/test-report.json' }],
      ...htmlReporters,
    ],
    projects: [
      // Pure helpers, such as the funding script's plan: no Docker and no network. Run it with
      // `yarn workspace @midnight/wallet-e2e-tests test-e2e --project unit`.
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/**/tests/helpers/*.test.ts'],
          exclude: ['**/*.integration.test.ts'],
          retry: 0,
        },
      },
      {
        extends: true,
        test: {
          name: 'undeployed',
          include: ['**/**/tests/*.undeployed.test.ts', '**/**/tests/*.universal.test.ts'],
        },
      },
      // The dust healthchecks and the token-transfer healthchecks run the same seed in separate wallet instances. Run at
      // once, both pick the same Dust coin to pay a fee, and the node rejects whichever transaction arrives second as a
      // Dust double spend. The dust file therefore runs in a group of its own, finishing before the rest of the remote
      // lane starts; it goes first because it is short, while the rest includes a sync of the stable wallet from genesis.
      // `test-remote` selects both projects.
      {
        extends: true,
        test: {
          name: 'remote-dust',
          include: ['**/**/tests/dust.remote.test.ts'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'remote',
          include: ['**/**/tests/*.remote.test.ts', '**/**/tests/*.universal.test.ts'],
          exclude: ['**/fundTestWallets.remote.test.ts', '**/dust.remote.test.ts'],
          sequence: { groupOrder: 1 },
        },
      },
      // The funding script spends the funding wallet, so its project exists only when `yarn turbo test-fund` asks for it: a bare
      // `vitest run` runs every project, and must not select it.
      ...(process.env['FUND_TEST_WALLETS'] === 'true'
        ? [
            {
              extends: true,
              test: {
                name: 'fund',
                include: ['**/**/tests/fundTestWallets.remote.test.ts'],
                retry: 0,
              },
            },
          ]
        : []),
      {
        extends: true,
        test: {
          name: 'fork',
          include: ['**/**/tests/*.fork.test.ts'],
          // No retry: a retried fork test would re-run against an already-forked chain and
          // fail for a reason that has nothing to do with what it is checking.
          retry: 0,
        },
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
});
