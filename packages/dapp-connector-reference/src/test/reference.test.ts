/**
 * Reference implementation test runner.
 *
 * Runs all test suites against the reference DApp Connector implementation
 * using mock facade and keystore.
 */

import { describe } from 'vitest';
import { Connector } from '../index.js';
import type { ConnectorConfiguration } from '../types.js';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';
import type { DappConnectorTestContext, CreateConnectedAPIOptions, ConnectedAPIInstance } from './context.js';

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
} from './suites/index.js';

// Default configuration for reference implementation tests
const defaultConfig: ConnectorConfiguration = {
  networkId: 'testnet',
  indexerUri: 'http://localhost:8080',
  indexerWsUri: 'ws://localhost:8080',
  substrateNodeUri: 'ws://localhost:9944',
};

/**
 * Create a reference implementation test context.
 *
 * Each call creates fresh mocks, so tests are isolated.
 * The withBalances/withTransactionHistory/withSubmissionError methods
 * configure the mocks and return the same context, allowing chaining
 * before calling createConnectedAPI.
 */
const createReferenceContext = (): DappConnectorTestContext => {
  // Create fresh mocks for this context
  const facade = prepareMockFacade();
  const keystore = prepareMockUnshieldedKeystore();

  const context: DappConnectorTestContext = {
    implementationName: 'reference',
    installTarget: {},

    createConnector: () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      return new Connector(metadata, facade, keystore, defaultConfig);
    },

    createConnectedAPI: async (options?: CreateConnectedAPIOptions): Promise<ConnectedAPIInstance> => {
      const networkId = options?.networkId ?? defaultConfig.networkId;
      const config: ConnectorConfiguration = { ...defaultConfig, networkId };
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, facade, keystore, config);
      const api = await connector.connect(networkId);

      return {
        api,
        disconnect: () => api.disconnect(),
        networkId,
      };
    },

    // Configure methods return the same context (same mocks) for chaining
    withBalances: (balancesConfig) => {
      facade.withBalances(balancesConfig);
      return context;
    },

    withTransactionHistory: (entries) => {
      facade.withTransactionHistory(entries);
      return context;
    },

    withSubmissionError: (error) => {
      facade.withSubmissionError(error);
      return context;
    },
  };

  return context;
};

// =============================================================================
// Run all test suites
// =============================================================================

describe('installation', () => {
  runInstallationTests(createReferenceContext());
});

describe('connection', () => {
  runConnectionTests(createReferenceContext());
});

describe('configuration', () => {
  runConfigurationTests(createReferenceContext());
});

describe('addresses', () => {
  runAddressTests(createReferenceContext());
});

describe('balances', () => {
  runBalanceTests(createReferenceContext());
});

describe('signing', () => {
  runSigningTests(createReferenceContext());
});

describe('hintUsage', () => {
  runHintUsageTests(createReferenceContext());
});

describe('submission', () => {
  runSubmissionTests(createReferenceContext());
});

describe('proving', () => {
  runProvingTests(createReferenceContext());
});

describe('history', () => {
  runHistoryTests(createReferenceContext());
});

describe('disconnection', () => {
  runDisconnectionTests(createReferenceContext());
});

describe('validation', () => {
  runValidationTests(createReferenceContext());
});
