import { expect, vi } from 'vitest';
import type { TxStatus, DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { InsufficientFundsError } from '@midnight-ntwrk/wallet-sdk-capabilities';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
  DustAddress,
  MidnightBech32m,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as rx from 'rxjs';
import type {
  WalletFacadeView,
  ShieldedWalletView,
  UnshieldedWalletView,
  DustWalletView,
  ShieldedWalletStateView,
  UnshieldedWalletStateView,
  DustWalletStateView,
  DustCoinInfo,
  TransactionHistoryServiceView,
  TransactionHistoryEntryView,
  PaginatedHistoryResult,
  CombinedTokenTransfer,
  CombinedSwapInputs,
  CombinedSwapOutputs,
  TransactionSecretKeys,
  TransactionOptions,
  SwapTransactionOptions,
  UnprovenTransactionRecipe,
  UnboundTransactionRecipe,
  FinalizedTransactionRecipe,
  BalancingRecipe,
  BalancingOptions,
  UnboundTransaction,
  WalletKeystore,
} from '../types.js';

export const expectMatchObjectTyped = <T>(actual: T, expected: Partial<T>): void => {
  expect(actual).toMatchObject(expected);
};

// =============================================================================
// Test Address Infrastructure with Secret Keys
// =============================================================================
// Test addresses are derived from secret keys (not arbitrary data), enabling:
// - Shielded output decryption verification (owner can decrypt using secret keys)
// - Proper address derivation matching real wallet behavior
// =============================================================================

/**
 * A shielded address with its corresponding secret keys retained for testing.
 * Enables verification that outputs can be decrypted by the address owner.
 */
export interface ShieldedAddressWithKeys {
  readonly secretKeys: ledger.ZswapSecretKeys;
  readonly address: ShieldedAddress;
  readonly coinPublicKey: ShieldedCoinPublicKey;
  readonly encryptionPublicKey: ShieldedEncryptionPublicKey;
}

/**
 * An unshielded address with its corresponding secret key retained for testing.
 * Enables signature verification and address ownership checks.
 */
export interface UnshieldedAddressWithKeys {
  readonly secretKey: string; // Hex string for ledger compatibility
  readonly verifyingKey: string; // Public key derived from secret key
  readonly address: UnshieldedAddress;
}

/**
 * Create a shielded address with retained secret keys from a deterministic seed.
 */
export const createShieldedAddressWithKeys = (seed: Uint8Array): ShieldedAddressWithKeys => {
  const secretKeys = ledger.ZswapSecretKeys.fromSeed(seed);
  const coinPublicKey = new ShieldedCoinPublicKey(Buffer.from(secretKeys.coinPublicKey, 'hex'));
  const encryptionPublicKey = new ShieldedEncryptionPublicKey(Buffer.from(secretKeys.encryptionPublicKey, 'hex'));
  const address = new ShieldedAddress(coinPublicKey, encryptionPublicKey);
  return { secretKeys, address, coinPublicKey, encryptionPublicKey };
};

/**
 * Create an unshielded address with retained secret key from a deterministic seed.
 */
export const createUnshieldedAddressWithKeys = (seed: Uint8Array): UnshieldedAddressWithKeys => {
  // Create a deterministic secret key from the seed (padded to 32 bytes, non-zero)
  const paddedSeed = new Uint8Array(32);
  paddedSeed.set(seed.slice(0, 32));
  if (paddedSeed.every((b) => b === 0)) paddedSeed[31] = 1; // Ensure non-zero
  const secretKey = Buffer.from(paddedSeed).toString('hex');
  const verifyingKey = ledger.signatureVerifyingKey(secretKey);
  const address = new UnshieldedAddress(Buffer.from(verifyingKey, 'hex'));
  return { secretKey, verifyingKey, address };
};

// =============================================================================
// Standard Test Addresses
// =============================================================================
// Deterministic seeds for reproducible test addresses
const testShieldedSeed1 = new Uint8Array(32).fill(1);
const testShieldedSeed2 = new Uint8Array(32).fill(2);
const testUnshieldedSeed1 = new Uint8Array(32).fill(3);
const testUnshieldedSeed2 = new Uint8Array(32).fill(4);

// Primary test addresses with retained secret keys
export const testShieldedWithKeys = createShieldedAddressWithKeys(testShieldedSeed1);
export const testShieldedWithKeys2 = createShieldedAddressWithKeys(testShieldedSeed2);
export const testUnshieldedWithKeys = createUnshieldedAddressWithKeys(testUnshieldedSeed1);
export const testUnshieldedWithKeys2 = createUnshieldedAddressWithKeys(testUnshieldedSeed2);

// Legacy exports for backwards compatibility
export const testShieldedCoinPublicKey = testShieldedWithKeys.coinPublicKey;
export const testShieldedEncryptionPublicKey = testShieldedWithKeys.encryptionPublicKey;
export const testShieldedAddress = testShieldedWithKeys.address;
export const testUnshieldedAddress = testUnshieldedWithKeys.address;

// Dust address (separate from shielded, uses different key type)
const testDustAddressValue = 123456789012345678901234567890n;
export const testDustAddress = new DustAddress(testDustAddressValue);

// Mock shielded wallet state with real address
const mockShieldedWalletState: ShieldedWalletStateView = {
  address: testShieldedAddress,
  balances: {},
};

// Mock unshielded wallet state with real address
const mockUnshieldedWalletState: UnshieldedWalletStateView = {
  address: testUnshieldedAddress,
  balances: {},
};

// Mock dust wallet state with real address
const mockDustWalletState: DustWalletStateView = {
  address: testDustAddress,
  balance: () => 0n,
  availableCoinsWithFullInfo: () => [],
};

class MockShieldedWallet implements ShieldedWalletView {
  state = new rx.BehaviorSubject<ShieldedWalletStateView>(mockShieldedWalletState);
  getAddress = vi.fn(() => Promise.resolve(testShieldedAddress));
}

class MockUnshieldedWallet implements UnshieldedWalletView {
  state = new rx.BehaviorSubject<UnshieldedWalletStateView>(mockUnshieldedWalletState);
  getAddress = vi.fn(() => Promise.resolve(testUnshieldedAddress));
}

class MockDustWallet implements DustWalletView {
  state = new rx.BehaviorSubject<DustWalletStateView>(mockDustWalletState);
  getAddress = vi.fn(() => Promise.resolve(testDustAddress));
}

export interface MockDustCoin {
  maxCap: bigint;
  balance: bigint;
}

export interface MockBalancesConfig {
  shielded?: Record<string, bigint>;
  unshielded?: Record<string, bigint>;
  dust?: MockDustCoin[];
}

/**
 * Mock transaction history entry for testing.
 * Uses the "correct" API that the DApp Connector expects.
 */
export interface MockHistoryEntry {
  txHash: string;
  txStatus: TxStatus;
}

/**
 * Mock implementation of TransactionHistoryServiceView for testing.
 * Provides paginated transaction history with proper lifecycle status.
 */
class MockTransactionHistoryService implements TransactionHistoryServiceView {
  private entries: TransactionHistoryEntryView[] = [];

  setEntries(entries: MockHistoryEntry[]): void {
    this.entries = entries.map((e) => ({
      txHash: e.txHash,
      txStatus: e.txStatus,
    }));
  }

  getHistory(pageNumber: number, pageSize: number): Promise<PaginatedHistoryResult> {
    const start = pageNumber * pageSize;
    const end = start + pageSize;
    const paginatedEntries = this.entries.slice(start, end);

    return Promise.resolve({
      entries: paginatedEntries,
      totalCount: this.entries.length,
    });
  }
}

/**
 * Mock implementation of WalletFacadeView for testing.
 *
 * IMPORTANT: This is a narrowed-down version of WalletFacade from @midnight-ntwrk/wallet-sdk-facade.
 * The WalletFacadeView interface (defined in types.ts) captures only the subset of WalletFacade
 * that the DApp Connector actually uses. If WalletFacade changes in ways that affect the
 * properties used by ConnectedAPI, the WalletFacadeView interface and this mock must be
 * updated accordingly.
 *
 * This mock also includes the "ideal" transaction history API that addresses critical gaps
 * in the current wallet implementation (see types.ts for details).
 *
 * @see WalletFacadeView in types.ts for the interface definition
 * @see WalletFacade in @midnight-ntwrk/wallet-sdk-facade for the full implementation
 */
class MockWalletFacade implements WalletFacadeView {
  shielded: MockShieldedWallet;
  unshielded: MockUnshieldedWallet;
  dust: MockDustWallet;
  transactionHistory: MockTransactionHistoryService;

  // Track whether balances were explicitly configured via withBalances()
  // When configured, balance checks are strict (fail if insufficient)
  // When not configured, balance checks are skipped (assume infinite balance)
  private _shieldedBalancesConfigured = false;
  private _unshieldedBalancesConfigured = false;
  private _dustBalancesConfigured = false;

  // Configured error to throw on submission (for testing error handling)
  private _submissionError: Error | undefined = undefined;

  constructor() {
    this.shielded = new MockShieldedWallet();
    this.unshielded = new MockUnshieldedWallet();
    this.dust = new MockDustWallet();
    this.transactionHistory = new MockTransactionHistoryService();
  }

  withBalances(config: MockBalancesConfig): this {
    if (config.shielded !== undefined) {
      this._shieldedBalancesConfigured = true;
      const shieldedState: ShieldedWalletStateView = {
        address: testShieldedAddress,
        balances: config.shielded,
      };
      this.shielded.state.next(shieldedState);
    }

    if (config.unshielded !== undefined) {
      this._unshieldedBalancesConfigured = true;
      const unshieldedState: UnshieldedWalletStateView = {
        address: testUnshieldedAddress,
        balances: config.unshielded,
      };
      this.unshielded.state.next(unshieldedState);
    }

    if (config.dust !== undefined) {
      this._dustBalancesConfigured = true;
      const coins = config.dust;
      const totalBalance = coins.reduce((sum, coin) => sum + coin.balance, 0n);
      const dustState: DustWalletStateView = {
        address: testDustAddress,
        balance: () => totalBalance,
        availableCoinsWithFullInfo: (): readonly DustCoinInfo[] => coins.map((coin) => ({ maxCap: coin.maxCap })),
      };
      this.dust.state.next(dustState);
    }

    return this;
  }

  withTransactionHistory(entries: MockHistoryEntry[]): this {
    this.transactionHistory.setEntries(entries);
    return this;
  }

  withSubmissionError(error: Error): this {
    this._submissionError = error;
    return this;
  }

  // ===========================================================================
  // Transaction Recipe Methods
  // ===========================================================================

  private convertTransfersToDesiredOutputs(transfers: CombinedTokenTransfer[]): DesiredOutput[] {
    const result: DesiredOutput[] = [];
    for (const transfer of transfers) {
      if (transfer.type === 'shielded') {
        for (const output of transfer.outputs) {
          result.push({
            kind: 'shielded',
            type: output.type,
            value: output.amount,
            recipient: MidnightBech32m.encode('testnet', output.receiverAddress).asString(),
          });
        }
      } else {
        for (const output of transfer.outputs) {
          result.push({
            kind: 'unshielded',
            type: output.type,
            value: output.amount,
            recipient: MidnightBech32m.encode('testnet', output.receiverAddress).asString(),
          });
        }
      }
    }
    return result;
  }

  async transferTransaction(
    outputs: CombinedTokenTransfer[],
    _secretKeys: TransactionSecretKeys,
    options: TransactionOptions,
  ): Promise<UnprovenTransactionRecipe> {
    const desiredOutputs = this.convertTransfersToDesiredOutputs(outputs);
    const payFees = options.payFees ?? true;

    // Check balances only for tokens explicitly listed in configured balances
    // Tokens not in the balances object are assumed to have infinite balance
    // This simulates real WalletFacade behavior which throws on insufficient funds

    if (this._shieldedBalancesConfigured) {
      const shieldedState = this.shielded.state.getValue();
      for (const transfer of outputs) {
        if (transfer.type === 'shielded') {
          for (const output of transfer.outputs) {
            // Only check if this specific token is in the balances object
            if (output.type in shieldedState.balances) {
              const balance = shieldedState.balances[output.type];
              if (balance < output.amount) {
                throw new InsufficientFundsError(output.type);
              }
            }
          }
        }
      }
    }

    if (this._unshieldedBalancesConfigured) {
      const unshieldedState = this.unshielded.state.getValue();
      for (const transfer of outputs) {
        if (transfer.type === 'unshielded') {
          for (const output of transfer.outputs) {
            // Only check if this specific token is in the balances object
            if (output.type in unshieldedState.balances) {
              const balance = unshieldedState.balances[output.type];
              if (balance < output.amount) {
                throw new InsufficientFundsError(output.type);
              }
            }
          }
        }
      }
    }

    if (payFees && this._dustBalancesConfigured) {
      const dustState = this.dust.state.getValue();
      if (dustState.balance(new Date()) <= 0n) {
        throw new InsufficientFundsError('dust');
      }
    }

    const tx = buildMockTransferTransaction({
      networkId: 'testnet',
      desiredOutputs,
      payFees,
      ttl: options.ttl,
    });

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: tx as unknown as ledger.UnprovenTransaction,
    };
  }

  async initSwap(
    desiredInputs: CombinedSwapInputs,
    desiredOutputs: CombinedSwapOutputs[],
    _secretKeys: TransactionSecretKeys,
    options: SwapTransactionOptions,
  ): Promise<UnprovenTransactionRecipe> {
    const payFees = options.payFees ?? false;

    // Check balances only for tokens explicitly listed in configured balances
    // Tokens not in the balances object are assumed to have infinite balance
    // This simulates real WalletFacade behavior which throws on insufficient funds

    if (this._shieldedBalancesConfigured && desiredInputs.shielded !== undefined) {
      const shieldedState = this.shielded.state.getValue();
      for (const [type, value] of Object.entries(desiredInputs.shielded)) {
        // Only check if this specific token is in the balances object
        if (type in shieldedState.balances) {
          const balance = shieldedState.balances[type];
          if (balance < value) {
            throw new InsufficientFundsError(type);
          }
        }
      }
    }

    if (this._unshieldedBalancesConfigured && desiredInputs.unshielded !== undefined) {
      const unshieldedState = this.unshielded.state.getValue();
      for (const [type, value] of Object.entries(desiredInputs.unshielded)) {
        // Only check if this specific token is in the balances object
        if (type in unshieldedState.balances) {
          const balance = unshieldedState.balances[type];
          if (balance < value) {
            throw new InsufficientFundsError(type);
          }
        }
      }
    }

    if (payFees && this._dustBalancesConfigured) {
      const dustState = this.dust.state.getValue();
      if (dustState.balance(new Date()) <= 0n) {
        throw new InsufficientFundsError('dust');
      }
    }

    // Convert inputs to DesiredInput array
    const inputs: DesiredInput[] = [];
    if (desiredInputs.shielded !== undefined) {
      for (const [type, value] of Object.entries(desiredInputs.shielded)) {
        inputs.push({ kind: 'shielded', type, value });
      }
    }
    if (desiredInputs.unshielded !== undefined) {
      for (const [type, value] of Object.entries(desiredInputs.unshielded)) {
        inputs.push({ kind: 'unshielded', type, value });
      }
    }

    // Convert outputs to DesiredOutput array
    const outputs = this.convertTransfersToDesiredOutputs(desiredOutputs);

    // Use provided intentId or generate random one (valid segment ID: 1-65535)
    const intentId = options.intentId ?? Math.floor(Math.random() * 65534) + 1;

    const tx = buildMockIntentTransaction({
      networkId: 'testnet',
      desiredInputs: inputs,
      desiredOutputs: outputs,
      payFees,
      intentId,
      ttl: options.ttl,
    });

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: tx as unknown as ledger.UnprovenTransaction,
    };
  }

  async signRecipe(
    recipe: BalancingRecipe,
    _signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<BalancingRecipe> {
    // Mock implementation - just return the recipe unchanged
    // Real implementation would sign unshielded intents
    return recipe;
  }

  async finalizeRecipe(recipe: BalancingRecipe): Promise<ledger.FinalizedTransaction> {
    // Extract the transaction from the recipe and return it as finalized
    if (recipe.type === 'UNPROVEN_TRANSACTION') {
      // The mock transaction is already finalized (we built it that way)
      return recipe.transaction as unknown as ledger.FinalizedTransaction;
    } else if (recipe.type === 'UNBOUND_TRANSACTION') {
      // For unsealed transactions, we need to combine base + balancing and bind
      const baseTx = recipe.baseTransaction;
      const balancingTx = recipe.balancingTransaction;

      // If there's a balancing transaction with DustActions, create a combined result
      if (balancingTx !== undefined) {
        return this.buildCombinedMockTransaction(baseTx, balancingTx);
      }

      return baseTx.bind();
    } else {
      // FINALIZED_TRANSACTION: combine original with balancing transaction
      // The balancing transaction contains DustActions for fee payment
      const originalTx = recipe.originalTransaction;
      const balancingTx = recipe.balancingTransaction;

      // Build a combined mock transaction that includes DustActions from balancing
      return this.buildCombinedMockTransactionFromFinalized(originalTx, balancingTx);
    }
  }

  /**
   * Build a combined mock transaction from an unbound transaction and balancing transaction.
   * Preserves the base transaction structure and adds DustActions from balancing.
   */
  private buildCombinedMockTransaction(
    _baseTx: UnboundTransaction,
    balancingTx: ledger.UnprovenTransaction,
  ): ledger.FinalizedTransaction {
    const ttl = new Date(Date.now() + 60 * 60 * 1000);
    const intent = ledger.Intent.new(ttl);

    // Copy DustActions from balancing transaction if present
    const balancingIntent = balancingTx.intents?.get(0);
    if (balancingIntent?.dustActions !== undefined) {
      intent.dustActions = balancingIntent.dustActions;
    }

    // Build a new transaction with the intent
    const tx = ledger.Transaction.fromParts('testnet', undefined, undefined, intent);
    return tx.mockProve().bind();
  }

  /**
   * Build a combined mock transaction from a finalized transaction and balancing transaction.
   * In production, this would merge the transactions. For mocks, we create a new
   * transaction that has the expected properties (intents, DustActions, binding).
   *
   * Since we can't easily merge ledger transactions, we build a new mock transaction
   * that has the required structure for test verification:
   * - Binding randomness (sealed)
   * - At least one intent
   * - DustActions from the balancing transaction
   */
  private buildCombinedMockTransactionFromFinalized(
    _originalTx: ledger.FinalizedTransaction,
    balancingTx: ledger.UnprovenTransaction,
  ): ledger.FinalizedTransaction {
    const ttl = new Date(Date.now() + 60 * 60 * 1000);
    const intent = ledger.Intent.new(ttl);

    // Copy DustActions from balancing transaction if present
    const balancingIntent = balancingTx.intents?.get(0);
    if (balancingIntent?.dustActions !== undefined) {
      intent.dustActions = balancingIntent.dustActions;
    }

    // Build a new transaction with the intent that has DustActions
    const tx = ledger.Transaction.fromParts('testnet', undefined, undefined, intent);
    return tx.mockProve().bind();
  }

  async balanceUnboundTransaction(
    tx: UnboundTransaction,
    _secretKeys: TransactionSecretKeys,
    options: BalancingOptions,
  ): Promise<UnboundTransactionRecipe> {
    // Check if we should balance dust (pay fees)
    const shouldBalanceDust =
      options.tokenKindsToBalance === 'all' ||
      (Array.isArray(options.tokenKindsToBalance) && options.tokenKindsToBalance.includes('dust'));

    // For mock: check if we have dust balance when fees are required
    if (shouldBalanceDust) {
      const dustState = this.dust.state.getValue();
      const dustBalance = dustState.balance(new Date());
      if (dustBalance <= 0n) {
        throw new InsufficientFundsError('dust');
      }
    }

    // Build a mock balancing transaction with DustSpend if needed
    const balancingTx = shouldBalanceDust ? this.buildMockBalancingTransaction(options.ttl) : undefined;

    return {
      type: 'UNBOUND_TRANSACTION',
      baseTransaction: tx,
      balancingTransaction: balancingTx,
    };
  }

  async balanceFinalizedTransaction(
    tx: ledger.FinalizedTransaction,
    _secretKeys: TransactionSecretKeys,
    options: BalancingOptions,
  ): Promise<FinalizedTransactionRecipe> {
    // Check if we should balance dust (pay fees)
    const shouldBalanceDust =
      options.tokenKindsToBalance === 'all' ||
      (Array.isArray(options.tokenKindsToBalance) && options.tokenKindsToBalance.includes('dust'));

    // For mock: check if we have dust balance when fees are required
    if (shouldBalanceDust) {
      const dustState = this.dust.state.getValue();
      const dustBalance = dustState.balance(new Date());
      if (dustBalance <= 0n) {
        throw new InsufficientFundsError('dust');
      }
    }

    // Build a mock balancing transaction with DustSpend if needed
    const balancingTx = this.buildMockBalancingTransaction(options.ttl, shouldBalanceDust);

    return {
      type: 'FINALIZED_TRANSACTION',
      originalTransaction: tx,
      balancingTransaction: balancingTx,
    };
  }

  // ===========================================================================
  // Transaction Submission
  // ===========================================================================

  async submitTransaction(_tx: ledger.FinalizedTransaction): Promise<void> {
    if (this._submissionError !== undefined) {
      throw this._submissionError;
    }
    // Mock: submission succeeds
  }

  private buildMockBalancingTransaction(ttl: Date, includeDustSpend: boolean = true): ledger.UnprovenTransaction {
    // Create a minimal unproven transaction for balancing
    const intent = ledger.Intent.new(ttl);

    if (includeDustSpend) {
      // Add DustActions to indicate fee payment
      const dustActions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>(
        'signature',
        'pre-proof',
        new Date(),
        [],
        [],
      );
      intent.dustActions = dustActions;
    }

    // Create transaction and explicitly set the intents map
    const tx = ledger.Transaction.fromParts('testnet', undefined, undefined, intent);
    // Ensure the intent is accessible in the intents map at key 0 (guaranteed section)
    tx.intents = new Map([[0, intent]]);
    return tx;
  }
}

