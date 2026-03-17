/**
 * Data signing test suite.
 * Tests signData with various encodings.
 */

import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../errors.js';
import type { ConnectedAPITestContext } from '../context.js';

/**
 * Run data signing tests against the provided context.
 */
export const runSigningTests = (context: ConnectedAPITestContext): void => {
  describe('encoding: hex', () => {
    it('should sign hex-encoded data', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const hexData = 'deadbeef';
        const result = await api.signData(hexData, { encoding: 'hex', keyType: 'unshielded' });

        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('signature');
        expect(result).toHaveProperty('verifyingKey');
      } finally {
        await disconnect();
      }
    });

    it('should include prefix in signed data', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const hexData = 'deadbeef';
        const result = await api.signData(hexData, { encoding: 'hex', keyType: 'unshielded' });

        // The prefix format is: midnight_signed_message:<size>:
        // For 'deadbeef' (4 bytes), prefix should be 'midnight_signed_message:4:'
        expect(result.data).toMatch(/^midnight_signed_message:\d+:/);
      } finally {
        await disconnect();
      }
    });

    it('should reject invalid hex', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.signData('not-valid-hex!', { encoding: 'hex', keyType: 'unshielded' })).rejects.toMatchObject({
          code: ErrorCodes.InvalidRequest,
          message: expect.stringContaining('hex'),
        });
      } finally {
        await disconnect();
      }
    });

    it('should accept empty hex string', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const result = await api.signData('', { encoding: 'hex', keyType: 'unshielded' });
        expect(result.data).toMatch(/^midnight_signed_message:0:/);
      } finally {
        await disconnect();
      }
    });
  });

  describe('encoding: base64', () => {
    it('should sign base64-encoded data', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const base64Data = Buffer.from('hello world').toString('base64');
        const result = await api.signData(base64Data, { encoding: 'base64', keyType: 'unshielded' });

        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('signature');
        expect(result).toHaveProperty('verifyingKey');
      } finally {
        await disconnect();
      }
    });

    it('should include correct size in prefix for base64', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const originalData = 'hello world'; // 11 bytes
        const base64Data = Buffer.from(originalData).toString('base64');
        const result = await api.signData(base64Data, { encoding: 'base64', keyType: 'unshielded' });

        expect(result.data).toMatch(/^midnight_signed_message:11:/);
      } finally {
        await disconnect();
      }
    });

    it('should reject invalid base64', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(
          api.signData('!!!invalid!!!', { encoding: 'base64', keyType: 'unshielded' }),
        ).rejects.toMatchObject({
          code: ErrorCodes.InvalidRequest,
          message: expect.stringContaining('base64'),
        });
      } finally {
        await disconnect();
      }
    });
  });

  describe('encoding: text', () => {
    it('should sign text data as UTF-8', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const textData = 'hello world';
        const result = await api.signData(textData, { encoding: 'text', keyType: 'unshielded' });

        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('signature');
        expect(result).toHaveProperty('verifyingKey');
      } finally {
        await disconnect();
      }
    });

    it('should include correct size in prefix for text', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const textData = 'hello'; // 5 bytes in UTF-8
        const result = await api.signData(textData, { encoding: 'text', keyType: 'unshielded' });

        expect(result.data).toMatch(/^midnight_signed_message:5:/);
      } finally {
        await disconnect();
      }
    });

    it('should handle UTF-8 multi-byte characters', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const textData = '你好'; // 6 bytes in UTF-8 (3 bytes per character)
        const result = await api.signData(textData, { encoding: 'text', keyType: 'unshielded' });

        expect(result.data).toMatch(/^midnight_signed_message:6:/);
      } finally {
        await disconnect();
      }
    });

    it('should handle empty text', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const result = await api.signData('', { encoding: 'text', keyType: 'unshielded' });
        expect(result.data).toMatch(/^midnight_signed_message:0:/);
      } finally {
        await disconnect();
      }
    });
  });

  describe('signature verification', () => {
    it('should return a valid hex signature', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const result = await api.signData('test', { encoding: 'text', keyType: 'unshielded' });

        // Signature should be hex-encoded
        expect(result.signature).toMatch(/^[0-9a-f]+$/i);
      } finally {
        await disconnect();
      }
    });

    it('should return a valid hex verifying key', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const result = await api.signData('test', { encoding: 'text', keyType: 'unshielded' });

        // Verifying key should be hex-encoded
        expect(result.verifyingKey).toMatch(/^[0-9a-f]+$/i);
      } finally {
        await disconnect();
      }
    });

    it('should return consistent verifying key across calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const result1 = await api.signData('test1', { encoding: 'text', keyType: 'unshielded' });
        const result2 = await api.signData('test2', { encoding: 'text', keyType: 'unshielded' });

        expect(result1.verifyingKey).toBe(result2.verifyingKey);
      } finally {
        await disconnect();
      }
    });
  });

  describe('disconnection', () => {
    it('should reject when disconnected', async () => {
      const { api, disconnect } = await context.createConnectedAPI();
      await disconnect();

      await expect(api.signData('test', { encoding: 'text', keyType: 'unshielded' })).rejects.toMatchObject({
        code: ErrorCodes.Disconnected,
      });
    });
  });
};
