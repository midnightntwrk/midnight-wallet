import type { Configuration } from '@midnight-ntwrk/dapp-connector-api';
import type { Observable } from 'rxjs';
import type { ShieldedAddress, UnshieldedAddress, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 * Minimal shielded wallet state interface required by ConnectedAPI.
 * Implementations can provide additional properties.
 */
export interface ShieldedWalletStateView {
  readonly address: ShieldedAddress;
  readonly balances: Record<string, bigint>;
}

/**
 * Minimal unshielded wallet state interface required by ConnectedAPI.
 */
export interface UnshieldedWalletStateView {
  readonly address: UnshieldedAddress;
  readonly balances: Record<string, bigint>;
}

/**
 * Minimal dust coin info required by ConnectedAPI.
 */
export interface DustCoinInfo {
  readonly maxCap: bigint;
}

/**
 * Minimal dust wallet state interface required by ConnectedAPI.
 */
export interface DustWalletStateView {
  readonly address: DustAddress;
  balance(time: Date): bigint;
  availableCoinsWithFullInfo(time: Date): readonly DustCoinInfo[];
}

/**
 * Minimal shielded wallet API required by ConnectedAPI.
 */
export interface ShieldedWalletView {
  readonly state: Observable<ShieldedWalletStateView>;
  getAddress(): Promise<ShieldedAddress>;
}

/**
 * Minimal unshielded wallet API required by ConnectedAPI.
 */
export interface UnshieldedWalletView {
  readonly state: Observable<UnshieldedWalletStateView>;
  getAddress(): Promise<UnshieldedAddress>;
}

/**
 * Minimal dust wallet API required by ConnectedAPI.
 */
export interface DustWalletView {
  readonly state: Observable<DustWalletStateView>;
  getAddress(): Promise<DustAddress>;
}

/**
 * Minimal wallet facade interface required by the DApp Connector.
 *
 * This is a narrowed-down view of WalletFacade from @midnight-ntwrk/wallet-sdk-facade,
 * capturing only the subset of functionality that the DApp Connector actually uses.
 * The full WalletFacade implements this interface.
 *
 * IMPORTANT: If WalletFacade changes in ways that affect the shielded/unshielded/dust
 * wallet APIs used here (state observable, getAddress method, or state properties like
 * balances and availableCoinsWithFullInfo), this interface must be updated accordingly.
 *
 * @see WalletFacade in @midnight-ntwrk/wallet-sdk-facade for the full implementation
 */
export interface WalletFacadeView {
  readonly shielded: ShieldedWalletView;
  readonly unshielded: UnshieldedWalletView;
  readonly dust: DustWalletView;
}

/**
 * Configuration required for the DApp Connector.
 * Contains network information and service URIs.
 */
export type ConnectorConfiguration = {
  /** The network ID this connector is configured for */
  networkId: string;
  /** HTTP URI for the indexer */
  indexerUri: string;
  /** WebSocket URI for the indexer */
  indexerWsUri: string;
  /** URI for the prover server (optional) */
  proverServerUri?: string | undefined;
  /** URI for the Substrate RPC node */
  substrateNodeUri: string;
};

/**
 * Convert internal connector configuration to the API Configuration type.
 * Returns a frozen object to ensure immutability.
 */
export const toAPIConfiguration = (config: ConnectorConfiguration): Configuration =>
  Object.freeze({
    networkId: config.networkId,
    indexerUri: config.indexerUri,
    indexerWsUri: config.indexerWsUri,
    proverServerUri: config.proverServerUri,
    substrateNodeUri: config.substrateNodeUri,
  });
