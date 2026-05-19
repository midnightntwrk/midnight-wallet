/**
 * Disconnection behavior test suite.
 * Tests behavior of API methods after disconnect.
 */

import { describe, expect, it, vi } from 'vitest';
import type { WalletConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { APIError, ErrorCodes } from '../../errors.js';
import type { ConnectedAPITestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/**
 * API methods that should reject with Disconnected error after disconnect.
 * Each entry is [methodName, invoker function].
 */
const methodsThatRejectWhenDisconnected: Array<[string, (api: WalletConnectedAPI) => Promise<unknown>]> = [
  ['getConfiguration', (api) => api.getConfiguration()],
  ['getShieldedAddresses', (api) => api.getShieldedAddresses()],
  ['getUnshieldedAddress', (api) => api.getUnshieldedAddress()],
  ['getDustAddress', (api) => api.getDustAddress()],
  ['getShieldedBalances', (api) => api.getShieldedBalances()],
  ['getUnshieldedBalances', (api) => api.getUnshieldedBalances()],
  ['getDustBalance', (api) => api.getDustBalance()],
  ['getTxHistory', (api) => api.getTxHistory(0, 10)],
  ['makeTransfer', (api) => api.makeTransfer([])],
  ['makeIntent', (api) => api.makeIntent([], [], { intentId: 'random', payFees: true })],
  ['balanceUnsealedTransaction', (api) => api.balanceUnsealedTransaction('0x1234')],
  ['balanceSealedTransaction', (api) => api.balanceSealedTransaction('0x1234')],
  ['submitTransaction', (api) => api.submitTransaction('0x1234')],
  ['signData', (api) => api.signData('test', { encoding: 'hex', keyType: 'unshielded' })],
  [
    'getProvingProvider',
    (api) =>
      api.getProvingProvider({
        getZKIR: () => Promise.resolve(new Uint8Array()),
        getProverKey: () => Promise.resolve(new Uint8Array()),
        getVerifierKey: () => Promise.resolve(new Uint8Array()),
      }),
  ],
];

/**
 * API methods that should still work after disconnect.
 * Each entry is [methodName, invoker function].
 */
const methodsThatWorkWhenDisconnected: Array<[string, (api: WalletConnectedAPI) => Promise<unknown>]> = [
  ['getConnectionStatus', (api) => api.getConnectionStatus()],
  ['hintUsage', (api) => api.hintUsage(['getConfiguration'])],
];

/**
 * Run disconnection behavior tests against the provided context.
 */
export const runDisconnectionTests = (context: ConnectedAPITestContext): void => {
  describe('disconnect behavior', () => {
    it('should resolve successfully when disconnecting', async () => {
      const { disconnect } = await context.createConnectedAPI();

      await expect(disconnect()).resolves.toBeUndefined();
    });
  });

  describe('getConnectionStatus after disconnect', () => {
    it('should return disconnected status after disconnect', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      await disconnect();
      const status = await api.getConnectionStatus();

      expect(status.status).toBe('disconnected');
    });

    it('should not include networkId when disconnected', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      await disconnect();
      const status = await api.getConnectionStatus();

      expect(status.status).toBe('disconnected');
      expect(status).not.toHaveProperty('networkId');
    });
  });

  describe('API methods after disconnect', () => {
    it.each(methodsThatRejectWhenDisconnected)(
      'should reject %s with Disconnected error after disconnect',
      async (_methodName, invoker) => {
        const { api, disconnect } = await context.createConnectedAPI();

        await disconnect();

        try {
          await invoker(api);
          expect.fail(`Expected ${_methodName} to throw after disconnect`);
        } catch (error) {
          expect(APIError.isAPIError(error)).toBe(true);
          if (APIError.isAPIError(error)) {
            expect(error.code).toBe(ErrorCodes.Disconnected);
          }
        }
      },
    );

    it.each(methodsThatWorkWhenDisconnected)('should still allow %s after disconnect', async (_methodName, invoker) => {
      const { api, disconnect } = await context.createConnectedAPI();

      await disconnect();

      // Should NOT throw - we just verify it resolves without error
      await expect(invoker(api)).resolves.not.toThrow();
    });
  });

  describe('multiple disconnect calls', () => {
    it('should handle multiple disconnect calls gracefully', async () => {
      const { disconnect } = await context.createConnectedAPI();

      await disconnect();
      await expect(disconnect()).resolves.toBeUndefined();
      await expect(disconnect()).resolves.toBeUndefined();
    });

    it('should remain disconnected after multiple disconnect calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      await disconnect();
      await disconnect();

      const status = await api.getConnectionStatus();
      expect(status.status).toBe('disconnected');
    });
  });

  describe('reconnection after disconnect', () => {
    it('should allow new connection after previous connection disconnected', async () => {
      const { disconnect: disconnect1 } = await context.createConnectedAPI();
      await disconnect1();

      // Should be able to connect again
      const { api: api2, disconnect: disconnect2 } = await context.createConnectedAPI();

      try {
        expect(api2).toBeDefined();
        const status = await api2.getConnectionStatus();
        expect(status.status).toBe('connected');
      } finally {
        await disconnect2();
      }
    });

    it('should have independent connection state for each ConnectedAPI instance', async () => {
      const { api: api1, disconnect: disconnect1 } = await context.createConnectedAPI();
      const { api: api2, disconnect: disconnect2 } = await context.createConnectedAPI();

      try {
        await disconnect1();

        // api1 should be disconnected
        const status1 = await api1.getConnectionStatus();
        expect(status1.status).toBe('disconnected');

        // api2 should still be connected
        const status2 = await api2.getConnectionStatus();
        expect(status2.status).toBe('connected');
      } finally {
        await disconnect2();
      }
    });
  });
};
