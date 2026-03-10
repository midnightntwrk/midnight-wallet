import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore, type MockHistoryEntry } from './testUtils.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

describe('Transaction History', () => {
  const defaultConfig: ConnectorConfiguration = {
    networkId: 'testnet',
    indexerUri: 'http://localhost:8080',
    indexerWsUri: 'ws://localhost:8080',
    substrateNodeUri: 'ws://localhost:9944',
  };

  const createConnectedAPI = async (historyEntries: MockHistoryEntry[] = []): Promise<ExtendedConnectedAPI> => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const facade = prepareMockFacade().withTransactionHistory(historyEntries);
    const keystore = prepareMockUnshieldedKeystore();
    const connector = new Connector(metadata, facade, keystore, defaultConfig);
    return connector.connect('testnet');
  };

  // Helper to create valid hex transaction hashes
  const createTxHash = (index: number): string => {
    // Create a 64-character hex string (256-bit hash)
    return index.toString(16).padStart(64, '0');
  };

  describe('getTxHistory', () => {
    describe('return type', () => {
      it('should return an array', async () => {
        const connectedAPI = await createConnectedAPI();

        const history = await connectedAPI.getTxHistory(0, 10);

        expect(Array.isArray(history)).toBe(true);
      });

      it('should return empty array when no transactions exist', async () => {
        const connectedAPI = await createConnectedAPI([]);

        const history = await connectedAPI.getTxHistory(0, 10);

        expect(history).toEqual([]);
      });

      it('should return frozen HistoryEntry objects', async () => {
        const entries: MockHistoryEntry[] = [
          { txHash: createTxHash(1), txStatus: { status: 'finalized', executionStatus: { 0: 'Success' } } },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        const history = await connectedAPI.getTxHistory(0, 10);

        expect(history.length).toBe(1);
        expect(Object.isFrozen(history[0])).toBe(true);
      });
    });

    describe('pagination', () => {
      it('should accept pageNumber and pageSize parameters', async () => {
        const connectedAPI = await createConnectedAPI();

        // Should not throw
        await expect(connectedAPI.getTxHistory(0, 10)).resolves.toBeDefined();
        await expect(connectedAPI.getTxHistory(1, 20)).resolves.toBeDefined();
        await expect(connectedAPI.getTxHistory(5, 100)).resolves.toBeDefined();
      });

      it('should return empty array for pages beyond available data', async () => {
        const entries: MockHistoryEntry[] = [
          { txHash: createTxHash(1), txStatus: { status: 'finalized', executionStatus: { 0: 'Success' } } },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        // Page 100 should be empty when there's only 1 entry
        const history = await connectedAPI.getTxHistory(100, 10);

        expect(history).toEqual([]);
      });

      it('should respect pageSize parameter (property-based)', async () => {
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
              const connectedAPI = await createConnectedAPI(entries);

              const history = await connectedAPI.getTxHistory(pageNumber, pageSize);

              // Result should never exceed pageSize
              expect(history.length).toBeLessThanOrEqual(pageSize);
            },
          ),
          { numRuns: 10 },
        );
      });

      it('should return correct page of results', async () => {
        const entries: MockHistoryEntry[] = Array.from({ length: 25 }, (_, i) => ({
          txHash: createTxHash(i),
          txStatus: { status: 'finalized' as const, executionStatus: { 0: 'Success' as const } },
        }));
        const connectedAPI = await createConnectedAPI(entries);

        const page0 = await connectedAPI.getTxHistory(0, 10);
        const page1 = await connectedAPI.getTxHistory(1, 10);
        const page2 = await connectedAPI.getTxHistory(2, 10);

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
      });

      it('should handle pageSize of 1', async () => {
        const entries: MockHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
          txHash: createTxHash(i),
          txStatus: { status: 'finalized' as const, executionStatus: { 0: 'Success' as const } },
        }));
        const connectedAPI = await createConnectedAPI(entries);

        const page0 = await connectedAPI.getTxHistory(0, 1);
        const page1 = await connectedAPI.getTxHistory(1, 1);

        expect(page0.length).toBe(1);
        expect(page1.length).toBe(1);
        expect(page0[0].txHash).toBe(createTxHash(0));
        expect(page1[0].txHash).toBe(createTxHash(1));
      });
    });

    describe('entry structure', () => {
      it('should return entries with txHash as 64-character hex string', async () => {
        const entries: MockHistoryEntry[] = [
          { txHash: createTxHash(1), txStatus: { status: 'finalized', executionStatus: { 0: 'Success' } } },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        const history = await connectedAPI.getTxHistory(0, 10);

        expect(history.length).toBe(1);
        expect(typeof history[0].txHash).toBe('string');
        // txHash should be hex-encoded 256-bit hash (64 hex characters)
        expect(history[0].txHash).toMatch(/^[0-9a-fA-F]{64}$/);
      });

      it('should return entries with valid txStatus', async () => {
        const entries: MockHistoryEntry[] = [
          { txHash: createTxHash(1), txStatus: { status: 'finalized', executionStatus: { 0: 'Success' } } },
          { txHash: createTxHash(2), txStatus: { status: 'confirmed', executionStatus: { 0: 'Success' } } },
          { txHash: createTxHash(3), txStatus: { status: 'pending' } },
          { txHash: createTxHash(4), txStatus: { status: 'discarded' } },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        const history = await connectedAPI.getTxHistory(0, 10);

        const validStatuses = ['finalized', 'confirmed', 'pending', 'discarded'];

        expect(history.length).toBe(4);
        for (const entry of history) {
          expect(validStatuses).toContain(entry.txStatus.status);
        }
      });

      it('should include executionStatus for finalized transactions', async () => {
        const entries: MockHistoryEntry[] = [
          {
            txHash: createTxHash(1),
            txStatus: {
              status: 'finalized',
              executionStatus: { 0: 'Success', 1: 'Failure' },
            },
          },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        const history = await connectedAPI.getTxHistory(0, 10);

        expect(history.length).toBe(1);
        const entry = history[0];
        expect(entry.txStatus.status).toBe('finalized');
        if (entry.txStatus.status === 'finalized') {
          expect(entry.txStatus).toHaveProperty('executionStatus');
          expect(typeof entry.txStatus.executionStatus).toBe('object');
          // ExecutionStatus values must be exactly 'Success' or 'Failure' (capitalized)
          expect(entry.txStatus.executionStatus[0]).toBe('Success');
          expect(entry.txStatus.executionStatus[1]).toBe('Failure');
        }
      });

      it('should have executionStatus with numeric keys for segment indices', async () => {
        const entries: MockHistoryEntry[] = [
          {
            txHash: createTxHash(1),
            txStatus: {
              status: 'finalized',
              executionStatus: { 0: 'Success', 1: 'Failure', 2: 'Success', 5: 'Failure' },
            },
          },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        const history = await connectedAPI.getTxHistory(0, 10);

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
      });

      it('should include executionStatus for confirmed transactions', async () => {
        const entries: MockHistoryEntry[] = [
          {
            txHash: createTxHash(1),
            txStatus: {
              status: 'confirmed',
              executionStatus: { 0: 'Success' },
            },
          },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        const history = await connectedAPI.getTxHistory(0, 10);

        expect(history.length).toBe(1);
        const entry = history[0];
        expect(entry.txStatus.status).toBe('confirmed');
        if (entry.txStatus.status === 'confirmed') {
          expect(entry.txStatus).toHaveProperty('executionStatus');
          expect(typeof entry.txStatus.executionStatus).toBe('object');
        }
      });

      it('should NOT include executionStatus for pending transactions', async () => {
        const entries: MockHistoryEntry[] = [
          {
            txHash: createTxHash(1),
            txStatus: { status: 'pending' },
          },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        const history = await connectedAPI.getTxHistory(0, 10);

        expect(history.length).toBe(1);
        const entry = history[0];
        expect(entry.txStatus.status).toBe('pending');
        expect(entry.txStatus).not.toHaveProperty('executionStatus');
      });

      it('should NOT include executionStatus for discarded transactions', async () => {
        const entries: MockHistoryEntry[] = [
          {
            txHash: createTxHash(1),
            txStatus: { status: 'discarded' },
          },
        ];
        const connectedAPI = await createConnectedAPI(entries);

        const history = await connectedAPI.getTxHistory(0, 10);

        expect(history.length).toBe(1);
        const entry = history[0];
        expect(entry.txStatus.status).toBe('discarded');
        expect(entry.txStatus).not.toHaveProperty('executionStatus');
      });
    });

    describe('ordering', () => {
      it('should return entries in consistent order across calls', async () => {
        const entries: MockHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
          txHash: createTxHash(i),
          txStatus: { status: 'finalized' as const, executionStatus: { 0: 'Success' as const } },
        }));
        const connectedAPI = await createConnectedAPI(entries);

        const history1 = await connectedAPI.getTxHistory(0, 10);
        const history2 = await connectedAPI.getTxHistory(0, 10);

        expect(history1).toEqual(history2);
      });
    });

    // Note: Disconnected state behavior is tested in disconnection.test.ts
  });
});