export function prepareMockFacade(): MockWalletFacade {
  return new MockWalletFacade();
}

// Test secret key seed for mock keystore (non-zero for valid keys)
const mockKeystoreSeed = new Uint8Array(32).fill(1);

/**
 * Mock implementation of WalletKeystore for testing.
 * Uses deterministic keys derived from a fixed test seed.
 */
class MockWalletKeystore implements WalletKeystore {
  private readonly shieldedSecretKeys: ledger.ZswapSecretKeys;
  private readonly dustSecretKey: ledger.DustSecretKey;

  constructor() {
    this.shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(mockKeystoreSeed);
    this.dustSecretKey = ledger.DustSecretKey.fromSeed(mockKeystoreSeed);
  }

  getShieldedSecretKeys(): ledger.ZswapSecretKeys {
    return this.shieldedSecretKeys;
  }

  getDustSecretKey(): ledger.DustSecretKey {
    return this.dustSecretKey;
  }

  getUnshieldedSecretKey(): string {
    // Use a deterministic secret key for testing (same as used in signData)
    return '0'.repeat(63) + '1';
  }

  signData(_data: Uint8Array): ledger.Signature {
    // Use the same deterministic secret key for consistency
    return ledger.signData(this.getUnshieldedSecretKey(), _data);
  }
}

