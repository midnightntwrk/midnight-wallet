/**
 * Connection test suite.
 * Tests connection establishment and ConnectedAPI structure.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ConnectedAPITestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/**
 * Run connection tests against the provided context.
 */
export const runConnectionTests = (context: ConnectedAPITestContext): void => {
  describe('connection establishment', () => {
    it('should create a ConnectedAPI successfully', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        expect(api).toBeDefined();
        expect(api).not.toBeNull();
      } finally {
        await disconnect();
      }
    });

    it('should return a frozen ConnectedAPI instance', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        expect(Object.isFrozen(api)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should return an object with all required ConnectedAPI methods', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        // Verify all WalletConnectedAPI methods exist
        expect(typeof api.getShieldedBalances).toBe('function');
        expect(typeof api.getUnshieldedBalances).toBe('function');
        expect(typeof api.getDustBalance).toBe('function');
        expect(typeof api.getShieldedAddresses).toBe('function');
        expect(typeof api.getUnshieldedAddress).toBe('function');
        expect(typeof api.getDustAddress).toBe('function');
        expect(typeof api.getTxHistory).toBe('function');
        expect(typeof api.balanceUnsealedTransaction).toBe('function');
        expect(typeof api.balanceSealedTransaction).toBe('function');
        expect(typeof api.makeTransfer).toBe('function');
        expect(typeof api.makeIntent).toBe('function');
        expect(typeof api.submitTransaction).toBe('function');
        expect(typeof api.signData).toBe('function');
        expect(typeof api.getProvingProvider).toBe('function');
        expect(typeof api.getConfiguration).toBe('function');
        expect(typeof api.getConnectionStatus).toBe('function');
        expect(typeof api.hintUsage).toBe('function');
      } finally {
        await disconnect();
      }
    });
  });

  describe('multiple connections', () => {
    it('should allow multiple createConnectedAPI calls', async () => {
      const { api: api1, disconnect: disconnect1 } = await context.createConnectedAPI();
      const { api: api2, disconnect: disconnect2 } = await context.createConnectedAPI();

      try {
        expect(api1).toBeDefined();
        expect(api2).toBeDefined();
      } finally {
        await disconnect1();
        await disconnect2();
      }
    });

    it('should return separate instances for each createConnectedAPI call', async () => {
      const { api: api1, disconnect: disconnect1 } = await context.createConnectedAPI();
      const { api: api2, disconnect: disconnect2 } = await context.createConnectedAPI();

      try {
        // Each call should return a new instance
        expect(api1).not.toBe(api2);
      } finally {
        await disconnect1();
        await disconnect2();
      }
    });
  });

  describe('connected state', () => {
    it('should be in connected state after createConnectedAPI', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const status = await api.getConnectionStatus();
        expect(status.status).toBe('connected');
      } finally {
        await disconnect();
      }
    });

    it('should have networkId matching what was requested', async () => {
      const { api, disconnect, networkId } = await context.createConnectedAPI();

      try {
        const status = await api.getConnectionStatus();
        expect(status.status).toBe('connected');
        if (status.status === 'connected') {
          expect(status.networkId).toBe(networkId);
        }
      } finally {
        await disconnect();
      }
    });
  });
};
