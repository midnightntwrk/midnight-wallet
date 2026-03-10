import { describe, expect, it, vi } from 'vitest';
import { Connector } from '../index.js';
import { APIError, ErrorCodes } from '../errors.js';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

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
    it('should reject getConfiguration with Disconnected error after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      try {
        await connectedAPI.getConfiguration();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Disconnected);
        }
      }
    });

    it('should reject getShieldedAddresses with Disconnected error after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      try {
        await connectedAPI.getShieldedAddresses();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Disconnected);
        }
      }
    });

    it('should reject getUnshieldedAddress with Disconnected error after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      try {
        await connectedAPI.getUnshieldedAddress();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Disconnected);
        }
      }
    });

    it('should reject getDustAddress with Disconnected error after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      try {
        await connectedAPI.getDustAddress();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Disconnected);
        }
      }
    });

    it('should reject getShieldedBalances with Disconnected error after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      try {
        await connectedAPI.getShieldedBalances();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Disconnected);
        }
      }
    });

    it('should reject getUnshieldedBalances with Disconnected error after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      try {
        await connectedAPI.getUnshieldedBalances();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Disconnected);
        }
      }
    });

    it('should reject getDustBalance with Disconnected error after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      try {
        await connectedAPI.getDustBalance();
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Disconnected);
        }
      }
    });

    it('should reject submitTransaction with Disconnected error after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      try {
        await connectedAPI.submitTransaction('0x1234');
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Disconnected);
        }
      }
    });

    it('should still allow getConnectionStatus after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      // getConnectionStatus should NOT throw - it should return disconnected status
      const status = await connectedAPI.getConnectionStatus();
      expect(status.status).toBe('disconnected');
    });

    it('should still allow hintUsage after disconnect', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      await connectedAPI.disconnect();

      // hintUsage should NOT throw - it's a hint, not an action
      await expect(connectedAPI.hintUsage(['getConfiguration'])).resolves.toBeUndefined();
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
