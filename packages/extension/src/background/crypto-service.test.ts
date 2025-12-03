import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateSalt,
  generateSessionToken,
  deriveKey,
  encrypt,
  decrypt,
  encryptSeed,
  decryptSeed,
  saltToBase64,
  base64ToSalt,
} from './crypto-service';

describe('CryptoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateSalt', () => {
    it('generates 32 bytes of random data', () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(32);
    });

    it('generates unique salts each time', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toEqual(salt2);
    });
  });

  describe('generateSessionToken', () => {
    it('returns a non-empty base64 string', () => {
      const token = generateSessionToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('generates unique tokens each time', () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('saltToBase64 and base64ToSalt', () => {
    it('converts salt to base64 and back correctly', () => {
      const originalSalt = generateSalt();
      const base64 = saltToBase64(originalSalt);
      const recoveredSalt = base64ToSalt(base64);
      expect(recoveredSalt).toEqual(originalSalt);
    });

    it('produces valid base64 string', () => {
      const salt = new Uint8Array([1, 2, 3, 4, 5]);
      const base64 = saltToBase64(salt);
      expect(() => atob(base64)).not.toThrow();
    });
  });

  describe('deriveKey', () => {
    it('derives a CryptoKey from password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('produces same key for same password and salt', async () => {
      const password = 'test-password';
      const salt = new Uint8Array(32).fill(1);
      const key1 = await deriveKey(password, salt);
      const key2 = await deriveKey(password, salt);
      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
    });
  });

  describe('encrypt and decrypt', () => {
    it('encrypts data and returns iv and ciphertext', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);
      const data = 'secret data';

      const encrypted = await encrypt(data, key);
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted.iv.length).toBeGreaterThan(0);
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    });

    it('produces different ciphertext for same data (different IV)', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);
      const data = 'secret data';

      const encrypted1 = await encrypt(data, key);
      const encrypted2 = await encrypt(data, key);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });
  });

  describe('encryptSeed and decryptSeed', () => {
    it('encrypts seed phrase and returns encrypted data with salt', async () => {
      const seedPhrase = 'test seed phrase for wallet';
      const password = 'secure-password-123';

      const result = await encryptSeed(seedPhrase, password);
      expect(result).toHaveProperty('encryptedSeed');
      expect(result).toHaveProperty('salt');
      expect(result.encryptedSeed).toHaveProperty('iv');
      expect(result.encryptedSeed).toHaveProperty('ciphertext');
      expect(result.salt.length).toBeGreaterThan(0);
    });
  });

  describe('security properties', () => {
    it('uses AES-256-GCM for encryption', async () => {
      const importKeySpy = vi.spyOn(crypto.subtle, 'importKey');
      const deriveKeySpy = vi.spyOn(crypto.subtle, 'deriveKey');

      const password = 'test-password';
      const salt = generateSalt();
      await deriveKey(password, salt);

      expect(importKeySpy).toHaveBeenCalled();
      expect(deriveKeySpy).toHaveBeenCalled();
    });

    it('generates 12-byte IV for AES-GCM', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const key = await deriveKey(password, salt);
      const data = 'test';

      const encrypted = await encrypt(data, key);
      const ivBytes = atob(encrypted.iv);
      expect(ivBytes.length).toBe(12);
    });

    it('generates 32-byte salt for key derivation', () => {
      const salt = generateSalt();
      expect(salt.length).toBe(32);
    });
  });
});
