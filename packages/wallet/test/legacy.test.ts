/**
 * A test fixture that ensures that certain properties between the legacy Scala Wallet are preserved
 * by the new TypeScript implementation.
 *
 * @module
 */

describe('TypeScript Wallet', () => {
  it('should export Scala "WalletBuilder"', async () => {
    const wallet = await import('@midnight-ntwrk/wallet-ts');

    expect(wallet).toBeDefined();
    expect(wallet.WalletBuilder).toBeDefined();
  });
});
