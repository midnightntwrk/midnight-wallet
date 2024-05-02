import { Wallet, WalletState } from '@midnight-ntwrk/wallet-api';
import { CoinInfo, Transaction } from '@midnight-ntwrk/zswap';

/**
 * The shape of the wallet state that must be exposed
 */
export interface DAppConnectorWalletState {
  /** The wallet address, which is a concatenation of coinPublicKey and encryptionPublicKey */
  address: WalletState['address'];
  /** The coin public key */
  coinPublicKey: WalletState['coinPublicKey'];
  /** The encryption public key */
  encryptionPublicKey: WalletState['encryptionPublicKey'];
}

/**
 * The services configuration
 */
export interface ServiceUriConfig {
  /**  Pub-sub indexer URI */
  indexerUri: string;
  /**  Pub-sub indexer WebSocket URI */
  indexerWsUri: string;
  /**  Prover Server URI */
  proverServerUri: string;
  /**  Substrate URI */
  substrateNodeUri: string;
}
/**
 * Shape of the Wallet API in the DApp Connector
 */
export interface DAppConnectorWalletAPI {
  /** Returns a promise with the exposed wallet state */
  state: () => Promise<DAppConnectorWalletState>;
  /**
   * It will try to balance given transaction and prove it
   * @param tx Transaction to balance
   * @param newCoins New coins created by transaction, for which wallet will watch for
   * @returns Proved transaction or error
   */
  balanceAndProveTransaction: (tx: Transaction, newCoins: CoinInfo[]) => Promise<Transaction>;
  /**
   * It will submit given transaction to the node
   * @param tx Transaction to submit
   * @returns First transaction identifier from identifiers list or error
   */
  submitTransaction: Wallet['submitTransaction'];
  /**
   * @deprecated Deprecated since version 1.1.0 and will be removed in version 2.0.0. Please use the `balanceAndProveTransaction` method instead.
   */
  balanceTransaction: Wallet['balanceTransaction'];
  /**
   * @deprecated Deprecated since version 1.1.0 and will be removed in version 2.0.0. Please use the `balanceAndProveTransaction` method instead.
   */
  proveTransaction: Wallet['proveTransaction'];
}

/**
 * DApp Connector API Definition
 *
 * When errors occur in functions returning a promise, they should be thrown in the form of an {@link APIError}.
 */
export interface DAppConnectorAPI {
  /** The name of the wallet */
  name: string;
  /** Semver string. DApps are encouraged to check the compatibility whenever this changes. */
  apiVersion: string;
  /** Check if the wallet has authorized the dapp */
  isEnabled: () => Promise<boolean>;
  /** Request the services (pub-sub, node, and proof server) URIs. */
  serviceUriConfig: () => Promise<ServiceUriConfig>;
  /** Request access to the wallet, returns the wallet api on approval */
  enable: () => Promise<DAppConnectorWalletAPI>;
}
