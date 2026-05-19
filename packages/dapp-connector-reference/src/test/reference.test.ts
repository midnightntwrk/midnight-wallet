/**
 * Reference implementation test runner.
 *
 * Runs all test suites against the reference DApp Connector implementation
 * backed by a real WalletFacade using the Simulator.
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