export function prepareMockUnshieldedKeystore(): WalletKeystore {
  return new MockWalletKeystore();
}

// =============================================================================
// Mock Transaction Builder
// =============================================================================
// Builds valid FinalizedTransaction objects for testing.
// These transactions have the correct structure that the verification
// helpers in testing.ts can analyze.
// =============================================================================

/**
 * Options for building a mock transaction.
 */
export interface MockTransactionOptions {
  /** Network ID for the transaction */
  networkId: string;
  /** Desired outputs to include in the transaction */
  desiredOutputs: DesiredOutput[];
  /** Whether to include DustSpend for fees */
  payFees: boolean;
  /** TTL for the transaction */
  ttl?: Date;
}

/**
 * Options for building a mock intent transaction.
 */
export interface MockIntentOptions extends MockTransactionOptions {
  /** Desired inputs (what wallet provides) */
  desiredInputs: DesiredInput[];
  /** Segment ID for the intent */
  intentId: number;
}

// Test secret keys for building mock transactions - use non-zero seed for valid keys
const testSecretKeySeed = new Uint8Array(32).fill(1);
const testSecretKeys = ledger.ZswapSecretKeys.fromSeed(testSecretKeySeed);

/**
 * Mock shielded wallet state for creating balanced transactions.
 * This state receives coins that can then be spent to balance transfer outputs.
 */
