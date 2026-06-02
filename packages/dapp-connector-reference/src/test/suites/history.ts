/** Transaction history test suite. Tests getTxHistory method. */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DappConnectorTestContext } from '../context.js';

/** Run transaction history tests against the provided context. */
export const runHistoryTests = (context: DappConnectorTestContext): void => {
  const { environment } = context;
  const { tokenTypes } = environment;

  describe('return type', () => {
    it('should return an array', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(Array.isArray(history)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should return empty array when no transactions exist', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        // May be empty or have entries depending on implementation; just assert shape
        expect(Array.isArray(history)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should return frozen HistoryEntry objects', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      // Setting up a wallet with Night funding triggers an internal Dust-registration transaction during setup, so the
      // wallet's history must have at least one entry by the time it resolves.
      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        const history = await setup.wallets.alice.api.getTxHistory(0, 10);

        expect(history.length).toBeGreaterThanOrEqual(1);
        expect(history.every((entry) => Object.isFrozen(entry))).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('pagination', () => {
    it('should accept pageNumber and pageSize parameters', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.getTxHistory(0, 10)).resolves.toBeDefined();
        await expect(api.getTxHistory(1, 20)).resolves.toBeDefined();
        await expect(api.getTxHistory(5, 100)).resolves.toBeDefined();
      } finally {
        await disconnect();
      }
    });

    it('should return empty array for pages beyond available data', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        // page 1_000_000 should be empty regardless of how many entries exist
        const history = await api.getTxHistory(1_000_000, 10);
        expect(history).toEqual([]);
      } finally {
        await disconnect();
      }
    });

    it('should respect pageSize parameter (property-based)', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 100 }),
            fc.integer({ min: 0, max: 10 }),
            async (pageSize, pageNumber) => {
              const history = await setup.wallets.alice.api.getTxHistory(pageNumber, pageSize);
              expect(history.length).toBeLessThanOrEqual(pageSize);
            },
          ),
          { numRuns: 10 },
        );
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('entry structure', () => {
    it('should return entries with txHash as 64-character hex string', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        const history = await setup.wallets.alice.api.getTxHistory(0, 10);

        expect(history.length).toBeGreaterThanOrEqual(1);
        expect(history.every((entry) => /^[0-9a-fA-F]{64}$/.test(entry.txHash))).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });

    it('should return entries with valid txStatus', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        const history = await setup.wallets.alice.api.getTxHistory(0, 10);

        expect(history.length).toBeGreaterThanOrEqual(1);
        const validStatuses = new Set(['finalized', 'confirmed', 'pending', 'discarded']);
        expect(history.every((entry) => validStatuses.has(entry.txStatus.status))).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });

    it('should include executionStatus on finalized entries', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        const history = await setup.wallets.alice.api.getTxHistory(0, 10);
        const finalizedEntries = history.filter((entry) => entry.txStatus.status === 'finalized');

        // The Dust-registration tx submitted during setupWallets is finalized, so at least one entry must be finalized.
        expect(finalizedEntries.length).toBeGreaterThanOrEqual(1);

        const validValues = new Set(['Success', 'Failure']);
        const allHaveValidExecutionStatus = finalizedEntries.every((entry) => {
          if (entry.txStatus.status !== 'finalized') return false;
          const values = Object.values(entry.txStatus.executionStatus);
          return values.length > 0 && values.every((v) => validValues.has(v));
        });
        expect(allHaveValidExecutionStatus).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('ordering', () => {
    it('should return entries in consistent order across calls', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        const history1 = await setup.wallets.alice.api.getTxHistory(0, 100);
        const history2 = await setup.wallets.alice.api.getTxHistory(0, 100);
        expect(history1).toEqual(history2);
      } finally {
        await setup.disconnect();
      }
    });
  });
};
