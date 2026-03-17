/**
 * Hint usage test suite.
 * Tests hintUsage method (no-op in reference implementation).
 */

import { describe, expect, it } from 'vitest';
import type { ConnectedAPITestContext } from '../context.js';

/**
 * Run hint usage tests against the provided context.
 */
export const runHintUsageTests = (context: ConnectedAPITestContext): void => {
  describe('basic behavior', () => {
    it('should resolve without error for empty array', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.hintUsage([])).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });

    it('should resolve without error for single method', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.hintUsage(['getShieldedBalances'])).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });

    it('should resolve without error for multiple methods', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(
          api.hintUsage(['getShieldedBalances', 'getUnshieldedBalances', 'makeTransfer']),
        ).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });

    it('should accept all valid method names', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        // All WalletConnectedAPI methods
        const allMethods = [
          'getConfiguration',
          'getConnectionStatus',
          'getShieldedAddresses',
          'getUnshieldedAddress',
          'getDustAddress',
          'getShieldedBalances',
          'getUnshieldedBalances',
          'getDustBalance',
          'getTxHistory',
          'makeTransfer',
          'makeIntent',
          'balanceUnsealedTransaction',
          'balanceSealedTransaction',
          'submitTransaction',
          'signData',
          'getProvingProvider',
          'hintUsage',
        ] as const;

        await expect(api.hintUsage([...allMethods])).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });
  });

  describe('multiple calls', () => {
    it('should handle multiple sequential calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.hintUsage(['getShieldedBalances'])).resolves.toBeUndefined();
        await expect(api.hintUsage(['makeTransfer'])).resolves.toBeUndefined();
        await expect(api.hintUsage(['submitTransaction'])).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });

    it('should handle repeated method names in same call', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(
          api.hintUsage(['getShieldedBalances', 'getShieldedBalances', 'getShieldedBalances']),
        ).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });

    it('should handle concurrent calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const results = await Promise.all([
          api.hintUsage(['getShieldedBalances']),
          api.hintUsage(['makeTransfer']),
          api.hintUsage(['submitTransaction']),
        ]);

        expect(results).toEqual([undefined, undefined, undefined]);
      } finally {
        await disconnect();
      }
    });
  });

  describe('disconnection', () => {
    it('should still resolve when disconnected (reference behavior)', async () => {
      const { api, disconnect } = await context.createConnectedAPI();
      await disconnect();

      // hintUsage is allowed even when disconnected per spec
      // (it's a hint, not an actual operation)
      await expect(api.hintUsage(['getShieldedBalances'])).resolves.toBeUndefined();
    });
  });
};
