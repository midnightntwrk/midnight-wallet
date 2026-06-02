import type {
  ConnectedAPI as ConnectedAPIType,
  Configuration,
  ConnectionStatus,
  DesiredInput,
  DesiredOutput,
  HistoryEntry,
  KeyMaterialProvider,
  ProvingProvider,
  Signature,
  SignDataOptions,
  WalletConnectedAPI,
} from '@midnight-ntwrk/dapp-connector-api';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Cause, Option, Runtime } from 'effect';
import * as rx from 'rxjs';
import type {
  ConnectorConfiguration,
  WalletFacadeView,
  SwapTransactionOptions,
  WalletKeystore,
  BalancingRecipe,
} from './types.js';
import { toAPIConfiguration } from './types.js';
import { APIError } from './errors.js';
import { parseDesiredOutputs, parseDesiredInputs, parseIntentId } from './parsing.js';

// =============================================================================
// Pure Helper Functions
// =============================================================================

/** Tag names for the various InsufficientFunds error shapes across the wallet SDK. */
const INSUFFICIENT_FUNDS_TAGS = new Set([
  // Legacy plain class from @midnight-ntwrk/wallet-sdk-capabilities/balancer
  'InsufficientFundsError',
  // Data.TaggedError variant used by shielded, unshielded, and dust wallets
  'Wallet.InsufficientFunds',
]);

const hasInsufficientFundsTag = (value: unknown): value is { _tag: string; message?: string } => {
  if (value === null || typeof value !== 'object' || !('_tag' in value)) return false;
  const tag = value._tag;
  return typeof tag === 'string' && INSUFFICIENT_FUNDS_TAGS.has(tag);
};

/**
 * Finds an InsufficientFunds-shaped error inside an arbitrary thrown value, looking through Effect's `FiberFailure →
 * Cause<E>` wrapping as well as the standard `Error.cause` chain.
 */
const findInsufficientFundsCause = (error: unknown): { _tag: string; message?: string } | undefined => {
  if (hasInsufficientFundsTag(error)) return error;
  // Effect: when Effect.runPromise rejects, the value is a FiberFailure carrying a Cause<E>.
  if (Runtime.isFiberFailure(error)) {
    const failure = Cause.failureOption(error[Runtime.FiberFailureCauseId]);
    if (Option.isSome(failure) && hasInsufficientFundsTag(failure.value)) return failure.value;
  }
  // Standard Error.cause chain (e.g., when an Error wraps a tagged error).
  let current: unknown = error;
  while (current !== null && typeof current === 'object' && 'cause' in current) {
    const cause = (current as { cause?: unknown }).cause;
    if (hasInsufficientFundsTag(cause)) return cause;
    if (cause === current) break;
    current = cause;
  }
  return undefined;
};

/** Maps any InsufficientFunds-shaped error (including nested under FiberFailure) to APIError; re-throws others. */
const mapInsufficientFundsError = (error: unknown): never => {
  const found = findInsufficientFundsCause(error);
  if (found !== undefined) {
    throw APIError.insufficientFunds(found.message ?? 'Insufficient funds');
  }
  throw error;
};

/** Parse hex string to bytes, throwing APIError on invalid input. */
const parseHexToBytes = (hex: string, context: string): Uint8Array => {
  if (hex === '') {
    throw APIError.invalidRequest(`${context} hex is empty`);
  }
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 0 || Buffer.from(bytes).toString('hex') !== hex.toLowerCase()) {
    throw APIError.invalidRequest(`${context} hex is malformed`);
  }
  return bytes;
};

/** Safely deserialize a transaction, throwing APIError on failure. */
const safeDeserialize = <T>(deserialize: () => T, errorMessage: string): T => {
  try {
    return deserialize();
  } catch {
    throw APIError.invalidRequest(errorMessage);
  }
};

/**
 * Deserialize a sealed (binding) transaction, accepting either the production form `(proof, binding)` or the
 * proof-erased form `(no-proof, no-binding)` used by simulator-backed test environments.
 *
 * The connector itself doesn't validate proofs — that's the wallet's job at submission time. Accepting both forms lets
 * a test backend (simulator) round-trip transactions through the connector API without compromising production safety:
 * a real wallet receiving the result will still reject proof-erased transactions at the submission step.
 */
