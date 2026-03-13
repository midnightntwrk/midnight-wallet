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
import * as rx from 'rxjs';
import type { ConnectorConfiguration, WalletFacadeView, SwapTransactionOptions, WalletKeystore } from './types.js';
import { toAPIConfiguration } from './types.js';
import { APIError } from './errors.js';
import { parseDesiredOutputs, parseDesiredInputs, parseIntentId } from './parsing.js';
import { ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 * Extended ConnectedAPI type that includes disconnect functionality.
 * This extends the base ConnectedAPI with reference implementation specific methods.
 */
export type ExtendedConnectedAPI = ConnectedAPIType & {
  /**
   * Disconnect from the wallet. After calling this method, all API methods
   * (except getConnectionStatus and hintUsage) will reject with a Disconnected error.
   */
  disconnect(): Promise<void>;
};

/**
 * Reference implementation of the ConnectedAPI interface.
 * Provides wallet functionality to connected DApps.
 */
export class ConnectedAPI implements ExtendedConnectedAPI {
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
    const coinsInfo = state.availableCoinsWithFullInfo(now);
    const cap = coinsInfo.reduce((sum, coin) => sum + coin.maxCap, 0n);
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

    // Get secret keys from keystore
    const secretKeys = {
      shieldedSecretKeys: this.keystore.getShieldedSecretKeys(),
      dustSecretKey: this.keystore.getDustSecretKey(),
    };

    // Create TTL (1 hour from now)
    const ttl = new Date(Date.now() + 60 * 60 * 1000);

    // Build transaction using facade's recipe workflow
    const recipe = await this.facade.transferTransaction(transfers, secretKeys, {
      ttl,
      payFees: options?.payFees ?? true,
    });

    // Sign the recipe (for unshielded outputs)
    const signedRecipe = await this.facade.signRecipe(recipe, (data) => this.keystore.signData(data));

    // Finalize the recipe
    const finalizedTx = await this.facade.finalizeRecipe(signedRecipe);

    // Serialize to hex
    const txHex = Buffer.from(finalizedTx.serialize()).toString('hex');

    return { tx: txHex };
  }

  async makeIntent(
    desiredInputs: DesiredInput[],
    desiredOutputs: DesiredOutput[],
    options: { intentId: number | 'random'; payFees: boolean },
  ): Promise<{ tx: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }

    const swapInputs = parseDesiredInputs(desiredInputs);
    const swapOutputs = parseDesiredOutputs(desiredOutputs, this.config.networkId, { requireAtLeastOne: false });

    if (desiredInputs.length === 0 && desiredOutputs.length === 0) {
      throw APIError.invalidRequest('At least one input or output is required for an intent');
    }

    const parsedIntentId = parseIntentId(options.intentId);

    // Get secret keys from keystore
    const secretKeys = {
      shieldedSecretKeys: this.keystore.getShieldedSecretKeys(),
      dustSecretKey: this.keystore.getDustSecretKey(),
    };

    // Create TTL (1 hour from now)
    const ttl = new Date(Date.now() + 60 * 60 * 1000);

    // Build options, conditionally including intentId
    const swapOptions: SwapTransactionOptions =
      parsedIntentId === undefined
        ? { ttl, payFees: options.payFees }
        : { ttl, payFees: options.payFees, intentId: parsedIntentId };

    // Build transaction using facade's recipe workflow
    const recipe = await this.facade.initSwap(swapInputs, swapOutputs, secretKeys, swapOptions);

    // Sign the recipe (for unshielded outputs)
    const signedRecipe = await this.facade.signRecipe(recipe, (data) => this.keystore.signData(data));

    // Finalize the recipe
    const finalizedTx = await this.facade.finalizeRecipe(signedRecipe);

    // Serialize to hex
    const txHex = Buffer.from(finalizedTx.serialize()).toString('hex');

    return { tx: txHex };
  }

  // Transaction Balancing (to be implemented)

  balanceUnsealedTransaction(_tx: string, _options?: { payFees?: boolean }): Promise<{ tx: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    return Promise.reject(new Error('Not implemented'));
  }

  balanceSealedTransaction(_tx: string, _options?: { payFees?: boolean }): Promise<{ tx: string }> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    return Promise.reject(new Error('Not implemented'));
  }

  // Submission (to be implemented)

  submitTransaction(_tx: string): Promise<void> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    return Promise.reject(new Error('Not implemented'));
  }

  // Signing & Proving (to be implemented)

  signData(_data: string, _options: SignDataOptions): Promise<Signature> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    return Promise.reject(new Error('Not implemented'));
  }

  getProvingProvider(_keyMaterialProvider: KeyMaterialProvider): Promise<ProvingProvider> {
    if (!this.connected) {
      return Promise.reject(APIError.disconnected('Not connected to wallet'));
    }
    return Promise.reject(new Error('Not implemented'));
  }

  // Hint Usage

  hintUsage(_methodNames: Array<keyof WalletConnectedAPI>): Promise<void> {
    // Reference implementation: resolve immediately
    // In a real wallet, this would be used to request user permissions
    return Promise.resolve();
  }
}
