import { describe, expect, it, vi } from 'vitest';
import { Connector } from '../index.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { APIError, ErrorCodes } from '../errors.js';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/**
 * API methods that should reject with Disconnected error after disconnect.
 * Each entry is [methodName, invoker function].
 */
const methodsThatRejectWhenDisconnected: Array<[string, (api: ExtendedConnectedAPI) => Promise<unknown>]> = [
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
const methodsThatWorkWhenDisconnected: Array<[string, (api: ExtendedConnectedAPI) => Promise<unknown>]> = [
  ['getConnectionStatus', (api) => api.getConnectionStatus()],
  ['hintUsage', (api) => api.hintUsage(['getConfiguration'])],
];

describe('Disconnection', () => {
  const defaultConfig: ConnectorConfiguration = {
    networkId: 'testnet',
    indexerUri: 'http://localhost:8080',
    indexerWsUri: 'ws://localhost:8080',
    substrateNodeUri: 'ws://localhost:9944',
  };

  describe('disconnect method', () => {
    it('should have a disconnect method on ConnectedAPI', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      expect(typeof connectedAPI.disconnect).toBe('function');
    });

    it('should return a promise from disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const result = connectedAPI.disconnect();

      expect(result).toBeInstanceOf(Promise);
    });

    it('should resolve successfully when disconnecting', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await expect(connectedAPI.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('getConnectionStatus after disconnect', () => {
    it('should return disconnected status after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();
      const status = await connectedAPI.getConnectionStatus();

      expect(status.status).toBe('disconnected');
    });

    it('should not include networkId when disconnected', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();
      const status = await connectedAPI.getConnectionStatus();

      expect(status.status).toBe('disconnected');
      expect(status).not.toHaveProperty('networkId');
    });
  });

  describe('API methods after disconnect', () => {
    it.each(methodsThatRejectWhenDisconnected)(
      'should reject %s with Disconnected error after disconnect',
      async (methodName, invoker) => {
        const metadata = randomValue(defaultConnectorMetadataArbitrary);
        const facade = prepareMockFacade();
        const keystore = prepareMockUnshieldedKeystore();
        const connector = new Connector(metadata, facade, keystore, defaultConfig);
        const connectedAPI = await connector.connect('testnet');

        await connectedAPI.disconnect();

        try {
          await invoker(connectedAPI);
          expect.fail(`Expected ${methodName} to throw after disconnect`);
        } catch (error) {
          expect(APIError.isAPIError(error)).toBe(true);
          if (APIError.isAPIError(error)) {
            expect(error.code).toBe(ErrorCodes.Disconnected);
          }
        }
      },
    );

    it.each(methodsThatWorkWhenDisconnected)('should still allow %s after disconnect', async (_methodName, invoker) => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      // Should NOT throw - we just verify it resolves without error
      await expect(invoker(connectedAPI)).resolves.not.toThrow();
    });
  });

  describe('multiple disconnect calls', () => {
    it('should handle multiple disconnect calls gracefully', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();
      await expect(connectedAPI.disconnect()).resolves.toBeUndefined();
      await expect(connectedAPI.disconnect()).resolves.toBeUndefined();
    });

    it('should remain disconnected after multiple disconnect calls', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();
      await connectedAPI.disconnect();

      const status = await connectedAPI.getConnectionStatus();
      expect(status.status).toBe('disconnected');
    });
  });

  describe('reconnection after disconnect', () => {
    it('should allow new connection from connector after previous connection disconnected', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const connectedAPI1 = await connector.connect('testnet');
      await connectedAPI1.disconnect();

      // Should be able to connect again
      const connectedAPI2 = await connector.connect('testnet');
      expect(connectedAPI2).toBeDefined();

      const status = await connectedAPI2.getConnectionStatus();
      expect(status.status).toBe('connected');
    });

    it('should have independent connection state for each ConnectedAPI instance', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const connectedAPI1 = await connector.connect('testnet');
      const connectedAPI2 = await connector.connect('testnet');

      await connectedAPI1.disconnect();

      // connectedAPI1 should be disconnected
      const status1 = await connectedAPI1.getConnectionStatus();
      expect(status1.status).toBe('disconnected');

      // connectedAPI2 should still be connected
      const status2 = await connectedAPI2.getConnectionStatus();
      expect(status2.status).toBe('connected');
    });
  });
});
