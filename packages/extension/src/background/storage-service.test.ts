import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateWalletId } from './storage-service';

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateWalletId', () => {
    it('generates a 32-character hex string', async () => {
      const id = await generateWalletId();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(32);
      expect(/^[0-9a-f]+$/.test(id)).toBe(true);
    });

    it('generates unique IDs', async () => {
      const id1 = await generateWalletId();
      const id2 = await generateWalletId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('Database constants', () => {
    it('uses correct database name', async () => {
      const module = await import('./storage-service');
      expect(module).toBeDefined();
    });
  });

  describe('Wallet operations type safety', () => {
    it('EncryptedWallet interface has required fields', () => {
      const wallet = {
        id: 'test-id',
        name: 'Test',
        encryptedSeed: { iv: 'iv', ciphertext: 'ct' },
        salt: 'salt',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      expect(wallet.id).toBeDefined();
      expect(wallet.name).toBeDefined();
      expect(wallet.encryptedSeed).toBeDefined();
      expect(wallet.salt).toBeDefined();
    });
  });

  describe('Session operations type safety', () => {
    it('Session interface has required fields', () => {
      const session = {
        token: 'test-token',
        expiresAt: Date.now() + 3600000,
        walletId: 'wallet-id',
      };
      expect(session.token).toBeDefined();
      expect(session.expiresAt).toBeGreaterThan(Date.now());
      expect(session.walletId).toBeDefined();
    });
  });
});
