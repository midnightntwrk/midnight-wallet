import { Wallet, WalletState as State } from '@midnight/wallet-api';

/**
 * The shape of the wallet state that must be exposed
 */
interface WalletState {
  state: {
    /** The wallet address */
    publicKey: State['publicKey'];
  };
}

/**
 * The wallet functions that must be exposed
 */
export type WalletAPI = Pick<Wallet, 'submitTransaction' | 'balanceTransaction' | 'proveTransaction'>;

/**
 * Shape of the Wallet API in the DApp Connector
 */
export type DAppConnectorWalletAPI = WalletAPI & WalletState;

/**
 * DApp Connector API Definition
 *
 * When errors occur in functions returning a promise, they should be thrown in the form of an {@link APIError}.
 */
export interface DAppConnectorAPI {
  /** The name of the wallet */
  name: string;
  /** The version of the api */
  apiVersion: string;
  /** Check if the wallet has authorized the dapp */
  isEnabled: Promise<boolean>;
  /** Request access to the wallet, returns the wallet api on approval */
  enable: Promise<DAppConnectorWalletAPI>;
}
