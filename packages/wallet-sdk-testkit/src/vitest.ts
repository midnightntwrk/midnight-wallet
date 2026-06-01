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
import { afterAll, beforeAll, beforeEach, onTestFailed } from 'vitest';
import { type WalletTestEnvironment } from './types.js';
import { logger } from './logger.js';

/**
 * Registers `beforeAll`/`afterAll` hooks that build a {@link WalletTestEnvironment} from `factory`
 * and tear it down after the suite. Returns an accessor for use inside tests.
 *
 * Replaces the old `useTestContainersFixture()`, but the environment is now whatever the factory
 * returns — e.g. `createRemoteEnvironment({ network: 'devnet', proverUrl })` (no Docker) or
 * `createTestContainersEnvironment({ network: 'undeployed' })` (from the `/testcontainers` entry).
 */
export const useWalletTestEnvironment = (
  factory: () => Promise<WalletTestEnvironment> | WalletTestEnvironment,
): (() => WalletTestEnvironment) => {
  let environment: WalletTestEnvironment | undefined;

  beforeAll(async () => {
    environment = await factory();
    logger.info(`Wallet test environment ready (network=${environment.network})`);
  }, 120_000);

  afterAll(async () => {
    logger.info('Tearing down wallet test environment...');
    await environment?.down();
    logger.info('Wallet test environment torn down');
  }, 60_000);

  return () => {
    if (!environment) {
      throw new Error('Wallet test environment accessed before beforeAll completed');
    }
    return environment;
  };
};

/**
 * Installs a `beforeEach` hook that logs detailed failure information on each failed attempt of a
 * retried test. Mirrors the old `setup-retry-logging.ts` setup file; call once per suite (or wire
 * it into a vitest `setupFiles` entry).
 */
export const installRetryLogging = (): void => {
  beforeEach(() => {
    onTestFailed(({ task: failedTask }) => {
      const attempt = (failedTask.result?.retryCount ?? 0) + 1;
      const retry = failedTask.retry;
      const maxRetries = typeof retry === 'number' ? retry : (retry?.count ?? 0);

      if (maxRetries > 0) {
        logger.error(`Test "${failedTask.name}" failed on attempt ${attempt}/${maxRetries + 1}:`);
        for (const error of failedTask.result?.errors ?? []) {
          logger.error(error.message);
          if (error.stack) {
            logger.error(error.stack);
          }
        }
      }
    });
  });
};
