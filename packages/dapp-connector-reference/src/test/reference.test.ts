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
import {
  prepareMockFacade,
  prepareMockUnshieldedKeystore,
  testShieldedWithKeys,
  testShieldedWithKeys2,
  testUnshieldedWithKeys,
  testUnshieldedWithKeys2,
  buildMockSealedTransaction,
  serializeTransaction,
} from './testUtils.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { DappConnectorTestContext, CreateConnectedAPIOptions, ConnectedAPIInstance, TestEnvironment } from './context.js';

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

// Default configuration for reference implementation tests
const defaultConfig: ConnectorConfiguration = {
  networkId: 'testnet',
  indexerUri: 'http://localhost:8080',
  indexerWsUri: 'ws://localhost:8080',
  substrateNodeUri: 'ws://localhost:9944',
};

// Standard token types for testing (64-char hex strings representing 256-bit hashes)
const standardTokenType = '0000000000000000000000000000000000000000000000000000000000000000';
const alternateTokenType = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Create test environment for the reference implementation.
 * Provides Bech32m-encoded addresses and token types for transaction tests.
 */
const createTestEnvironment = (): TestEnvironment => ({
  networkId: 'testnet',

  addresses: {
    shielded: MidnightBech32m.encode('testnet', testShieldedWithKeys.address).asString(),
    shielded2: MidnightBech32m.encode('testnet', testShieldedWithKeys2.address).asString(),
    unshielded: MidnightBech32m.encode('testnet', testUnshieldedWithKeys.address).asString(),
    unshielded2: MidnightBech32m.encode('testnet', testUnshieldedWithKeys2.address).asString(),
  },

  addressKeys: {
    shielded: testShieldedWithKeys,
    shielded2: testShieldedWithKeys2,
    unshielded: testUnshieldedWithKeys,
    unshielded2: testUnshieldedWithKeys2,
  },

  tokenTypes: {
    standard: standardTokenType,
    alternate: alternateTokenType,
  },

  buildSealedTransaction: (options) => buildMockSealedTransaction(options),
  serializeTransaction: (tx) => serializeTransaction(tx),
});

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
  const environment = createTestEnvironment();

  const context: DappConnectorTestContext = {
    implementationName: 'reference',
    environment,
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

describe('transfer', () => {
  runTransferTests(createReferenceContext());
});

describe('intent', () => {
  runIntentTests(createReferenceContext());
});

describe('balancing', () => {
  runBalancingTests(createReferenceContext());
});
