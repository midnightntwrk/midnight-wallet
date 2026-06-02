/**
 * Test context interface for DApp Connector implementations.
 *
 * This allows the same test suites to run against different implementations (e.g., reference implementation with mocks,
 * browser extension with real wallet).
 */

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { Connector } from '../index.js';
import type { ShieldedAddressWithKeys, UnshieldedAddressWithKeys } from './testUtils.js';

/** Options for creating a connected API instance. */
export interface CreateConnectedAPIOptions {
  /** Network ID to connect with. Defaults to implementation's default (usually 'testnet'). */
  readonly networkId?: string;
}

/**
 * Test environment providing addresses, token types, and helpers. Used by transaction tests (transfer, intent,
 * balancing).
 */
export interface TestEnvironment {
  /** Network ID for address encoding (e.g., 'testnet') */
  readonly networkId: string;

  /** Pre-encoded test addresses for the network (Bech32m format) */
  readonly addresses: {
    readonly shielded: string;
    readonly shielded2: string;
    readonly unshielded: string;
    readonly unshielded2: string;
  };

  /**
   * Address keys for verification (optional). Only available for implementations that can provide secret keys for
   * testing. Enables decryption-based verification of shielded outputs.
   */
  readonly addressKeys?: {
    readonly shielded: ShieldedAddressWithKeys;
    readonly shielded2: ShieldedAddressWithKeys;
    readonly unshielded: UnshieldedAddressWithKeys;
    readonly unshielded2: UnshieldedAddressWithKeys;
  };

  /** Token types valid in this test environment (64-char hex strings). */
  readonly tokenTypes: {
    /** A canonical shielded token type the environment supports. */
    readonly standard: string;
    /** A second shielded token type distinct from `standard`, for multi-token tests. */
    readonly alternate: string;
    /** The Night token type (native unshielded), used for funding Night and (via generation) Dust. */
    readonly night: string;
  };

  /**
   * Build a mock sealed transaction for balancing tests (optional). Only available for implementations that can build
   * mock transactions.
   */
  readonly buildSealedTransaction?: (options: { networkId: string }) => ledger.FinalizedTransaction;

  /**
   * Serialize a transaction to hex string (optional). Only available for implementations that support transaction
   * serialization.
   */
  readonly serializeTransaction?: (tx: ledger.FinalizedTransaction) => string;
}

/**
 * Result from creating a connected API instance. Includes the API and a disconnect function (which is not part of
 * WalletConnectedAPI).
 */
export interface ConnectedAPIInstance {
  /** The connected API conforming to the DApp Connector spec */
  readonly api: ConnectedAPI;
  /** Disconnect from the wallet (test utility, not part of WalletConnectedAPI) */
  readonly disconnect: () => Promise<void>;
  /** The network ID this API is connected to */
  readonly networkId: string;
}

/**
 * Per-wallet initialization spec used by `setupWallets`. Amounts are in "tokens" (whole units); the simulator backend
 * applies its 6-decimal multiplier internally.
 *
 * A scalar `bigint` mints a single genesis UTXO of that size. An array of bigints mints one UTXO per entry, which is
 * what tests want when they need to perform multiple consecutive transfers against the same wallet without each one
 * locking the only available UTXO as pending (coin selection picks a fresh UTXO each time).
 *
 * Dust cannot be funded directly — it generates from Night UTXOs over time. To get a wallet with Dust, fund it with
 * Night via `unshielded`; the simulator backend registers Night UTXOs for Dust generation and advances time so Dust
 * accumulates before `setupWallets` resolves.
 */
export interface WalletInitSpec {
  /** Shielded token genesis amounts, keyed by token type (64-char hex). Scalar = 1 UTXO; array = N UTXOs. */
  readonly shielded?: Readonly<Record<string, bigint | readonly bigint[]>>;
  /** Unshielded token genesis amounts, keyed by token type. Use the native token type for Night. */
  readonly unshielded?: Readonly<Record<string, bigint | readonly bigint[]>>;
}

/** One wallet inside a `MultiWalletSetup`. */
export interface WalletInstance {
  /** Connected API for this wallet. */
  readonly api: ConnectedAPI;
  /** Disconnect this wallet. */
  readonly disconnect: () => Promise<void>;
  /** Pre-encoded Bech32m addresses for this wallet. */
  readonly addresses: {
    readonly shielded: string;
    readonly unshielded: string;
    readonly dust: string;
  };
}

