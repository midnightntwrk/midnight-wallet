import { describe, expect, it, vi } from 'vitest';
import { Connector } from '../index.js';
import { defaultConnectorMetadataArbitrary, randomValue, defaultConnectorConfigurationArbitrary } from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';
import * as fc from 'fast-check';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

describe('Configuration', () => {
  const defaultConfig: ConnectorConfiguration = {
    networkId: 'testnet',
    indexerUri: 'http://localhost:8080',
    indexerWsUri: 'ws://localhost:8080',
    substrateNodeUri: 'ws://localhost:9944',
    proverServerUri: 'http://localhost:9000',
  };

  describe('getConfiguration', () => {
    it('should return a promise', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const result = connectedAPI.getConfiguration();

      expect(result).toBeInstanceOf(Promise);
    });

    it('should return all configuration fields matching input', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const config = await connectedAPI.getConfiguration();

      expect(config.networkId).toBe('testnet');
      expect(config.indexerUri).toBe('http://localhost:8080');
      expect(config.indexerWsUri).toBe('ws://localhost:8080');
      expect(config.substrateNodeUri).toBe('ws://localhost:9944');
      expect(config.proverServerUri).toBe('http://localhost:9000');
    });

    it('should return undefined proverServerUri when not provided', async () => {
      const configWithoutProver: ConnectorConfiguration = {
        networkId: 'testnet',
        indexerUri: 'http://localhost:8080',
        indexerWsUri: 'ws://localhost:8080',
        substrateNodeUri: 'ws://localhost:9944',
      };
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, configWithoutProver);
      const connectedAPI = await connector.connect('testnet');

      const config = await connectedAPI.getConfiguration();

      expect(config.proverServerUri).toBeUndefined();
    });

    it('should return consistent configuration on multiple calls', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const config1 = await connectedAPI.getConfiguration();
      const config2 = await connectedAPI.getConfiguration();

      expect(config1).toEqual(config2);
    });

    it('should return configuration matching random input (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(
          defaultConnectorMetadataArbitrary,
          defaultConnectorConfigurationArbitrary,
          async (metadata, inputConfig) => {
            const facade = prepareMockFacade();
            const keystore = prepareMockUnshieldedKeystore();
            const connector = new Connector(metadata, facade, keystore, inputConfig);
            const connectedAPI = await connector.connect(inputConfig.networkId);

            const config = await connectedAPI.getConfiguration();

            expect(config.networkId).toBe(inputConfig.networkId);
            expect(config.indexerUri).toBe(inputConfig.indexerUri);
            expect(config.indexerWsUri).toBe(inputConfig.indexerWsUri);
            expect(config.substrateNodeUri).toBe(inputConfig.substrateNodeUri);
            expect(config.proverServerUri).toBe(inputConfig.proverServerUri);
          },
        ),
      );
    });
  });

  describe('getConnectionStatus', () => {
    it('should return a promise', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const result = connectedAPI.getConnectionStatus();

      expect(result).toBeInstanceOf(Promise);
    });

    it('should return status "connected" with networkId after successful connection', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const status = await connectedAPI.getConnectionStatus();

      expect(status.status).toBe('connected');
      if (status.status === 'connected') {
        expect(status.networkId).toBe('testnet');
      }
    });

    it('should return correct networkId for different networks', async () => {
      const customConfig: ConnectorConfiguration = {
        ...defaultConfig,
        networkId: 'mainnet',
      };
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, customConfig);
      const connectedAPI = await connector.connect('mainnet');

      const status = await connectedAPI.getConnectionStatus();

      expect(status.status).toBe('connected');
      if (status.status === 'connected') {
        expect(status.networkId).toBe('mainnet');
      }
    });

    it('should return consistent status on multiple calls', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const status1 = await connectedAPI.getConnectionStatus();
      const status2 = await connectedAPI.getConnectionStatus();

      expect(status1).toEqual(status2);
    });

    it('should return connected status with random networkId (property-based)', async () => {
      await fc.assert(
        fc.asyncProperty(
          defaultConnectorMetadataArbitrary,
          defaultConnectorConfigurationArbitrary,
          async (metadata, config) => {
            const facade = prepareMockFacade();
            const keystore = prepareMockUnshieldedKeystore();
            const connector = new Connector(metadata, facade, keystore, config);
            const connectedAPI = await connector.connect(config.networkId);

            const status = await connectedAPI.getConnectionStatus();

            expect(status.status).toBe('connected');
            if (status.status === 'connected') {
              expect(status.networkId).toBe(config.networkId);
            }
          },
        ),
      );
    });
  });

  describe('configuration immutability', () => {
    it('should not allow modification of returned configuration', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const config = await connectedAPI.getConfiguration();

      expect(() => {
        (config as { networkId: string }).networkId = 'modified';
      }).toThrow();
    });

    it('should not allow modification of returned connection status', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);
      const connectedAPI = await connector.connect('testnet');

      const status = await connectedAPI.getConnectionStatus();

      expect(() => {
        (status as { status: string }).status = 'disconnected';
      }).toThrow();
    });
  });
});