class MockShieldedWalletState {
  private state: ledger.ZswapLocalState;
  private readonly secretKeys: ledger.ZswapSecretKeys;

  constructor(secretKeys: ledger.ZswapSecretKeys) {
    this.state = new ledger.ZswapLocalState();
    this.secretKeys = secretKeys;
  }

  /**
   * Receives coins into the mock wallet by replaying a mock "receive" event.
   * Returns a QualifiedShieldedCoinInfo that can be spent later.
   */
  receiveCoin(tokenType: ledger.RawTokenType, value: bigint): ledger.QualifiedShieldedCoinInfo {
    const coin = ledger.createShieldedCoinInfo(tokenType, value);
    const output = ledger.ZswapOutput.new(coin, 0, this.secretKeys.coinPublicKey, this.secretKeys.encryptionPublicKey);
    const offer = ledger.ZswapOffer.fromOutput(output, tokenType, value);
    this.state = this.state.apply(this.secretKeys, offer);

    // Find the coin we just received in the state
    const qualifiedCoin = Array.from(this.state.coins).find((c) => c.type === tokenType && c.value === value);
    if (qualifiedCoin === undefined) {
      throw new Error('Failed to receive mock coin into wallet state');
    }
    return qualifiedCoin;
  }

  /**
   * Spends a coin from the wallet, returning the input for a transaction.
   */
  spend(coin: ledger.QualifiedShieldedCoinInfo, segment?: number): ledger.UnprovenInput {
    const [newState, input] = this.state.spend(this.secretKeys, coin, segment);
    this.state = newState;
    return input;
  }

