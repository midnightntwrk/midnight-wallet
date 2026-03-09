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
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { ConnectorConfiguration } from './types.js';

/**
 * Reference implementation of the ConnectedAPI interface.
 * Provides wallet functionality to connected DApps.
 */
export class ConnectedAPI implements ConnectedAPIType {
  private readonly facade: WalletFacade;
  private readonly keystore: UnshieldedKeystore;
  private readonly config: ConnectorConfiguration;

  constructor(facade: WalletFacade, keystore: UnshieldedKeystore, configuration: ConnectorConfiguration) {
    this.facade = facade;
    this.keystore = keystore;
    this.config = configuration;
  }

  // Configuration & Status Methods

  async getConfiguration(): Promise<Configuration> {
    throw new Error('Not implemented');
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    throw new Error('Not implemented');
  }

  // Address Methods (to be implemented)

  async getShieldedAddresses(): Promise<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }> {
    throw new Error('Not implemented');
  }

  async getUnshieldedAddress(): Promise<{ unshieldedAddress: string }> {
    throw new Error('Not implemented');
  }

  async getDustAddress(): Promise<{ dustAddress: string }> {
    throw new Error('Not implemented');
  }

  // Balance Methods (to be implemented)

  async getShieldedBalances(): Promise<Record<string, bigint>> {
    throw new Error('Not implemented');
  }

  async getUnshieldedBalances(): Promise<Record<string, bigint>> {
    throw new Error('Not implemented');
  }

  async getDustBalance(): Promise<{ cap: bigint; balance: bigint }> {
    throw new Error('Not implemented');
  }

  // Transaction History (to be implemented)

  async getTxHistory(_pageNumber: number, _pageSize: number): Promise<HistoryEntry[]> {
    throw new Error('Not implemented');
  }

  // Transaction Building (to be implemented)

  async makeTransfer(
    _desiredOutputs: DesiredOutput[],
    _options?: { payFees?: boolean },
  ): Promise<{ tx: string }> {
    throw new Error('Not implemented');
  }

  async makeIntent(
    _desiredInputs: DesiredInput[],
    _desiredOutputs: DesiredOutput[],
    _options: { intentId: number | 'random'; payFees: boolean },
  ): Promise<{ tx: string }> {
    throw new Error('Not implemented');
  }

  // Transaction Balancing (to be implemented)

  async balanceUnsealedTransaction(
    _tx: string,
    _options?: { payFees?: boolean },
  ): Promise<{ tx: string }> {
    throw new Error('Not implemented');
  }

  async balanceSealedTransaction(
    _tx: string,
    _options?: { payFees?: boolean },
  ): Promise<{ tx: string }> {
    throw new Error('Not implemented');
  }

  // Submission (to be implemented)

  async submitTransaction(_tx: string): Promise<void> {
    throw new Error('Not implemented');
  }

  // Signing & Proving (to be implemented)

  async signData(_data: string, _options: SignDataOptions): Promise<Signature> {
    throw new Error('Not implemented');
  }

  async getProvingProvider(_keyMaterialProvider: KeyMaterialProvider): Promise<ProvingProvider> {
    throw new Error('Not implemented');
  }

  // Hint Usage

  async hintUsage(_methodNames: Array<keyof WalletConnectedAPI>): Promise<void> {
    // Reference implementation: resolve immediately
    // In a real wallet, this would be used to request user permissions
    return Promise.resolve();
  }
}
