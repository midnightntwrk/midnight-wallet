/** Intent test suite. Tests makeIntent method for creating swap/intent transactions. */

import { describe, expect, it, vi } from 'vitest';
import type { TransactionTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/** Run intent tests against the provided context. */
export const runIntentTests = (context: TransactionTestContext): void => {
  describe('API contract', () => {
    it('should have makeIntent method on ConnectedAPI', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        expect(typeof api.makeIntent).toBe('function');
      } finally {
        await disconnect();
      }
    });
  });
};
