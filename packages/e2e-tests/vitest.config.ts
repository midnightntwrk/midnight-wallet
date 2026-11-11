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
import { configDefaults, defineConfig } from 'vitest/config';

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
      ['html', { outputFile: './reports/html/index.html' }],
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
      {
        extends: true,
        test: {
          name: 'remote',
          include: ['**/**/tests/*.remote.test.ts', '**/**/tests/*.universal.test.ts'],
          exclude: ['**/fundTestWallets.remote.test.ts'],
        },
      },
      // The funding script spends the funding wallet, so its project exists only when `yarn test-fund` asks for it: a bare
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