  get coins(): Set<ledger.QualifiedShieldedCoinInfo> {
    return this.state.coins;
  }
}

// Global mock wallet state for building balanced transactions
const mockShieldedWallet = new MockShieldedWalletState(testSecretKeys);

/**
 * Build a mock ZswapOffer from shielded desired outputs.
 * Creates a balanced offer by first receiving coins, then spending them as inputs.
 */
function buildMockShieldedOffer(
  outputs: Array<{ type: string; value: bigint }>,
): ledger.ZswapOffer<ledger.PreProof> | undefined {
  if (outputs.length === 0) return undefined;

  let offer: ledger.ZswapOffer<ledger.PreProof> | undefined;

  for (const output of outputs) {
    const tokenType = output.type;

    // Create the output (coin being sent to recipient)
    const outputCoin = ledger.createShieldedCoinInfo(tokenType, output.value);
    const zswapOutput = ledger.ZswapOutput.new(
      outputCoin,
      0, // segment 0 for guaranteed
      testSecretKeys.coinPublicKey,
      testSecretKeys.encryptionPublicKey,
    );
    const outputOffer = ledger.ZswapOffer.fromOutput(zswapOutput, tokenType, output.value);

    // Receive a matching coin into the wallet, then spend it as input
    const receivedCoin = mockShieldedWallet.receiveCoin(tokenType, output.value);
    const input = mockShieldedWallet.spend(receivedCoin, 0);
    const inputOffer = ledger.ZswapOffer.fromInput(input, tokenType, output.value);

    if (offer === undefined) {
      offer = outputOffer.merge(inputOffer);
    } else {
      offer = offer.merge(outputOffer).merge(inputOffer);
    }
  }

  return offer;
}

