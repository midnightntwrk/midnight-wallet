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
/**
 * Reference implementation test runner.
 *
 * Runs all test suites against the reference DApp Connector implementation backed by a real WalletFacade using the
 * Simulator.
 */

import { afterAll, beforeAll, describe, vi } from 'vitest';
import { initSimulatorEnv, createSimulatorContext, type SimulatorEnv } from './simulatorTestUtils.js';

// Import test suites
import {
  runInstallationTests,
  runConnectionTests,
  runConfigurationTests,
  runAddressTests,
  runBalanceTests,
  runSigningTests,
  runHintUsageTests,
  runSubmissionTests,
  runProvingTests,
  runHistoryTests,
  runDisconnectionTests,
  runValidationTests,
  runTransferTests,
  runIntentTests,
  runBalancingTests,
} from './suites/index.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// =============================================================================
// Simulator Environment (shared across all suites)
// =============================================================================

let env: SimulatorEnv;

beforeAll(async () => {
  env = await initSimulatorEnv();
}, 60_000);

afterAll(async () => {
  await env?.cleanup();
});

describe('installation', () => {
  runInstallationTests(createSimulatorContext(() => env));
});

describe('connection', () => {
  runConnectionTests(createSimulatorContext(() => env));
});

describe('configuration', () => {
  runConfigurationTests(createSimulatorContext(() => env));
});

describe('addresses', () => {
  runAddressTests(createSimulatorContext(() => env));
});

describe('signing', () => {
  runSigningTests(createSimulatorContext(() => env));
});

describe('hintUsage', () => {
  runHintUsageTests(createSimulatorContext(() => env));
});

describe('disconnection', () => {
  runDisconnectionTests(createSimulatorContext(() => env));
});

describe('proving', () => {
  runProvingTests(createSimulatorContext(() => env));
});

describe('validation', () => {
  runValidationTests(createSimulatorContext(() => env));
});

describe('balances', () => {
  runBalanceTests(createSimulatorContext(() => env));
});

describe('submission', () => {
  runSubmissionTests(createSimulatorContext(() => env));
});

describe('history', () => {
  runHistoryTests(createSimulatorContext(() => env));
});

describe('transfer', () => {
  runTransferTests(createSimulatorContext(() => env));
});

describe('intent', () => {
  runIntentTests(createSimulatorContext(() => env));
});

describe('balancing', () => {
  runBalancingTests(createSimulatorContext(() => env));
});
