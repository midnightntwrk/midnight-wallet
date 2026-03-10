import type { Configuration, TxStatus } from '@midnight-ntwrk/dapp-connector-api';
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
  /**
   * Transaction history service. Optional because the current WalletFacade
   * doesn't provide this API (see critical gaps documentation below).
   */
  readonly transactionHistory?: TransactionHistoryServiceView;
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

// =============================================================================
// Transaction History Types
// =============================================================================
// The following types define the "ideal" API for transaction history that the
// DApp Connector expects. The current wallet facade (WalletFacade from
// @midnight-ntwrk/wallet-sdk-facade) does not fully support this API.
//
// Critical gaps in current WalletFacade:
// 1. Status model mismatch: Wallet uses execution result ('SUCCESS'|'FAILURE'|
//    'PARTIAL_SUCCESS'), API expects lifecycle status ('finalized'|'confirmed'|
//    'pending'|'discarded')
// 2. No per-segment execution status: API expects Record<number, 'Success'|'Failure'>
// 3. No 'pending' or 'discarded' tracking: Wallet only stores finalized transactions
// 4. No pagination: Wallet's getAll() returns AsyncIterableIterator
//
// IMPORTANT: When WalletFacade is updated to support these features, the
// TransactionHistoryServiceView interface should be updated to match.
// =============================================================================

/**
 * Transaction hash as hex string.
 */
export type TransactionHash = string;

/**
 * A single transaction history entry as expected by the DApp Connector API.
 * This matches the HistoryEntry type from @midnight-ntwrk/dapp-connector-api.
 */
export interface TransactionHistoryEntryView {
  /**
   * Hex-encoded transaction hash.
   */
  readonly txHash: TransactionHash;

  /**
   * Transaction lifecycle status with execution details for finalized/confirmed.
   */
  readonly txStatus: TxStatus;
}

/**
 * Result of a paginated query for transaction history.
 */
export interface PaginatedHistoryResult {
  readonly entries: readonly TransactionHistoryEntryView[];
  readonly totalCount: number;
}

/**
 * Service interface for querying transaction history.
 * This is the "ideal" API that the DApp Connector expects from the wallet.
 *
 * IMPORTANT: This interface addresses critical gaps in the current wallet
 * implementation. When WalletFacade is updated to support these features,
 * this interface should be updated to match.
 */
export interface TransactionHistoryServiceView {
  /**
   * Get paginated transaction history.
   * @param pageNumber - Zero-based page number
   * @param pageSize - Number of entries per page
   * @returns Paginated history entries with lifecycle status
   */
  getHistory(pageNumber: number, pageSize: number): Promise<PaginatedHistoryResult>;
}