const deserializeSealed = (txBytes: Uint8Array): ledger.FinalizedTransaction =>
  safeDeserialize<ledger.FinalizedTransaction>(() => {
    try {
      return ledger.Transaction.deserialize('signature', 'proof', 'binding', txBytes);
    } catch {
      // Type cast required because: proof-erased transactions have a narrower type, but the connector passes the
      // result straight to the facade which accepts both shapes at runtime.
      return ledger.Transaction.deserialize(
        'signature',
        'no-proof',
        'no-binding',
        txBytes,
      ) as unknown as ledger.FinalizedTransaction;
    }
  }, 'Failed to deserialize transaction as sealed (binding)');

/**
 * Move the (single) intent in an unproven-transaction recipe to the caller's requested segment.
 *
 * `facade.initSwap`'s options type doesn't carry `intentId`, so the underlying wallet picks the segment via
 * `findAvailableSegmentId` regardless of what the DApp asked for. We post-process the recipe here to honor the spec's
 * `intentId` parameter: rebuild `transaction.intents` with the caller's segment as the sole key. Only safe for the
 * single-intent case; multi-intent recipes are handed back unchanged.
 */
const placeIntentAtSegment = (recipe: BalancingRecipe, intentId: number): BalancingRecipe => {
  if (recipe.type !== 'UNPROVEN_TRANSACTION') return recipe;
  const entries = Array.from(recipe.transaction.intents?.entries() ?? []);
  if (entries.length !== 1) return recipe;
  const [[, intent]] = entries;
  recipe.transaction.intents = new Map([[intentId, intent]]);
  return recipe;
};

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Create TTL one hour from `now`. The clock is sourced from the wallet facade (`facade.clock.now`), so the connector's
 * notion of "now" stays aligned with the wallet's. The ledger's `wellFormed` check rejects txs whose TTL is "too far in
 * the future" relative to the block-time it's verifying against, so this alignment matters for any backend whose clock
 * differs from real wall-clock time (e.g., the simulator's fast-forwarded clock).
 */
const createDefaultTTL = (now: () => Date): Date => new Date(now().getTime() + ONE_HOUR_MS);

/** Determine token kinds to balance based on payFees option. */
const getTokenKindsToBalance = (payFees: boolean): 'all' | ('shielded' | 'unshielded')[] =>
  payFees ? 'all' : ['shielded', 'unshielded'];

/** Execute the recipe workflow: sign → finalize → serialize to hex. */
const finalizeRecipeToHex = async (
  facade: WalletFacadeView,
  keystore: WalletKeystore,
  recipe: BalancingRecipe,
): Promise<string> => {
  const signedRecipe = await facade.signRecipe(recipe, (data) => keystore.signData(data));
  const finalizedTx = await facade.finalizeRecipe(signedRecipe);
  return Buffer.from(finalizedTx.serialize()).toString('hex');
};

/** Decode signing data based on encoding type. */
const decodeSigningData = (data: string, encoding: 'hex' | 'base64' | 'text'): Uint8Array => {
  switch (encoding) {
    case 'hex': {
      if (data === '') return new Uint8Array(0);
      if (!/^[0-9a-fA-F]*$/.test(data)) {
        throw APIError.invalidRequest('Invalid hex encoding');
      }
      return Buffer.from(data, 'hex');
    }
    case 'base64': {
      if (data === '') return new Uint8Array(0);
      // Validate base64 format
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
        throw APIError.invalidRequest('Invalid base64 encoding');
      }
      return Buffer.from(data, 'base64');
    }
    case 'text': {
      return new TextEncoder().encode(data);
    }
  }
};

/**
 * Reference implementation of the ConnectedAPI interface. Provides wallet functionality to connected DApps.
 *
 * Note: This class includes an internal `disconnect()` method for testing purposes. The public API (WalletConnectedAPI
 * from dapp-connector-api) does not include disconnect - disconnection is a wallet-side operation, not something DApps
 * can trigger. Test contexts can access disconnect() by keeping a reference to the concrete class.
 */
export class ConnectedAPI implements ConnectedAPIType {
  private readonly facade: WalletFacadeView;
  private readonly keystore: WalletKeystore;
  private readonly config: ConnectorConfiguration;
  // Use an object reference so state can be modified even when this instance is frozen
  private readonly state: { connected: boolean } = { connected: true };

  constructor(facade: WalletFacadeView, keystore: WalletKeystore, configuration: ConnectorConfiguration) {
    this.facade = facade;
    this.keystore = keystore;
    this.config = configuration;
  }

