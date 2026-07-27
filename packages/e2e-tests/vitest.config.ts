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
      {
        // Pure unit tests for the package's own tooling scripts (no docker, no
        // network). Overrides the e2e defaults: no env setup, no retry, short
        // timeouts.
        //
        // Note: `reporters` is a root-level-only option, so a unit run still
        // rewrites reports/test-report.json. That is harmless here — the QA
        // evidence workflow only ever runs test-undeployed / test-remote, and
        // copies the report to a per-suite filename immediately after each run.
        extends: true,
        test: {
          name: 'unit',
          include: ['scripts/**/*.test.ts'],
          setupFiles: [],
          retry: 0,
          testTimeout: 30_000,
          hookTimeout: 30_000,
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
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
});