/**
 * Setup containing multiple named wallets, each with its own connected API and pre-funded balances.
 *
 * Created by `context.setupWallets({...})`. Tests that need controllable funding (or recipient verification) should
 * gate on `context.setupWallets !== undefined` and use this; implementations without simulator-like state injection
 * will skip those tests.
 */
export interface MultiWalletSetup<K extends string> {
  /** Map of wallet name → instance, keyed by the names from the spec passed to `setupWallets`. */
  readonly wallets: Readonly<Record<K, WalletInstance>>;
  /** Disconnect all wallets and tear down the setup. */
  readonly disconnect: () => Promise<void>;
  /** Token types valid in this setup (the same the surrounding context exposes via `environment.tokenTypes`). */
  readonly tokenTypes: {
    readonly shielded: string;
    readonly alternate: string;
    readonly night: string;
  };
}

/**
 * Test context that implementations must provide.
 *
 * Each implementation (reference, browser extension, etc.) creates its own context with appropriate factories and
 * configuration methods.
 */
export interface DappConnectorTestContext {
  /** Name for test output (e.g., "reference", "browser-extension") */
  readonly implementationName: string;

  /**
   * Test environment with addresses, token types, and helpers. Required for transaction tests (transfer, intent,
   * balancing).
   */
  readonly environment: TestEnvironment;

  /**
   * Factory to create a Connector instance. Used by installation tests that need to test connector.install().
   *
   * For implementations that don't expose a Connector directly (e.g., browser extensions), this can throw an error and
   * those tests should be skipped.
   */
  readonly createConnector: () => Connector;

  /**
   * Factory to create a connected API instance with disconnect capability.
   *
   * Returns a fresh instance each time - tests should not share instances. The disconnect function is separate from the
   * API since WalletConnectedAPI does not include disconnect (it's a wallet-side operation).
   *
   * @param options - Optional configuration for the connection
   */
  readonly createConnectedAPI: (options?: CreateConnectedAPIOptions) => Promise<ConnectedAPIInstance>;

  /**
   * Install target for injection tests. Connector.install() will inject into location.midnight[uuid].
   *
   * For reference implementation tests, this is typically an empty object. For browser tests, this would be globalThis.
   */
  readonly installTarget: { midnight?: Record<string, InitialAPI> };

  /**
   * Create multiple named wallets with controllable genesis balances.
   *
   * Optional — only implementations that can pre-fund wallets (e.g., the simulator) provide this. Tests that need
   * controllable balances or multi-wallet scenarios (transfer recipient verification, insufficient-funds errors, swap
   * intents) should gate on `setupWallets !== undefined` and skip otherwise.
   *
   * The returned wallets share a single underlying ledger, so transfers between them work and addresses are reachable
   * from any wallet's API.
   *
   * @param spec - Map of wallet name → initialization spec
   * @returns A `MultiWalletSetup` whose `disconnect()` tears down all wallets and any underlying simulator
   */
  readonly setupWallets?: <K extends string>(spec: Readonly<Record<K, WalletInitSpec>>) => Promise<MultiWalletSetup<K>>;
}

/**
 * Helper type for test suites that only need connected API access. Most tests only need createConnectedAPI and
 * implementationName.
 */
export type ConnectedAPITestContext = Pick<DappConnectorTestContext, 'implementationName' | 'createConnectedAPI'>;

/** Helper type for installation tests that need Connector access. */
export type InstallationTestContext = Pick<
  DappConnectorTestContext,
  'implementationName' | 'createConnector' | 'installTarget'
>;

/** Helper type for transaction tests (transfer, intent) that need environment access. */
export type TransactionTestContext = Pick<
  DappConnectorTestContext,
  'implementationName' | 'createConnectedAPI' | 'environment'
>;

/** Helper type for balancing tests that need environment access. */
export type BalancingTestContext = Pick<
  DappConnectorTestContext,
  'implementationName' | 'createConnectedAPI' | 'environment'
>;

/** Helper type for tests that need controllable multi-wallet setup. Tests skip when `setupWallets` is undefined. */
export type MultiWalletTestContext = Pick<
  DappConnectorTestContext,
  'implementationName' | 'environment' | 'setupWallets'
>;