/**
 * Build a mock UnshieldedOffer from unshielded desired outputs.
 */
function buildMockUnshieldedOffer(
  outputs: Array<{ type: string; value: bigint; recipient: string }>,
): ledger.UnshieldedOffer<ledger.SignatureEnabled> | undefined {
  if (outputs.length === 0) return undefined;

  const utxoOutputs: ledger.UtxoOutput[] = outputs.map((output) => {
    // Decode Bech32m address to get hex representation
    const parsed = MidnightBech32m.parse(output.recipient);
    const unshieldedAddr = parsed.decode(UnshieldedAddress, 'testnet');
    return {
      type: output.type,
      value: output.value,
      owner: unshieldedAddr.hexString,
    };
  });

  // Create matching inputs to balance
  // Use ledger's signatureVerifyingKey to derive a valid verifying key from a mock secret key
  // Secret key must be a valid non-zero scalar (32 bytes as hex)
  const mockSecretKey = '0'.repeat(63) + '1'; // 32 bytes as hex, non-zero
  const mockVerifyingKey = ledger.signatureVerifyingKey(mockSecretKey);
  const mockIntentHash = '0'.repeat(64);
  const utxoInputs: ledger.UtxoSpend[] = outputs.map((output, i) => ({
    type: output.type,
    value: output.value,
    owner: mockVerifyingKey,
    intentHash: mockIntentHash,
    outputNo: i,
  }));

  // Create a valid signature using the same secret key
  const mockSignature = ledger.signData(mockSecretKey, new Uint8Array(32));
  return ledger.UnshieldedOffer.new(utxoInputs, utxoOutputs, [mockSignature]);
}

/**
 * Build a mock Intent with optional DustActions for fee payment.
 * When payFees is true, creates DustActions to indicate fees will be paid.
 */
function buildMockIntent(
  ttl: Date,
  payFees: boolean,
  unshieldedOffer?: ledger.UnshieldedOffer<ledger.SignatureEnabled>,
): ledger.Intent<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding> {
  const intent = ledger.Intent.new(ttl);

  if (unshieldedOffer !== undefined) {
    intent.guaranteedUnshieldedOffer = unshieldedOffer;
  }

  if (payFees) {
    const dustActions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>(
      'signature',
      'pre-proof',
      new Date(),
      [],
      [],
    );
    intent.dustActions = dustActions;
  }

  return intent;
}

/**
 * Build a mock FinalizedTransaction from desired outputs.
 * The transaction will be balanced (all token deltas = 0) and include
 * DustSpend if payFees is true.
 */
export function buildMockTransferTransaction(options: MockTransactionOptions): ledger.FinalizedTransaction {
  const { networkId, desiredOutputs, payFees, ttl = new Date(Date.now() + 60 * 60 * 1000) } = options;

  // Separate shielded and unshielded outputs
  const shieldedOutputs = desiredOutputs
    .filter((o): o is DesiredOutput & { kind: 'shielded' } => o.kind === 'shielded')
    .map((o) => ({ type: o.type, value: o.value }));

  const unshieldedOutputs = desiredOutputs
    .filter((o): o is DesiredOutput & { kind: 'unshielded' } => o.kind === 'unshielded')
    .map((o) => ({ type: o.type, value: o.value, recipient: o.recipient }));

  // Build offers
  const shieldedOffer = buildMockShieldedOffer(shieldedOutputs);
  const unshieldedOffer = buildMockUnshieldedOffer(unshieldedOutputs);

  // Build intent
  const intent = buildMockIntent(ttl, payFees, unshieldedOffer);

  // Create transaction
  const tx = ledger.Transaction.fromParts(networkId, shieldedOffer, undefined, intent);

  // Mock prove and bind to create FinalizedTransaction
  return tx.mockProve().bind();
}

/**
 * Build a mock FinalizedTransaction for an intent (swap).
 * The transaction will have intentional imbalances based on inputs/outputs.
 */
