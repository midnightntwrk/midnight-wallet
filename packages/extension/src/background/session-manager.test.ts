import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  MAX_UNLOCK_ATTEMPTS,
  UNLOCK_COOLDOWN_MS,
} from './types';

vi.mock('./crypto-service', () => ({
  decryptSeed: vi.fn().mockResolvedValue('test seed phrase'),
  generateSessionToken: vi.fn().mockReturnValue('test-session-token'),
}));

vi.mock('./storage-service', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
  getWallet: vi.fn().mockResolvedValue({
    id: 'test-wallet-id',
    name: 'Test Wallet',
    encryptedSeed: { iv: 'test-iv', ciphertext: 'test-ciphertext' },
    salt: 'test-salt',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
}));

describe('SessionManager', () => {
  let sessionManager: typeof import('./session-manager');
  let mockCryptoService: typeof import('./crypto-service');
  let mockStorageService: typeof import('./storage-service');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();

    mockCryptoService = await import('./crypto-service');
    mockStorageService = await import('./storage-service');
    sessionManager = await import('./session-manager');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isUnlocked', () => {
    it('returns false when no session exists', () => {
      expect(sessionManager.isUnlocked()).toBe(false);
    });

    it('returns true after successful unlock', async () => {
      const result = await sessionManager.unlock('correct-password', 'test-wallet-id');
      expect(result.success).toBe(true);
      expect(sessionManager.isUnlocked()).toBe(true);
    });
  });

  describe('getState', () => {
    it('returns locked state when no session', () => {
      const state = sessionManager.getState();
      expect(state.isLocked).toBe(true);
      expect(state.activeWalletId).toBeNull();
      expect(state.sessionToken).toBeNull();
    });

    it('returns unlocked state after successful unlock', async () => {
      await sessionManager.unlock('password', 'test-wallet-id');
      const state = sessionManager.getState();
      expect(state.isLocked).toBe(false);
      expect(state.activeWalletId).toBe('test-wallet-id');
      expect(state.sessionToken).toBe('test-session-token');
    });
  });

  describe('unlock', () => {
    it('unlocks wallet with correct password', async () => {
      const result = await sessionManager.unlock('correct-password', 'test-wallet-id');
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('fails with incorrect password', async () => {
      vi.mocked(mockCryptoService.decryptSeed).mockRejectedValueOnce(new Error('Decryption failed'));
      const result = await sessionManager.unlock('wrong-password', 'test-wallet-id');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid password');
    });

    it('fails when wallet not found', async () => {
      vi.mocked(mockStorageService.getWallet).mockResolvedValueOnce(null);
      const result = await sessionManager.unlock('password', 'non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Wallet not found');
    });

    it('saves session to storage on unlock', async () => {
      await sessionManager.unlock('password', 'test-wallet-id');
      expect(mockStorageService.saveSession).toHaveBeenCalled();
    });
  });

  describe('lock', () => {
    it('clears session state', async () => {
      await sessionManager.unlock('password', 'test-wallet-id');
      expect(sessionManager.isUnlocked()).toBe(true);

      await sessionManager.lock();
      expect(sessionManager.isUnlocked()).toBe(false);
    });

    it('clears session from storage', async () => {
      await sessionManager.lock();
      expect(mockStorageService.clearSession).toHaveBeenCalled();
    });

    it('clears decrypted seed from memory', async () => {
      await sessionManager.unlock('password', 'test-wallet-id');
      await sessionManager.lock();
      expect(sessionManager.getDecryptedSeed()).toBeNull();
    });
  });

  describe('getDecryptedSeed', () => {
    it('returns null when locked', () => {
      expect(sessionManager.getDecryptedSeed()).toBeNull();
    });

    it('returns seed when unlocked', async () => {
      await sessionManager.unlock('password', 'test-wallet-id');
      expect(sessionManager.getDecryptedSeed()).toBe('test seed phrase');
    });
  });

  describe('refreshSession', () => {
    it('extends session expiry', async () => {
      await sessionManager.unlock('password', 'test-wallet-id');
      const stateBefore = sessionManager.getState();

      vi.advanceTimersByTime(60000);
      sessionManager.refreshSession();

      expect(mockStorageService.saveSession).toHaveBeenCalled();
    });

    it('does nothing when not unlocked', () => {
      sessionManager.refreshSession();
      expect(mockStorageService.saveSession).not.toHaveBeenCalled();
    });
  });

  describe('setLockTimeout', () => {
    it('accepts valid timeout values', () => {
      sessionManager.setLockTimeout(30);
      expect(sessionManager.getLockTimeout()).toBe(30);
    });

    it('rejects timeout below 1 minute', () => {
      const original = sessionManager.getLockTimeout();
      sessionManager.setLockTimeout(0);
      expect(sessionManager.getLockTimeout()).toBe(original);
    });

    it('rejects timeout above 60 minutes', () => {
      const original = sessionManager.getLockTimeout();
      sessionManager.setLockTimeout(61);
      expect(sessionManager.getLockTimeout()).toBe(original);
    });
  });

  describe('isRateLimited', () => {
    it('returns false for first attempt', () => {
      expect(sessionManager.isRateLimited('test-wallet-id')).toBe(false);
    });

    it('returns true after max attempts', async () => {
      vi.mocked(mockCryptoService.decryptSeed).mockRejectedValue(new Error('Decryption failed'));

      for (let i = 0; i < MAX_UNLOCK_ATTEMPTS; i++) {
        await sessionManager.unlock('wrong', 'test-wallet-id');
      }

      expect(sessionManager.isRateLimited('test-wallet-id')).toBe(true);
    });

    it('resets after cooldown period', async () => {
      vi.mocked(mockCryptoService.decryptSeed).mockRejectedValue(new Error('Decryption failed'));

      for (let i = 0; i < MAX_UNLOCK_ATTEMPTS; i++) {
        await sessionManager.unlock('wrong', 'test-wallet-id');
      }

      expect(sessionManager.isRateLimited('test-wallet-id')).toBe(true);

      vi.advanceTimersByTime(UNLOCK_COOLDOWN_MS + 1);
      expect(sessionManager.isRateLimited('test-wallet-id')).toBe(false);
    });

    it('returns rate limit error when exceeded', async () => {
      vi.mocked(mockCryptoService.decryptSeed).mockRejectedValue(new Error('Decryption failed'));

      for (let i = 0; i < MAX_UNLOCK_ATTEMPTS; i++) {
        await sessionManager.unlock('wrong', 'test-wallet-id');
      }

      const result = await sessionManager.unlock('password', 'test-wallet-id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many unlock attempts');
    });
  });

  describe('auto-lock timer', () => {
    it('getLockTimeout returns current timeout value', () => {
      const timeout = sessionManager.getLockTimeout();
      expect(timeout).toBeGreaterThanOrEqual(1);
      expect(timeout).toBeLessThanOrEqual(60);
    });

    it('setLockTimeout updates timeout value within valid range', () => {
      sessionManager.setLockTimeout(25);
      expect(sessionManager.getLockTimeout()).toBe(25);
    });
  });

  describe('restoreSession', () => {
    it('restores valid session from storage', async () => {
      const validSession = {
        token: 'stored-token',
        expiresAt: Date.now() + 3600000,
        walletId: 'test-wallet-id',
      };
      vi.mocked(mockStorageService.getSession).mockResolvedValueOnce(validSession);

      await sessionManager.restoreSession();
      const state = sessionManager.getState();
      expect(state.sessionToken).toBe('stored-token');
    });

    it('clears expired session', async () => {
      const expiredSession = {
        token: 'expired-token',
        expiresAt: Date.now() - 1000,
        walletId: 'test-wallet-id',
      };
      vi.mocked(mockStorageService.getSession).mockResolvedValueOnce(expiredSession);

      await sessionManager.restoreSession();
      expect(vi.mocked(mockStorageService.clearSession)).toHaveBeenCalled();
    });

    it('handles no stored session', async () => {
      vi.mocked(mockStorageService.getSession).mockResolvedValueOnce(null);
      await sessionManager.restoreSession();
      expect(sessionManager.isUnlocked()).toBe(false);
    });
  });
});
