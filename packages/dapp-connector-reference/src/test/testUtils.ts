import { expect, vi } from 'vitest';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedWalletAPI, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { DustWalletAPI, DustWalletState } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import type { ShieldedWalletAPI, ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import type { SubmissionService, PendingTransactionsService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import type { ProvingService, UnboundTransaction } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type * as ledger from '@midnight-ntwrk/ledger-v7';
import * as rx from 'rxjs';

export const expectMatchObjectTyped = <T>(actual: T, expected: Partial<T>): void => {
  expect(actual).toMatchObject(expected);
};

class MockShieldedWallet implements ShieldedWalletAPI {
  state: rx.Subject<ShieldedWalletState> = new rx.Subject();
  start = vi.fn();
  balanceTransaction = vi.fn();
  transferTransaction = vi.fn();
  revertTransaction = vi.fn();
  initSwap = vi.fn();
  serializeState = vi.fn();
  waitForSyncedState = vi.fn();
  getAddress = vi.fn();
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
  waitForSyncedState = vi.fn();
  getAddress = vi.fn();
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
  waitForSyncedState = vi.fn();
  getAddress = vi.fn();
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