  // Disconnection (reference implementation extension)

  disconnect(): Promise<void> {
    this.state.connected = false;
    return Promise.resolve();
  }

  private get connected(): boolean {
    return this.state.connected;
  }

  private get secretKeys() {
    return {
      shieldedSecretKeys: this.keystore.getShieldedSecretKeys(),
      dustSecretKey: this.keystore.getDustSecretKey(),
    };
  }

  // Configuration & Status Methods

  getConfiguration(): Promise<Configuration> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    return Promise.resolve(toAPIConfiguration(this.config));
  }

  getConnectionStatus(): Promise<ConnectionStatus> {
    if (!this.connected) {
      return Promise.resolve(Object.freeze({ status: 'disconnected' as const }));
    }
    return Promise.resolve(
      Object.freeze({
        status: 'connected' as const,
        networkId: this.config.networkId,
      }),
    );
  }

  // Address Methods

  async getShieldedAddresses(): Promise<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    const address = await this.facade.shielded.getAddress();
    const networkId = this.config.networkId;

    return Object.freeze({
      shieldedAddress: MidnightBech32m.encode(networkId, address).asString(),
      shieldedCoinPublicKey: MidnightBech32m.encode(networkId, address.coinPublicKey).asString(),
      shieldedEncryptionPublicKey: MidnightBech32m.encode(networkId, address.encryptionPublicKey).asString(),
    });
  }

  async getUnshieldedAddress(): Promise<{ unshieldedAddress: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    const address = await this.facade.unshielded.getAddress();
    const networkId = this.config.networkId;

    return Object.freeze({
      unshieldedAddress: MidnightBech32m.encode(networkId, address).asString(),
    });
  }

  async getDustAddress(): Promise<{ dustAddress: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    const address = await this.facade.dust.getAddress();
    const networkId = this.config.networkId;

    return Object.freeze({
      dustAddress: MidnightBech32m.encode(networkId, address).asString(),
    });
  }

  // Balance Methods

  async getShieldedBalances(): Promise<Record<string, bigint>> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    const state = await rx.firstValueFrom(this.facade.shielded.state);
    return Object.freeze({ ...state.balances });
  }

  async getUnshieldedBalances(): Promise<Record<string, bigint>> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    const state = await rx.firstValueFrom(this.facade.unshielded.state);
    return Object.freeze({ ...state.balances });
  }

  async getDustBalance(): Promise<{ cap: bigint; balance: bigint }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    const state = await rx.firstValueFrom(this.facade.dust.state);
    const now = new Date();
    const cap = state.availableCoins.reduce((sum, coin) => sum + coin.maxCap, 0n);
    const balance = state.balance(now);

    return Object.freeze({ cap, balance });
  }

  // Transaction History

  async getTxHistory(pageNumber: number, pageSize: number): Promise<HistoryEntry[]> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    // Check if facade provides transaction history service
    if (this.facade.transactionHistory === undefined) {
      // Facade doesn't support transaction history API yet
      return Promise.reject(
        APIError.internalError(
          'Transaction history not available: facade does not provide transaction history service',
        ),
      );
    }

    const result = await this.facade.transactionHistory.getHistory(pageNumber, pageSize);

    // Map to HistoryEntry[] and freeze each entry
    return result.entries.map((entry) =>
      Object.freeze({
        txHash: entry.txHash,
        txStatus: entry.txStatus,
      }),
    );
  }

  // Transaction Building

  async makeTransfer(desiredOutputs: DesiredOutput[], options?: { payFees?: boolean }): Promise<{ tx: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    const transfers = parseDesiredOutputs(desiredOutputs, this.config.networkId, { requireAtLeastOne: true });

    try {
      const recipe = await this.facade.transferTransaction(transfers, this.secretKeys, {
        ttl: createDefaultTTL(this.facade.clock.now),
        payFees: options?.payFees ?? true,
      });
      return { tx: await finalizeRecipeToHex(this.facade, this.keystore, recipe) };
    } catch (error) {
      return mapInsufficientFundsError(error);
    }
  }

  async makeIntent(
    desiredInputs: DesiredInput[],
    desiredOutputs: DesiredOutput[],
    options: { intentId: number | 'random'; payFees: boolean },
  ): Promise<{ tx: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    if (desiredInputs.length === 0 && desiredOutputs.length === 0) {
      throw APIError.invalidRequest('At least one input or output is required for an intent');
    }

    const swapInputs = parseDesiredInputs(desiredInputs);
    const swapOutputs = parseDesiredOutputs(desiredOutputs, this.config.networkId, { requireAtLeastOne: false });
    const parsedIntentId = parseIntentId(options.intentId);

    const swapOptions: SwapTransactionOptions = {
      ttl: createDefaultTTL(this.facade.clock.now),
      payFees: options.payFees,
      ...(parsedIntentId !== undefined && { intentId: parsedIntentId }),
    };

    try {
      const recipe = await this.facade.initSwap(swapInputs, swapOutputs, this.secretKeys, swapOptions);
      const placed = parsedIntentId !== undefined ? placeIntentAtSegment(recipe, parsedIntentId) : recipe;
      return { tx: await finalizeRecipeToHex(this.facade, this.keystore, placed) };
    } catch (error) {
      return mapInsufficientFundsError(error);
    }
  }

  // Transaction Balancing

  async balanceUnsealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    const txBytes = parseHexToBytes(tx, 'Transaction');
    const unsealedTx = safeDeserialize<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>>(
      () => ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', txBytes),
      'Failed to deserialize transaction as unsealed (pre-binding)',
    );

    const payFees = options?.payFees ?? true;

    try {
      const recipe = await this.facade.balanceUnboundTransaction(unsealedTx, this.secretKeys, {
        ttl: createDefaultTTL(this.facade.clock.now),
        tokenKindsToBalance: getTokenKindsToBalance(payFees),
      });
      return { tx: await finalizeRecipeToHex(this.facade, this.keystore, recipe) };
    } catch (error) {
      return mapInsufficientFundsError(error);
    }
  }

  async balanceSealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    const txBytes = parseHexToBytes(tx, 'Transaction');
    const sealedTx = deserializeSealed(txBytes);

    const payFees = options?.payFees ?? true;

    try {
      const recipe = await this.facade.balanceFinalizedTransaction(sealedTx, this.secretKeys, {
        ttl: createDefaultTTL(this.facade.clock.now),
        tokenKindsToBalance: getTokenKindsToBalance(payFees),
      });
      return { tx: await finalizeRecipeToHex(this.facade, this.keystore, recipe) };
    } catch (error) {
      return mapInsufficientFundsError(error);
    }
  }

  // Transaction Submission

  async submitTransaction(tx: string): Promise<void> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    const txBytes = parseHexToBytes(tx, 'Transaction');
    const finalizedTx = deserializeSealed(txBytes);

    await this.facade.submitTransaction(finalizedTx);
  }

  // Data Signing

  async signData(data: string, options: SignDataOptions): Promise<Signature> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    // Decode data based on encoding
    const decodedBytes = decodeSigningData(data, options.encoding);

    // Create prefixed message: midnight_signed_message:<size>:<data>
    const prefix = `midnight_signed_message:${decodedBytes.length}:`;
    const prefixBytes = new TextEncoder().encode(prefix);
    const prefixedData = new Uint8Array(prefixBytes.length + decodedBytes.length);
    prefixedData.set(prefixBytes, 0);
    prefixedData.set(decodedBytes, prefixBytes.length);

    // Sign the prefixed data
    const signature = this.keystore.signData(prefixedData);

    // Get the verifying key from the keystore
    const verifyingKey = ledger.signatureVerifyingKey(this.keystore.getUnshieldedSecretKey());

    return {
      data: prefix + data,
      signature: signature,
      verifyingKey: verifyingKey,
    };
  }

  getProvingProvider(keyMaterialProvider: KeyMaterialProvider): Promise<ProvingProvider> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    const factory = this.config.provingProviderFactory;
    if (factory === undefined) {
      return Promise.reject(
        APIError.invalidRequest(
          'Proving provider not configured. Set provingProviderFactory in ConnectorConfiguration.',
        ),
      );
    }

    try {
      const provider = factory(keyMaterialProvider);
      return Promise.resolve(provider);
    } catch (error) {
      return Promise.reject(
        APIError.invalidRequest(
          `Failed to create proving provider: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  // Hint Usage

  hintUsage(_methodNames: Array<keyof WalletConnectedAPI>): Promise<void> {
    // Reference implementation: resolve immediately
    // In a real wallet, this would be used to request user permissions
    return Promise.resolve();
  }
}