export function buildMockIntentTransaction(options: MockIntentOptions): ledger.FinalizedTransaction {
  const {
    networkId,
    desiredInputs,
    desiredOutputs,
    payFees,
    intentId,
    ttl = new Date(Date.now() + 60 * 60 * 1000),
  } = options;

  // For intents, we create the imbalance:
  // - desiredInputs: wallet provides these (positive delta)
  // - desiredOutputs: wallet wants these (negative delta)

  // Build shielded offer with the imbalances
  const shieldedInputs: Array<{ type: string; value: bigint }> = desiredInputs
    .filter((i): i is DesiredInput & { kind: 'shielded' } => i.kind === 'shielded')
    .map((i) => ({ type: i.type, value: i.value }));

  const shieldedOutputs: Array<{ type: string; value: bigint }> = desiredOutputs
    .filter((o): o is DesiredOutput & { kind: 'shielded' } => o.kind === 'shielded')
    .map((o) => ({ type: o.type, value: o.value }));

  const unshieldedInputs: Array<{ type: string; value: bigint }> = desiredInputs
    .filter((i): i is DesiredInput & { kind: 'unshielded' } => i.kind === 'unshielded')
    .map((i) => ({ type: i.type, value: i.value }));

  const unshieldedOutputs = desiredOutputs
    .filter((o): o is DesiredOutput & { kind: 'unshielded' } => o.kind === 'unshielded')
    .map((o) => ({ type: o.type, value: o.value, recipient: o.recipient }));

  // Build shielded offer (intentionally unbalanced)
  let shieldedOffer: ledger.ZswapOffer<ledger.PreProof> | undefined;

  // Add shielded inputs (wallet provides - negative imbalance)
  for (const input of shieldedInputs) {
    const coin = ledger.createShieldedCoinInfo(input.type, input.value);
    const zswapOutput = ledger.ZswapOutput.new(
      coin,
      intentId,
      testSecretKeys.coinPublicKey,
      testSecretKeys.encryptionPublicKey,
    );
    // Negative delta means wallet is providing
    const inputOffer = ledger.ZswapOffer.fromOutput(zswapOutput, input.type, -input.value);

    shieldedOffer = shieldedOffer === undefined ? inputOffer : shieldedOffer.merge(inputOffer);
  }

  // NOTE: Unshielded inputs are handled through the UnshieldedOffer below,
  // NOT through shielded offers. This ensures proper token kind separation
  // in imbalance calculations.

  // Add shielded outputs (wallet wants to receive - expect positive imbalance)
  // Strategy: Create output (for visibility in verification) + create input of 2x value (for positive net imbalance)
  // Net imbalance = input_delta - output_delta = 2v - v = +v (positive, as expected)
  for (const output of shieldedOutputs) {
    const tokenType = output.type;

    // Create output (appears in verification.shieldedOutputCount)
    const coin = ledger.createShieldedCoinInfo(tokenType, output.value);
    const zswapOutput = ledger.ZswapOutput.new(
      coin,
      intentId,
      testSecretKeys.coinPublicKey,
      testSecretKeys.encryptionPublicKey,
    );
    const outputOffer = ledger.ZswapOffer.fromOutput(zswapOutput, tokenType, output.value);

    // Create input of 2x value to achieve positive net imbalance
    // First, receive coins into the mock wallet, then spend them
    const receivedCoin = mockShieldedWallet.receiveCoin(tokenType, output.value * 2n);
    const input = mockShieldedWallet.spend(receivedCoin, intentId);
    const inputOffer = ledger.ZswapOffer.fromInput(input, tokenType, output.value * 2n);

    // Merge both: output (-value) + input (+2value) = net +value
    const combinedOffer = outputOffer.merge(inputOffer);
    shieldedOffer = shieldedOffer === undefined ? combinedOffer : shieldedOffer.merge(combinedOffer);
  }

  // Build intent with unshielded parts
  const intent = ledger.Intent.new(ttl);

  // Use valid cryptographic keys for unshielded offers
  const mockSecretKey = '0'.repeat(63) + '1'; // 32 bytes as hex, non-zero
  const mockVerifyingKey = ledger.signatureVerifyingKey(mockSecretKey);
  const mockSignature = ledger.signData(mockSecretKey, new Uint8Array(32));
  const mockIntentHash = '0'.repeat(64);

  // Imbalance calculation: imbalance = sum(inputs) - sum(outputs)
  // Test expectations:
  // - desiredInputs (wallet provides) → negative imbalance, but NOT in verification.unshieldedOutputs
  // - desiredOutputs (wallet wants) → positive imbalance, AND appears in verification.unshieldedOutputs
  //
  // Strategy:
  // - desiredInputs: create INPUT + OUTPUT of 2x value → imbalance = v - 2v = -v (negative)
  //   The outputs go to a dummy address and don't affect verification (which only checks desiredOutputs recipients)
  // - desiredOutputs: create OUTPUT (for verification) + INPUT of 2x value → imbalance = 2v - v = +v (positive)

  // Collect all inputs and outputs for the unshielded offer
  const utxoInputs: ledger.UtxoSpend[] = [];
  const utxoOutputs: ledger.UtxoOutput[] = [];
  let inputCounter = 0;

  // Imbalance calculation: The ledger computes imbalance per segment.
  // Test expectations (from computeExpectedImbalances):
  // - desiredInputs (wallet provides) → NEGATIVE imbalance
  // - desiredOutputs (wallet wants) → POSITIVE imbalance
  //
  // For unshielded tokens:
  // - Creating inputs (spends) ADDS to imbalance (positive contribution)
  // - Creating outputs SUBTRACTS from imbalance (negative contribution)
  //
  // Strategy for unshielded:
  // - desiredInputs: create OUTPUT only (to dummy address) → imbalance = 0 - v = -v (negative)
  //   The outputs go to mockVerifyingKey and tests check specific recipients, so no interference
  // - desiredOutputs: create OUTPUT (for verification) + INPUT of 2x value → net positive

  // Process unshielded desiredInputs (wallet provides → negative imbalance)
  for (const input of unshieldedInputs) {
    // Create output only (no matching input) to a dummy address
    // This creates negative imbalance: imbalance = 0 - value = -value
    utxoOutputs.push({
      type: input.type as ledger.RawTokenType,
      value: input.value,
      owner: mockVerifyingKey, // Dummy address - won't interfere with recipient checks
    });
  }

  // Process unshielded desiredOutputs (wallet wants → positive imbalance)
  for (const output of unshieldedOutputs) {
    // Decode Bech32m address to get hex representation
    const parsed = MidnightBech32m.parse(output.recipient);
    const unshieldedAddr = parsed.decode(UnshieldedAddress, 'testnet');

    // Create the output (appears in verification.unshieldedOutputs)
    utxoOutputs.push({
      type: output.type as ledger.RawTokenType,
      value: output.value,
      owner: unshieldedAddr.hexString,
    });

    // Create input of 2x value to achieve positive net imbalance
    // imbalance = 2*value - value = +value
    utxoInputs.push({
      type: output.type as ledger.RawTokenType,
      value: output.value * 2n,
      owner: mockVerifyingKey,
      intentHash: mockIntentHash,
      outputNo: inputCounter++,
    });
  }

  // Create the unshielded offer if we have any inputs or outputs
  if (utxoInputs.length > 0 || utxoOutputs.length > 0) {
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
      utxoInputs,
      utxoOutputs,
      utxoInputs.length > 0 ? [mockSignature] : [],
    );
  }

  // Add DustActions if payFees
  if (payFees) {
    const dustActions = new ledger.DustActions<ledger.SignatureEnabled, ledger.PreProof>(
      'signature',
      'pre-proof',
      new Date(),
      [],
      [],
    );
    intent.dustActions = dustActions;
  }

  // Create transaction and place intent in the specified segment
  // For unproven+unbound transactions, we can directly set the intents map
  const tx = ledger.Transaction.fromParts(networkId, shieldedOffer, undefined, undefined);

  // Set intents map with the intent at the specified segment ID
  // The ledger documentation states that writing to intents map re-computes
  // binding information for unproven+unbound transactions
  tx.intents = new Map([[intentId, intent]]);

  // Mock prove and bind
  return tx.mockProve().bind();
}

