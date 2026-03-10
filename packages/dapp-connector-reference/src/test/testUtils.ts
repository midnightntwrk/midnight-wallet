import { expect, vi } from 'vitest';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedWalletAPI, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { DustWalletAPI, DustWalletState } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import type { ShieldedWalletAPI, ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import type { SubmissionService, PendingTransactionsService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import type { ProvingService, UnboundTransaction } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type * as ledger from '@midnight-ntwrk/ledger-v7';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
  DustAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as rx from 'rxjs';

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
const mockShieldedWalletState: Partial<ShieldedWalletState> = {
  address: testShieldedAddress,
  balances: {},
};

// Mock unshielded wallet state with real address
const mockUnshieldedWalletState: Partial<UnshieldedWalletState> = {
  address: testUnshieldedAddress,
  balances: {},
};

// Mock dust wallet state with real address
const mockDustWalletState: Partial<DustWalletState> = {
  address: testDustAddress,
  balance: () => 0n,
  availableCoinsWithFullInfo: () => [],
};

class MockShieldedWallet implements ShieldedWalletAPI {
  state: rx.Subject<ShieldedWalletState> = new rx.Subject();
  start = vi.fn();
  balanceTransaction = vi.fn();
  transferTransaction = vi.fn();
  revertTransaction = vi.fn();
  initSwap = vi.fn();
  serializeState = vi.fn();
  waitForSyncedState = vi.fn(() => Promise.resolve(mockShieldedWalletState as ShieldedWalletState));
  getAddress = vi.fn(() => Promise.resolve(testShieldedAddress));
  stop = vi.fn();
}

class MockUnshieldedWallet implements UnshieldedWalletAPI {
  state: rx.Subject<UnshieldedWalletState> = new rx.Subject();
  start = vi.fn();
  signUnprovenTransaction = vi.fn();
  signUnboundTransaction = vi.fn();
  revertTransaction = vi.fn();
  transferTransaction = vi.fn();
  initSwap = vi.fn();
  serializeState = vi.fn();
  waitForSyncedState = vi.fn(() => Promise.resolve(mockUnshieldedWalletState as UnshieldedWalletState));
  getAddress = vi.fn(() => Promise.resolve(testUnshieldedAddress));
  stop = vi.fn();
  balanceFinalizedTransaction = vi.fn();
  balanceUnboundTransaction = vi.fn();
  balanceUnprovenTransaction = vi.fn();
}

class MockDustWallet implements DustWalletAPI {
  state: rx.Subject<DustWalletState> = new rx.Subject();
  start = vi.fn();
  balanceTransactions = vi.fn();
  revertTransaction = vi.fn();
  createDustGenerationTransaction = vi.fn();
  addDustGenerationSignature = vi.fn();
  calculateFee = vi.fn();
  serializeState = vi.fn();
  waitForSyncedState = vi.fn(() => Promise.resolve(mockDustWalletState as DustWalletState));
  getAddress = vi.fn(() => Promise.resolve(testDustAddress));
  stop = vi.fn();
}

class MockWalletFacade extends WalletFacade {
  shielded: MockShieldedWallet;
  unshielded: MockUnshieldedWallet;
  dust: MockDustWallet;

  constructor() {
    const shielded = new MockShieldedWallet();
    const unshielded = new MockUnshieldedWallet();
    const dust = new MockDustWallet();

    const submissionService = {
      submitTransaction: vi.fn(),
      close: vi.fn(),
    } as unknown as SubmissionService<ledger.FinalizedTransaction>;

    const pendingTransactionsService = {
      addPendingTransaction: vi.fn(),
      state: vi.fn(() => new rx.Subject()),
      start: vi.fn(),
      stop: vi.fn(),
      clear: vi.fn(),
    } as unknown as PendingTransactionsService<ledger.FinalizedTransaction>;

    const provingService = {
      prove: vi.fn(),
    } as unknown as ProvingService<UnboundTransaction>;

    super(shielded, unshielded, dust, submissionService, pendingTransactionsService, provingService);
    this.shielded = shielded;
    this.unshielded = unshielded;
    this.dust = dust;
  }
}

export function prepareMockFacade(): WalletFacade {
  return new MockWalletFacade();
}

export interface MockBalancesConfig {
  shielded?: Record<string, bigint>;
  unshielded?: Record<string, bigint>;
  dust?: { cap: bigint; balance: bigint };
}

export function prepareMockFacadeWithBalances(config: MockBalancesConfig): WalletFacade {
  const facade = new MockWalletFacade();

  if (config.shielded !== undefined) {
    const shieldedState: Partial<ShieldedWalletState> = {
      address: testShieldedAddress,
      balances: config.shielded,
    };
    facade.shielded.waitForSyncedState = vi.fn(() => Promise.resolve(shieldedState as ShieldedWalletState));
  }

  if (config.unshielded !== undefined) {
    const unshieldedState: Partial<UnshieldedWalletState> = {
      address: testUnshieldedAddress,
      balances: config.unshielded,
    };
    facade.unshielded.waitForSyncedState = vi.fn(() => Promise.resolve(unshieldedState as UnshieldedWalletState));
  }

  if (config.dust !== undefined) {
    const dustState: Partial<DustWalletState> = {
      address: testDustAddress,
      balance: () => config.dust!.balance,
      availableCoinsWithFullInfo: () => [],
    };
    facade.dust.waitForSyncedState = vi.fn(() => Promise.resolve(dustState as DustWalletState));
  }

  return facade;
}

class MockUnshieldedKeystore implements UnshieldedKeystore {
  getSecretKey = vi.fn(() => Buffer.from('mock-secret-key'));
  getBech32Address = vi.fn(() => ({
    asString: () => 'unshielded1mockaddress',
  })) as unknown as UnshieldedKeystore['getBech32Address'];
  getPublicKey = vi.fn(() => 'mock-public-key' as unknown as ledger.SignatureVerifyingKey);
  getAddress = vi.fn(() => 'mock-address' as ledger.UserAddress);
  signData = vi.fn(() => 'mock-signature' as unknown as ledger.Signature);
}

export function prepareMockUnshieldedKeystore(): UnshieldedKeystore {
  return new MockUnshieldedKeystore();
}
