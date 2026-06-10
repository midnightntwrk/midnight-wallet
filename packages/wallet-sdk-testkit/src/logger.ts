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
import pinoPretty from 'pino-pretty';
import pino, { type Logger } from 'pino';

// Unlike the original e2e-tests logger, a published package must not write log files to a
// path relative to its own source. The default here is a plain pretty stdout logger; consumers
// that want file output (or structured JSON, or their own pino instance) call `setLogger`.
const createDefaultLogger = (): Logger => {
  const pretty: pinoPretty.PrettyStream = pinoPretty({ colorize: true, sync: true });
  return pino({ level: process.env['WALLET_TESTKIT_LOG_LEVEL'] ?? 'info', depthLimit: 20 }, pretty);
};

let current: Logger = createDefaultLogger();

/** Replace the logger used by all testkit helpers. Pass any pino-compatible logger. */
export const setLogger = (next: Logger): void => {
  current = next;
};

/** Returns the currently-active logger instance. */
export const getLogger = (): Logger => current;

// A stable proxy so existing call sites (`logger.info(...)`) keep working *and* pick up
// whatever `setLogger` installed, without every helper having to call `getLogger()`.
export const logger: Logger = new Proxy({} as Logger, {
  get(_target, property) {
    const value = current[property as keyof Logger];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(current) : value;
  },
});
