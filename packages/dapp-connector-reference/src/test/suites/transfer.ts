/** Transfer test suite. Tests makeTransfer method for creating balanced transfer transactions. */

import { describe, expect, it, vi } from 'vitest';
import type { TransactionTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/** Run transfer tests against the provided context. */
export const runTransferTests = (context: TransactionTestContext): void => {
  describe('API contract', () => {
    it('should have makeTransfer method on ConnectedAPI', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        expect(typeof api.makeTransfer).toBe('function');
      } finally {
        await disconnect();
      }
    });
  });
};
