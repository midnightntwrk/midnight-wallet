/**
 * A test fixture that ensures that certain properties between the legacy Scala Wallet are preserved
 * by the new TypeScript implementation.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';
import * as wallet from '../index';

describe('TypeScript Wallet', () => {
  it('should export Scala "WalletBuilder"', () => {
    expect(wallet).toBeDefined();
    expect(wallet.WalletBuilder).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(wallet.WalletBuilder.build).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(wallet.WalletBuilder.build).toBeInstanceOf(Function);
  });
});
