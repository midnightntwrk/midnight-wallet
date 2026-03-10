import { expect, vi } from 'vitest';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { TxStatus } from '@midnight-ntwrk/dapp-connector-api';
import * as ledger from '@midnight-ntwrk/ledger-v7';
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
} from '../types.js';

export const expectMatchObjectTyped = <T>(actual: T, expected: Partial<T>): void => {
  expect(actual).toMatchObject(expected);
};

// Create real address objects for testing
// Using deterministic test data (32 bytes each for shielded keys)
const testCoinPublicKeyData = Buffer.from('064e092a80b33bee23404c46cfc48fec75a2356a9b01178dd6a62c29f5896f67', 'hex');
const testEncryptionPublicKeyData = Buffer.from(
  '0300063c7753854aea18aa11f04d77b3c7eaa0918e4aa98d5eaf0704d8f4c2fc',
  'hex',
);
const testUnshieldedAddressData = Buffer.from(
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  'hex',
);
// Dust address must be < BLSScalar.modulus
const testDustAddressValue = 123456789012345678901234567890n;

// Real address instances
export const testShieldedCoinPublicKey = new ShieldedCoinPublicKey(testCoinPublicKeyData);
export const testShieldedEncryptionPublicKey = new ShieldedEncryptionPublicKey(testEncryptionPublicKeyData);
export const testShieldedAddress = new ShieldedAddress(testShieldedCoinPublicKey, testShieldedEncryptionPublicKey);
export const testUnshieldedAddress = new UnshieldedAddress(testUnshieldedAddressData);
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

  constructor() {
    this.shielded = new MockShieldedWallet();
    this.unshielded = new MockUnshieldedWallet();
    this.dust = new MockDustWallet();
    this.transactionHistory = new MockTransactionHistoryService();
  }

  withBalances(config: MockBalancesConfig): this {
    if (config.shielded !== undefined) {
      const shieldedState: ShieldedWalletStateView = {
        address: testShieldedAddress,
        balances: config.shielded,
      };
      this.shielded.state.next(shieldedState);
    }

    if (config.unshielded !== undefined) {
      const unshieldedState: UnshieldedWalletStateView = {
        address: testUnshieldedAddress,
        balances: config.unshielded,
      };
      this.unshielded.state.next(unshieldedState);
    }

    if (config.dust !== undefined) {
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
}

export function prepareMockFacade(): MockWalletFacade {
  return new MockWalletFacade();
}

// Mock Bech32 address that matches MidnightBech32m interface
const mockBech32Address: MidnightBech32m = MidnightBech32m.encode('testnet', testUnshieldedAddress);

class MockUnshieldedKeystore implements UnshieldedKeystore {
  getSecretKey = vi.fn((): Buffer => Buffer.from('mock-secret-key'));
  getBech32Address = vi.fn((): MidnightBech32m => mockBech32Address);
  getPublicKey = vi.fn((): ledger.SignatureVerifyingKey => 'mock-public-key');
  getAddress = vi.fn((): ledger.UserAddress => testUnshieldedAddress.hexString);
  signData = vi.fn((): ledger.Signature => 'mock-signature');
}

export function prepareMockUnshieldedKeystore(): UnshieldedKeystore {
  return new MockUnshieldedKeystore();
}