/**
 * Serialize a FinalizedTransaction to hex string.
 */
export function serializeTransaction(tx: ledger.FinalizedTransaction): string {
  return Buffer.from(tx.serialize()).toString('hex');
}

/**
 * Transaction type for unsealed (pre-binding) transactions.
 * These have proofs but are not yet cryptographically bound.
 */
export type UnsealedTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/**
 * Options for building a mock unsealed transaction.
 */
export interface MockUnsealedTransactionOptions {
  networkId: string;
  ttl?: Date;
  /** Token outputs that create imbalances needing to be balanced by wallet */
  outputs?: Array<{ type: string; value: bigint }>;
}

/**
 * Build a mock unsealed transaction hex string for testing.
 * Creates a transaction with shielded outputs that create imbalances,
 * simulating what a DApp would send for balancing.
 *
 * LIMITATION: mockProve() internally also binds the transaction. We cannot create
 * true pre-binding transactions without real proving. For unit tests, this function
 * returns a SEALED transaction that can be used with the mock facade (which accepts
 * any bytes). The `balanceUnsealedTransaction` tests that verify unsealed vs sealed
 * distinction will detect this as sealed, which is correct behavior.
 *
 * Happy path tests for `balanceUnsealedTransaction` require integration testing
 * with a real prover to create true pre-binding transactions.
 */
export function buildMockUnsealedTransaction(options: MockUnsealedTransactionOptions): string {
  // Default token type: 64-character hex string (32 bytes)
  const defaultTokenType = '0000000000000000000000000000000000000000000000000000000000000001';
  const {
    networkId,
    ttl = new Date(Date.now() + 60 * 60 * 1000),
    outputs = [{ type: defaultTokenType, value: 100n }],
  } = options;

  // Build shielded offer with outputs (creates negative imbalance - wallet needs to provide inputs)
  const shieldedOffer = buildMockShieldedOffer(outputs);

  // Create intent
  const intent = ledger.Intent.new(ttl);

  // Create transaction with the shielded offer
  const tx = ledger.Transaction.fromParts(networkId, shieldedOffer, undefined, intent);

  // mockProve() creates a proven AND bound transaction (despite type saying PreBinding)
  // This is a ledger limitation - we can't create true pre-binding transactions in tests
  const provenTx = tx.mockProve();

  return Buffer.from(provenTx.serialize()).toString('hex');
}

/**
 * Options for building a mock sealed transaction.
 */
export interface MockSealedTransactionOptions {
  networkId: string;
  ttl?: Date;
  /** Token outputs that create imbalances needing to be balanced by wallet */
  outputs?: Array<{ type: string; value: bigint }>;
}

/**
 * Build a mock sealed transaction (with proofs and binding).
 * Creates a transaction with shielded outputs that create imbalances,
 * simulating a swap transaction from another party that needs balancing.
 * This is the type expected by balanceSealedTransaction.
 */
export function buildMockSealedTransaction(options: MockSealedTransactionOptions): ledger.FinalizedTransaction {
  // Default token type: 64-character hex string (32 bytes)
  const defaultTokenType = '0000000000000000000000000000000000000000000000000000000000000001';
  const {
    networkId,
    ttl = new Date(Date.now() + 60 * 60 * 1000),
    outputs = [{ type: defaultTokenType, value: 100n }],
  } = options;

  // Build shielded offer with outputs (creates negative imbalance)
  const shieldedOffer = buildMockShieldedOffer(outputs);

  // Create intent
  const intent = ledger.Intent.new(ttl);

  // Create transaction with the shielded offer
  const tx = ledger.Transaction.fromParts(networkId, shieldedOffer, undefined, intent);

  // Mock prove and bind
  return tx.mockProve().bind();
}
