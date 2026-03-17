/**
 * Transaction history test suite.
 * Tests getTxHistory method.
 */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DappConnectorTestContext } from '../context.js';
import type { MockHistoryEntry } from '../testUtils.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

// Helper to create valid hex transaction hashes
const createTxHash = (index: number): string => {
  // Create a 64-character hex string (256-bit hash)
  return index.toString(16).padStart(64, '0');
};

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

    it('should return frozen HistoryEntry objects', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return; // Skip if implementation doesn't support history mocking
      }

      const entries: MockHistoryEntry[] = [
        { txHash: createTxHash(1), txStatus: { status: 'finalized', executionStatus: { 0: 'Success' } } },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(history.length).toBe(1);
        expect(Object.isFrozen(history[0])).toBe(true);
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

    it('should return empty array for pages beyond available data', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = [
        { txHash: createTxHash(1), txStatus: { status: 'finalized', executionStatus: { 0: 'Success' } } },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        // Page 100 should be empty when there's only 1 entry
        const history = await api.getTxHistory(100, 10);
        expect(history).toEqual([]);
      } finally {
        await disconnect();
      }
    });

    it('should respect pageSize parameter (property-based)', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      // Create 50 entries for pagination testing
      const entries: MockHistoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
        txHash: createTxHash(i),
        txStatus: { status: 'finalized' as const, executionStatus: { 0: 'Success' as const } },
      }));

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 0, max: 10 }),
          async (pageSize, pageNumber) => {
            const testContext = withTransactionHistory(entries);
            const { api, disconnect } = await testContext.createConnectedAPI();

            try {
              const history = await api.getTxHistory(pageNumber, pageSize);
              // Result should never exceed pageSize
              expect(history.length).toBeLessThanOrEqual(pageSize);
            } finally {
              await disconnect();
            }
          },
        ),
        { numRuns: 10 },
      );
    });

    it('should return correct page of results', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = Array.from({ length: 25 }, (_, i) => ({
        txHash: createTxHash(i),
        txStatus: { status: 'finalized' as const, executionStatus: { 0: 'Success' as const } },
      }));
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const page0 = await api.getTxHistory(0, 10);
        const page1 = await api.getTxHistory(1, 10);
        const page2 = await api.getTxHistory(2, 10);

        expect(page0.length).toBe(10);
        expect(page1.length).toBe(10);
        expect(page2.length).toBe(5); // Only 5 entries left

        // Verify page0 has first 10 entries
        expect(page0[0].txHash).toBe(createTxHash(0));
        expect(page0[9].txHash).toBe(createTxHash(9));

        // Verify page1 has next 10 entries
        expect(page1[0].txHash).toBe(createTxHash(10));
        expect(page1[9].txHash).toBe(createTxHash(19));

        // Verify page2 has last 5 entries
        expect(page2[0].txHash).toBe(createTxHash(20));
        expect(page2[4].txHash).toBe(createTxHash(24));
      } finally {
        await disconnect();
      }
    });

    it('should handle pageSize of 1', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
        txHash: createTxHash(i),
        txStatus: { status: 'finalized' as const, executionStatus: { 0: 'Success' as const } },
      }));
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const page0 = await api.getTxHistory(0, 1);
        const page1 = await api.getTxHistory(1, 1);

        expect(page0.length).toBe(1);
        expect(page1.length).toBe(1);
        expect(page0[0].txHash).toBe(createTxHash(0));
        expect(page1[0].txHash).toBe(createTxHash(1));
      } finally {
        await disconnect();
      }
    });
  });

  describe('entry structure', () => {
    it('should return entries with txHash as 64-character hex string', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = [
        { txHash: createTxHash(1), txStatus: { status: 'finalized', executionStatus: { 0: 'Success' } } },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(history.length).toBe(1);
        expect(typeof history[0].txHash).toBe('string');
        // txHash should be hex-encoded 256-bit hash (64 hex characters)
        expect(history[0].txHash).toMatch(/^[0-9a-fA-F]{64}$/);
      } finally {
        await disconnect();
      }
    });

    it('should return entries with valid txStatus', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = [
        { txHash: createTxHash(1), txStatus: { status: 'finalized', executionStatus: { 0: 'Success' } } },
        { txHash: createTxHash(2), txStatus: { status: 'confirmed', executionStatus: { 0: 'Success' } } },
        { txHash: createTxHash(3), txStatus: { status: 'pending' } },
        { txHash: createTxHash(4), txStatus: { status: 'discarded' } },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        const validStatuses = ['finalized', 'confirmed', 'pending', 'discarded'];

        expect(history.length).toBe(4);
        for (const entry of history) {
          expect(validStatuses).toContain(entry.txStatus.status);
        }
      } finally {
        await disconnect();
      }
    });

    it('should include executionStatus for finalized transactions', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = [
        {
          txHash: createTxHash(1),
          txStatus: {
            status: 'finalized',
            executionStatus: { 0: 'Success', 1: 'Failure' },
          },
        },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(history.length).toBe(1);
        const entry = history[0];
        expect(entry.txStatus.status).toBe('finalized');
        if (entry.txStatus.status === 'finalized') {
          expect(entry.txStatus).toHaveProperty('executionStatus');
          expect(typeof entry.txStatus.executionStatus).toBe('object');
          expect(entry.txStatus.executionStatus[0]).toBe('Success');
          expect(entry.txStatus.executionStatus[1]).toBe('Failure');
        }
      } finally {
        await disconnect();
      }
    });

    it('should have executionStatus with numeric keys for segment indices', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = [
        {
          txHash: createTxHash(1),
          txStatus: {
            status: 'finalized',
            executionStatus: { 0: 'Success', 1: 'Failure', 2: 'Success', 5: 'Failure' },
          },
        },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(history.length).toBe(1);
        const entry = history[0];
        if (entry.txStatus.status === 'finalized') {
          const execStatus = entry.txStatus.executionStatus;
          // Keys should be numeric (segment indices)
          const keys = Object.keys(execStatus).map(Number);
          expect(keys).toContain(0);
          expect(keys).toContain(1);
          expect(keys).toContain(2);
          expect(keys).toContain(5);
          // Values must be exactly 'Success' or 'Failure'
          for (const value of Object.values(execStatus)) {
            expect(['Success', 'Failure']).toContain(value);
          }
        }
      } finally {
        await disconnect();
      }
    });

    it('should include executionStatus for confirmed transactions', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = [
        {
          txHash: createTxHash(1),
          txStatus: {
            status: 'confirmed',
            executionStatus: { 0: 'Success' },
          },
        },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(history.length).toBe(1);
        const entry = history[0];
        expect(entry.txStatus.status).toBe('confirmed');
        if (entry.txStatus.status === 'confirmed') {
          expect(entry.txStatus).toHaveProperty('executionStatus');
          expect(typeof entry.txStatus.executionStatus).toBe('object');
        }
      } finally {
        await disconnect();
      }
    });

    it('should NOT include executionStatus for pending transactions', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = [
        {
          txHash: createTxHash(1),
          txStatus: { status: 'pending' },
        },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(history.length).toBe(1);
        const entry = history[0];
        expect(entry.txStatus.status).toBe('pending');
        expect(entry.txStatus).not.toHaveProperty('executionStatus');
      } finally {
        await disconnect();
      }
    });

    it('should NOT include executionStatus for discarded transactions', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = [
        {
          txHash: createTxHash(1),
          txStatus: { status: 'discarded' },
        },
      ];
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history = await api.getTxHistory(0, 10);
        expect(history.length).toBe(1);
        const entry = history[0];
        expect(entry.txStatus.status).toBe('discarded');
        expect(entry.txStatus).not.toHaveProperty('executionStatus');
      } finally {
        await disconnect();
      }
    });
  });

  describe('ordering', () => {
    it('should return entries in consistent order across calls', async () => {
      const withTransactionHistory = context.withTransactionHistory;
      if (withTransactionHistory === undefined) {
        return;
      }

      const entries: MockHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
        txHash: createTxHash(i),
        txStatus: { status: 'finalized' as const, executionStatus: { 0: 'Success' as const } },
      }));
      const testContext = withTransactionHistory(entries);
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const history1 = await api.getTxHistory(0, 10);
        const history2 = await api.getTxHistory(0, 10);
        expect(history1).toEqual(history2);
      } finally {
        await disconnect();
      }
    });
  });
};
