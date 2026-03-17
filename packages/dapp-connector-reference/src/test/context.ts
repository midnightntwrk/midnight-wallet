/**
 * Test context interface for DApp Connector implementations.
 *
 * This allows the same test suites to run against different implementations
 * (e.g., reference implementation with mocks, browser extension with real wallet).
 */

import type { WalletConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import type { Connector } from '../index.js';
import type { MockBalancesConfig, MockHistoryEntry } from './testUtils.js';

/**
 * Options for creating a connected API instance.
 */
export interface CreateConnectedAPIOptions {
  /** Network ID to connect with. Defaults to implementation's default (usually 'testnet'). */
  readonly networkId?: string;
}

/**
 * Result from creating a connected API instance.
 * Includes the API and a disconnect function (which is not part of WalletConnectedAPI).
 */
export interface ConnectedAPIInstance {
  /** The connected API conforming to the DApp Connector spec */
  readonly api: WalletConnectedAPI;
  /** Disconnect from the wallet (test utility, not part of WalletConnectedAPI) */
  readonly disconnect: () => Promise<void>;
  /** The network ID this API is connected to */
  readonly networkId: string;
}

/**
 * Test context that implementations must provide.
 *
 * Each implementation (reference, browser extension, etc.) creates its own
 * context with appropriate factories and configuration methods.
 */
export interface DappConnectorTestContext {
  /** Name for test output (e.g., "reference", "browser-extension") */
  readonly implementationName: string;

  /**
   * Factory to create a Connector instance.
   * Used by installation tests that need to test connector.install().
   *
   * For implementations that don't expose a Connector directly (e.g., browser extensions),
   * this can throw an error and those tests should be skipped.
   */
  readonly createConnector: () => Connector;

  /**
   * Factory to create a connected API instance with disconnect capability.
   *
   * Returns a fresh instance each time - tests should not share instances.
   * The disconnect function is separate from the API since WalletConnectedAPI
   * does not include disconnect (it's a wallet-side operation).
   *
   * @param options - Optional configuration for the connection
   */
  readonly createConnectedAPI: (options?: CreateConnectedAPIOptions) => Promise<ConnectedAPIInstance>;

  /**
   * Install target for injection tests.
   * Connector.install() will inject into location.midnight[uuid].
   *
   * For reference implementation tests, this is typically an empty object.
   * For browser tests, this would be globalThis.
   */
  readonly installTarget: { midnight?: Record<string, InitialAPI> };

  /**
   * Configure mock balances for transfer/intent tests.
   * Only available for implementations that support mocking.
   *
   * @returns A new context factory with the configured balances.
   */
  readonly withBalances?: (config: MockBalancesConfig) => DappConnectorTestContext;

  /**
   * Configure transaction history for history tests.
   * Only available for implementations that support mocking.
   *
   * @returns A new context factory with the configured history.
   */
  readonly withTransactionHistory?: (entries: MockHistoryEntry[]) => DappConnectorTestContext;

  /**
   * Configure submission error for submission tests.
   * Only available for implementations that support mocking.
   *
   * @returns A new context factory with the configured error.
   */
  readonly withSubmissionError?: (error: Error) => DappConnectorTestContext;
}

/**
 * Helper type for test suites that only need connected API access.
 * Most tests only need createConnectedAPI and implementationName.
 */
export type ConnectedAPITestContext = Pick<DappConnectorTestContext, 'implementationName' | 'createConnectedAPI'>;

/**
 * Helper type for installation tests that need Connector access.
 */
export type InstallationTestContext = Pick<
  DappConnectorTestContext,
  'implementationName' | 'createConnector' | 'installTarget'
>;
