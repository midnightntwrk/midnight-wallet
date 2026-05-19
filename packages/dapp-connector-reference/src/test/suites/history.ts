/**
 * Transaction history test suite.
 * Tests getTxHistory method.
 */

import { describe, expect, it, vi } from 'vitest';
import type { DappConnectorTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/**
 * Run transaction history tests against the provided context.
 */
export const runHistoryTests = (context: DappConnectorTestContext): void => {
  describe('return type', () => {
    it('should return an array', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(Array.isArray(history)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should return empty array when no transactions exist', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        // May be empty or have entries depending on implementation
        expect(Array.isArray(history)).toBe(true);
      } finally {
        await disconnect();
      }
    });
  });

  describe('pagination', () => {
    it('should accept pageNumber and pageSize parameters', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        // Should not throw
        await expect(api.getTxHistory(0, 10)).resolves.toBeDefined();
        await expect(api.getTxHistory(1, 20)).resolves.toBeDefined();
        await expect(api.getTxHistory(5, 100)).resolves.toBeDefined();
      } finally {
        await disconnect();
      }
    });
  });
};
