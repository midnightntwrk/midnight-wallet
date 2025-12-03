import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@scure/bip39', () => ({
  generateMnemonic: vi.fn().mockReturnValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'),
  validateMnemonic: vi.fn().mockReturnValue(true),
  mnemonicToSeed: vi.fn().mockResolvedValue(new Uint8Array(64).fill(1)),
}));

vi.mock('./crypto-service', () => ({
  encryptSeed: vi.fn().mockResolvedValue({
    encryptedSeed: { iv: 'test-iv', ciphertext: 'test-ciphertext' },
    salt: 'test-salt',
  }),
}));

vi.mock('./storage-service', () => ({
  saveWallet: vi.fn().mockResolvedValue(undefined),
  getWallet: vi.fn().mockResolvedValue({
    id: 'test-wallet-id',
    name: 'Test Wallet',
    encryptedSeed: { iv: 'test-iv', ciphertext: 'test-ciphertext' },
    salt: 'test-salt',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  generateWalletId: vi.fn().mockResolvedValue('generated-wallet-id'),
}));

vi.mock('@midnight-ntwrk/ledger-v6', () => ({
  ZswapSecretKeys: {
    fromSeed: vi.fn().mockReturnValue({
      coinPublicKey: '0'.repeat(64),
      encryptionPublicKey: '0'.repeat(64),
    }),
  },
}));

vi.mock('@midnight-ntwrk/wallet-sdk-address-format', () => ({
  ShieldedAddress: class MockShieldedAddress {
    static codec = {
      encode: vi.fn().mockReturnValue({ asString: () => 'mn_test_address_mock' }),
    };
  },
  ShieldedCoinPublicKey: class MockCoinPublicKey {
    constructor(_buffer: Uint8Array) {}
  },
  ShieldedEncryptionPublicKey: class MockEncryptionPublicKey {
    constructor(_buffer: Uint8Array) {}
  },
}));

describe('WalletService', () => {
  let walletService: typeof import('./wallet-service');
  let mockBip39: typeof import('@scure/bip39');
  let mockStorageService: typeof import('./storage-service');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockBip39 = await import('@scure/bip39');
    mockStorageService = await import('./storage-service');
    walletService = await import('./wallet-service');
  });

  describe('generateMnemonic', () => {
    it('returns an array of 24 words', () => {
      const mnemonic = walletService.generateMnemonic();
      expect(Array.isArray(mnemonic)).toBe(true);
      expect(mnemonic.length).toBe(24);
    });

    it('calls bip39 generateMnemonic with english wordlist', () => {
      walletService.generateMnemonic();
      expect(mockBip39.generateMnemonic).toHaveBeenCalled();
    });
  });

  describe('validateMnemonic', () => {
    it('returns true for valid mnemonic', () => {
      const validWords = new Array(24).fill('abandon');
      const result = walletService.validateMnemonic(validWords);
      expect(result).toBe(true);
    });

    it('returns false for invalid mnemonic', () => {
      vi.mocked(mockBip39.validateMnemonic).mockReturnValueOnce(false);
      const result = walletService.validateMnemonic(['invalid', 'words']);
      expect(result).toBe(false);
    });

    it('joins words with space before validation', () => {
      const words = ['word1', 'word2', 'word3'];
      walletService.validateMnemonic(words);
      expect(mockBip39.validateMnemonic).toHaveBeenCalledWith('word1 word2 word3', expect.anything());
    });
  });

  describe('mnemonicToSeed', () => {
    it('converts mnemonic to seed bytes', async () => {
      const words = new Array(24).fill('abandon');
      const seed = await walletService.mnemonicToSeed(words);
      expect(seed).toBeInstanceOf(Uint8Array);
    });
  });

  describe('mnemonicToSeedHex', () => {
    it('converts mnemonic to hex string', async () => {
      const words = new Array(24).fill('abandon');
      const seedHex = await walletService.mnemonicToSeedHex(words);
      expect(typeof seedHex).toBe('string');
      expect(/^[0-9a-f]+$/.test(seedHex)).toBe(true);
    });

    it('returns first 32 bytes as hex', async () => {
      const words = new Array(24).fill('abandon');
      const seedHex = await walletService.mnemonicToSeedHex(words);
      expect(seedHex.length).toBe(64);
    });
  });

  describe('createWallet', () => {
    it('creates wallet with generated mnemonic', async () => {
      const result = await walletService.createWallet('password', 'My Wallet');
      expect(result.id).toBe('generated-wallet-id');
      expect(result.mnemonic).toHaveLength(24);
    });

    it('saves wallet to storage', async () => {
      await walletService.createWallet('password', 'My Wallet');
      expect(mockStorageService.saveWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'generated-wallet-id',
          name: 'My Wallet',
          encryptedSeed: expect.any(Object),
          salt: expect.any(String),
        })
      );
    });

    it('encrypts seed phrase with password', async () => {
      const mockEncryptSeed = await import('./crypto-service');
      await walletService.createWallet('secure-password', 'My Wallet');
      expect(vi.mocked(mockEncryptSeed.encryptSeed)).toHaveBeenCalledWith(
        expect.any(String),
        'secure-password'
      );
    });
  });

  describe('importWallet', () => {
    it('imports wallet with valid mnemonic', async () => {
      const mnemonic = new Array(24).fill('abandon');
      const id = await walletService.importWallet(mnemonic, 'password', 'Imported Wallet');
      expect(id).toBe('generated-wallet-id');
    });

    it('throws error for invalid mnemonic', async () => {
      vi.mocked(mockBip39.validateMnemonic).mockReturnValueOnce(false);
      const invalidMnemonic = ['invalid', 'words'];
      await expect(
        walletService.importWallet(invalidMnemonic, 'password', 'Wallet')
      ).rejects.toThrow('Invalid mnemonic phrase');
    });

    it('saves imported wallet to storage', async () => {
      const mnemonic = new Array(24).fill('abandon');
      await walletService.importWallet(mnemonic, 'password', 'Imported');
      expect(mockStorageService.saveWallet).toHaveBeenCalled();
    });
  });

  describe('deriveAccount', () => {
    it('derives address from seed phrase', async () => {
      const seedPhrase = new Array(24).fill('abandon').join(' ');
      const account = await walletService.deriveAccount(seedPhrase, 0);
      expect(account).toHaveProperty('address');
      expect(account).toHaveProperty('coinPublicKey');
      expect(account).toHaveProperty('encryptionPublicKey');
    });

    it('returns correctly formatted address', async () => {
      const seedPhrase = new Array(24).fill('abandon').join(' ');
      const account = await walletService.deriveAccount(seedPhrase, 0);
      expect(typeof account.address).toBe('string');
    });
  });

  describe('deriveMultipleAccounts', () => {
    it('derives specified number of accounts', async () => {
      const seedPhrase = new Array(24).fill('abandon').join(' ');
      const accounts = await walletService.deriveMultipleAccounts(seedPhrase, 3);
      expect(accounts).toHaveLength(3);
    });

    it('includes index for each account', async () => {
      const seedPhrase = new Array(24).fill('abandon').join(' ');
      const accounts = await walletService.deriveMultipleAccounts(seedPhrase, 2);
      expect(accounts[0].index).toBe(0);
      expect(accounts[1].index).toBe(1);
    });
  });

  describe('exportSeed', () => {
    it('returns seed phrase as array of words', async () => {
      const seedPhrase = new Array(24).fill('abandon').join(' ');
      const words = await walletService.exportSeed('test-wallet-id', seedPhrase);
      expect(Array.isArray(words)).toBe(true);
      expect(words).toHaveLength(24);
    });

    it('throws error for non-existent wallet', async () => {
      vi.mocked(mockStorageService.getWallet).mockResolvedValueOnce(null);
      await expect(
        walletService.exportSeed('non-existent', 'seed phrase')
      ).rejects.toThrow('Wallet not found');
    });
  });

  describe('security properties', () => {
    it('uses 256-bit entropy for mnemonic generation', () => {
      walletService.generateMnemonic();
      expect(mockBip39.generateMnemonic).toHaveBeenCalledWith(expect.anything(), 256);
    });

    it('never stores plaintext seed', async () => {
      await walletService.createWallet('password', 'Wallet');
      const saveCall = vi.mocked(mockStorageService.saveWallet).mock.calls[0][0];
      expect(saveCall.encryptedSeed).toBeDefined();
      expect(saveCall).not.toHaveProperty('seed');
      expect(saveCall).not.toHaveProperty('mnemonic');
    });
  });
});
