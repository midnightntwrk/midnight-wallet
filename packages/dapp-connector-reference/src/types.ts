import type { Configuration, TxStatus } from '@midnight-ntwrk/dapp-connector-api';
import type { Observable } from 'rxjs';
import type { ShieldedAddress, UnshieldedAddress, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type * as ledger from '@midnight-ntwrk/ledger-v7';

// =============================================================================
// Transaction Recipe Types
// =============================================================================
// These types mirror the recipe types from @midnight-ntwrk/wallet-sdk-facade.
// The WalletFacade uses a recipe-based workflow for building transactions:
// 1. transferTransaction/initSwap → UnprovenTransactionRecipe
// 2. signRecipe → signed recipe
// 3. finalizeRecipe → FinalizedTransaction
// =============================================================================

/**
 * An unbound transaction (proven but not yet cryptographically bound).
 */
export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/**
 * Recipe containing a finalized transaction from external source.
 */
export type FinalizedTransactionRecipe = {
  type: 'FINALIZED_TRANSACTION';
  originalTransaction: ledger.FinalizedTransaction;
  balancingTransaction: ledger.UnprovenTransaction;
};

/**
 * Recipe containing an unbound transaction (proven, ready for binding).
 */
export type UnboundTransactionRecipe = {
  type: 'UNBOUND_TRANSACTION';
  baseTransaction: UnboundTransaction;
  balancingTransaction?: ledger.UnprovenTransaction | undefined;
};

/**
 * Recipe containing an unproven transaction.
 */
export type UnprovenTransactionRecipe = {
  type: 'UNPROVEN_TRANSACTION';
  transaction: ledger.UnprovenTransaction;
};

/**
 * Union of all recipe types for the balancing workflow.
 */
export type BalancingRecipe = FinalizedTransactionRecipe | UnboundTransactionRecipe | UnprovenTransactionRecipe;

// =============================================================================
// Token Transfer Types
// =============================================================================

/**
 * A single token transfer to a recipient address.
 */
export interface TokenTransfer<AddressType extends ShieldedAddress | UnshieldedAddress> {
  type: ledger.RawTokenType;
  receiverAddress: AddressType;
  amount: bigint;
}

/**
 * Shielded token transfer specification.
 */
export type ShieldedTokenTransfer = {
  type: 'shielded';
  outputs: TokenTransfer<ShieldedAddress>[];
};

/**
 * Unshielded token transfer specification.
 */
export type UnshieldedTokenTransfer = {
  type: 'unshielded';
  outputs: TokenTransfer<UnshieldedAddress>[];
};

/**
 * Combined transfer supporting both shielded and unshielded outputs.
 */
export type CombinedTokenTransfer = ShieldedTokenTransfer | UnshieldedTokenTransfer;

/**
 * Inputs for a swap transaction, specifying amounts by token type.
 */
export type CombinedSwapInputs = {
  shielded?: Record<ledger.RawTokenType, bigint>;
  unshielded?: Record<ledger.RawTokenType, bigint>;
};

/**
 * Outputs for a swap transaction.
 */
export type CombinedSwapOutputs = CombinedTokenTransfer;

/**
 * Secret keys required for transaction building.
 */
export interface TransactionSecretKeys {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
}

/**
 * Keystore interface providing all keys needed for wallet operations.
 *
 * This abstraction unifies access to:
 * - Shielded secret keys (for ZK proof generation)
 * - Dust secret key (for fee payment)
 * - Unshielded signing (for public ledger transactions)
 *
 * Implementations may derive keys from HD wallets, hardware wallets,
 * or other secure key storage mechanisms.
 */
export interface WalletKeystore {
  /**
   * Get shielded wallet secret keys for ZK proof generation.
   * These keys are used to create and spend shielded coins.
   */
  getShieldedSecretKeys(): ledger.ZswapSecretKeys;

  /**
   * Get dust wallet secret key for fee payment.
   * This key is used to spend dust coins for transaction fees.
   */
  getDustSecretKey(): ledger.DustSecretKey;

  /**
   * Sign data with the unshielded wallet key.
   * Used for signing unshielded transaction intents.
   */
  signData(data: Uint8Array): ledger.Signature;
}

/**
 * Options for transfer and swap transactions.
 */
export interface TransactionOptions {
  /** Time-to-live for the transaction */
  ttl: Date;
  /** Whether to pay fees from dust wallet (default: true for transfers, false for swaps) */
  payFees?: boolean;
}

/**
 * Extended options for swap transactions with intent ID support.
 */
export interface SwapTransactionOptions extends TransactionOptions {
  /**
   * Segment ID for the intent.
   * If not specified, a random segment ID is used.
   * Must be > 0 (segment 0 is reserved for guaranteed section).
   */
  intentId?: number;
}

/**
 * Token kinds that can be balanced.
 */
export type TokenKind = 'dust' | 'shielded' | 'unshielded';

/**
 * Options for transaction balancing.
 */
export interface BalancingOptions {
  /** Time-to-live for the balancing transaction */
  ttl: Date;
  /**
   * Which token kinds to balance.
   * 'all' balances all token types (default).
   * Array specifies which kinds to balance (e.g., ['shielded', 'dust']).
   */
  tokenKindsToBalance?: 'all' | TokenKind[];
}

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

  // ===========================================================================
  // Transaction Recipe Methods
  // ===========================================================================
  // These methods implement the recipe-based workflow for building transactions.
  // The workflow is: transferTransaction/initSwap → signRecipe → finalizeRecipe
  //
  // NOTE: The current WalletFacade's initSwap doesn't support intentId option.
  // When implementing, random segment IDs are used. To support specific segment
  // IDs, the WalletFacade would need to be extended.
  // ===========================================================================

  /**
   * Create a transfer transaction recipe.
   *
   * @param outputs - Token transfers to create
   * @param secretKeys - Shielded and dust secret keys for signing
   * @param options - Transaction options (TTL, payFees)
   * @returns Unproven transaction recipe
   */
  transferTransaction(
    outputs: CombinedTokenTransfer[],
    secretKeys: TransactionSecretKeys,
    options: TransactionOptions,
  ): Promise<UnprovenTransactionRecipe>;

  /**
   * Create a swap (intent) transaction recipe.
   *
   * @param desiredInputs - Tokens the wallet will provide
   * @param desiredOutputs - Tokens the wallet wants to receive
   * @param secretKeys - Shielded and dust secret keys for signing
   * @param options - Transaction options (TTL, payFees, intentId)
   * @returns Unproven transaction recipe
   */
  initSwap(
    desiredInputs: CombinedSwapInputs,
    desiredOutputs: CombinedSwapOutputs[],
    secretKeys: TransactionSecretKeys,
    options: SwapTransactionOptions,
  ): Promise<UnprovenTransactionRecipe>;

  /**
   * Sign a transaction recipe with the provided signing function.
   *
   * @param recipe - The recipe to sign
   * @param signSegment - Function to sign intent data
   * @returns Signed recipe
   */
  signRecipe(recipe: BalancingRecipe, signSegment: (data: Uint8Array) => ledger.Signature): Promise<BalancingRecipe>;

  /**
   * Finalize a recipe into a ready-to-submit transaction.
   *
   * @param recipe - The recipe to finalize
   * @returns Finalized transaction
   */
  finalizeRecipe(recipe: BalancingRecipe): Promise<ledger.FinalizedTransaction>;

  // ===========================================================================
  // Transaction Balancing Methods
  // ===========================================================================
  // These methods balance existing transactions by adding inputs/outputs.
  // Used when DApps provide transactions that need wallet to add balancing.
  // ===========================================================================

  /**
   * Balance an unbound (unsealed) transaction.
   * Takes a transaction with proofs but not yet cryptographically bound,
   * adds necessary inputs/outputs, and returns a finalized transaction recipe.
   *
   * @param tx - The unbound transaction to balance
   * @param secretKeys - Shielded and dust secret keys
   * @param options - Balancing options (TTL, tokenKindsToBalance)
   * @returns Recipe ready for signing and finalization
   */
  balanceUnboundTransaction(
    tx: UnboundTransaction,
    secretKeys: TransactionSecretKeys,
    options: BalancingOptions,
  ): Promise<UnboundTransactionRecipe>;

  /**
   * Balance a finalized (sealed) transaction.
   * Takes a transaction with proofs and cryptographic binding,
   * adds necessary inputs/outputs in a separate balancing transaction.
   *
   * @param tx - The finalized transaction to balance
   * @param secretKeys - Shielded and dust secret keys
   * @param options - Balancing options (TTL, tokenKindsToBalance)
   * @returns Recipe containing original transaction plus balancing transaction
   */
  balanceFinalizedTransaction(
    tx: ledger.FinalizedTransaction,
    secretKeys: TransactionSecretKeys,
    options: BalancingOptions,
  ): Promise<FinalizedTransactionRecipe>;

  // ===========================================================================
  // Transaction Submission
  // ===========================================================================

  /**
   * Submit a finalized transaction to the network.
   *
   * @param tx - The finalized transaction to submit
   * @returns Promise that resolves when submission is complete
   */
  submitTransaction(tx: ledger.FinalizedTransaction): Promise<void>;
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
