import { Wallet, WalletState } from '@midnight-ntwrk/wallet-api';

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
  /**  PubSub Indexer URI */
  indexerUri: string;
  /**  PubSub Indexer WebSocket URI */
  indexerWsUri: string;
  /**  Prover Server URI */
  proverServerUri: string;
  /**  Substrate URI */
  substrateNodeUri: string;
}

/**
 * Shape of the Wallet API in the DApp Connector
 */
export type DAppConnectorWalletAPI = {
  /** Returns a promise with the exposed wallet state */
  state: () => Promise<DAppConnectorWalletState>;
} & Pick<Wallet, 'submitTransaction' | 'balanceTransaction' | 'proveTransaction'>;

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
  /** Request the services (pubsub, node and proof server) uris. */
  serviceUriConfig: () => Promise<ServiceUriConfig>;
  /** Request access to the wallet, returns the wallet api on approval */
  enable: () => Promise<DAppConnectorWalletAPI>;
}
