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
import { beforeEach, onTestFailed } from 'vitest';
import { logger } from './logger.js';

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
