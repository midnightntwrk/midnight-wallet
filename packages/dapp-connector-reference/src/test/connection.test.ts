import { describe, expect, it, vi } from 'vitest';
import { Connector } from '../index.js';
import { APIError, ErrorCodes } from '../errors.js';
import { defaultConnectorMetadataArbitrary, randomValue, defaultConnectorConfigurationArbitrary } from '../testing.js';
import type { ConnectorConfiguration } from '../types.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';
import * as fc from 'fast-check';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

describe('Connection', () => {
  const defaultConfig: ConnectorConfiguration = {
    networkId: 'testnet',
    indexerUri: 'http://localhost:8080',
    indexerWsUri: 'ws://localhost:8080',
    substrateNodeUri: 'ws://localhost:9944',
  };

  describe('connect with matching networkId', () => {
    it('should return a promise', () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const result = connector.connect('testnet');

      expect(result).toBeInstanceOf(Promise);
    });

    it('should resolve to a ConnectedAPI when networkId matches configuration', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const connectedAPI = await connector.connect('testnet');

      expect(connectedAPI).toBeDefined();
      expect(connectedAPI).not.toBeNull();
    });

    it('should return a frozen ConnectedAPI instance', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const connectedAPI = await connector.connect('testnet');

      expect(Object.isFrozen(connectedAPI)).toBe(true);
    });

    it('should return an object with all required ConnectedAPI methods', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const connectedAPI = await connector.connect('testnet');

      // Verify all WalletConnectedAPI methods exist
      expect(typeof connectedAPI.getShieldedBalances).toBe('function');
      expect(typeof connectedAPI.getUnshieldedBalances).toBe('function');
      expect(typeof connectedAPI.getDustBalance).toBe('function');
      expect(typeof connectedAPI.getShieldedAddresses).toBe('function');
      expect(typeof connectedAPI.getUnshieldedAddress).toBe('function');
      expect(typeof connectedAPI.getDustAddress).toBe('function');
      expect(typeof connectedAPI.getTxHistory).toBe('function');
      expect(typeof connectedAPI.balanceUnsealedTransaction).toBe('function');
      expect(typeof connectedAPI.balanceSealedTransaction).toBe('function');
      expect(typeof connectedAPI.makeTransfer).toBe('function');
      expect(typeof connectedAPI.makeIntent).toBe('function');
      expect(typeof connectedAPI.submitTransaction).toBe('function');
      expect(typeof connectedAPI.signData).toBe('function');
      expect(typeof connectedAPI.getProvingProvider).toBe('function');
      expect(typeof connectedAPI.getConfiguration).toBe('function');
      expect(typeof connectedAPI.getConnectionStatus).toBe('function');
      // HintUsage method
      expect(typeof connectedAPI.hintUsage).toBe('function');
    });

    it('should allow multiple connect calls (re-connection support)', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const connectedAPI1 = await connector.connect('testnet');
      const connectedAPI2 = await connector.connect('testnet');

      expect(connectedAPI1).toBeDefined();
      expect(connectedAPI2).toBeDefined();
    });

    it('should return a new instance on each connect call', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const connectedAPI1 = await connector.connect('testnet');
      const connectedAPI2 = await connector.connect('testnet');

      // Each connect call should return a new instance
      expect(connectedAPI1).not.toBe(connectedAPI2);
    });

    it('should work with case-sensitive networkId matching', async () => {
      const configWithMixedCase: ConnectorConfiguration = {
        ...defaultConfig,
        networkId: 'TestNet',
      };
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, configWithMixedCase);

      // Exact match should work
      const connectedAPI = await connector.connect('TestNet');
      expect(connectedAPI).toBeDefined();

      // Different case should fail
      await expect(connector.connect('testnet')).rejects.toThrow();
      await expect(connector.connect('TESTNET')).rejects.toThrow();
    });
  });

  describe('connect with mismatched networkId', () => {
    it('should reject when networkId does not match', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      await expect(connector.connect('mainnet')).rejects.toThrow();
    });

    it('should reject with an APIError', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      try {
        await connector.connect('mainnet');
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
      }
    });

    it('should reject with Rejected error code', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      try {
        await connector.connect('mainnet');
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.code).toBe(ErrorCodes.Rejected);
        }
      }
    });

    it('should include requested networkId in error reason', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      try {
        await connector.connect('differentNetwork');
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.reason).toContain('differentNetwork');
        }
      }
    });

    it('should include configured networkId in error reason', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      try {
        await connector.connect('mainnet');
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(APIError.isAPIError(error)).toBe(true);
        if (APIError.isAPIError(error)) {
          expect(error.reason).toContain('testnet');
        }
      }
    });

    it('should reject with empty networkId', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      await expect(connector.connect('')).rejects.toThrow();
    });

    it('should reject with whitespace-only networkId', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      await expect(connector.connect('   ')).rejects.toThrow();
    });
  });

  describe('with random configuration (property-based)', () => {
    it('should connect successfully with matching networkId for any valid config', async () => {
      await fc.assert(
        fc.asyncProperty(
          defaultConnectorMetadataArbitrary,
          defaultConnectorConfigurationArbitrary,
          async (metadata, config) => {
            const facade = prepareMockFacade();
            const keystore = prepareMockUnshieldedKeystore();
            const connector = new Connector(metadata, facade, keystore, config);

            const connectedAPI = await connector.connect(config.networkId);

            expect(connectedAPI).toBeDefined();
            expect(Object.isFrozen(connectedAPI)).toBe(true);
          },
        ),
      );
    });

    it('should reject connection with different networkId for any valid config', async () => {
      await fc.assert(
        fc.asyncProperty(
          defaultConnectorMetadataArbitrary,
          defaultConnectorConfigurationArbitrary,
          async (metadata, config) => {
            const facade = prepareMockFacade();
            const keystore = prepareMockUnshieldedKeystore();
            const connector = new Connector(metadata, facade, keystore, config);

            // Use a networkId that's definitely different
            const differentNetworkId = config.networkId + '_different';

            try {
              await connector.connect(differentNetworkId);
              expect.fail('Expected error to be thrown');
            } catch (error) {
              expect(APIError.isAPIError(error)).toBe(true);
              if (APIError.isAPIError(error)) {
                expect(error.code).toBe(ErrorCodes.Rejected);
              }
            }
          },
        ),
      );
    });
  });

  describe('getInitialAPI and connect interaction', () => {
    it('should allow connection through getInitialAPI().connect()', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const initialAPI = connector.getInitialAPI();
      const connectedAPI = await initialAPI.connect('testnet');

      expect(connectedAPI).toBeDefined();
      expect(Object.isFrozen(connectedAPI)).toBe(true);
    });

    it('should reject connection through getInitialAPI().connect() with wrong networkId', async () => {
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const facade = prepareMockFacade();
      const keystore = prepareMockUnshieldedKeystore();
      const connector = new Connector(metadata, facade, keystore, defaultConfig);

      const initialAPI = connector.getInitialAPI();

      await expect(initialAPI.connect('wrongNetwork')).rejects.toThrow();
    });
  });
});
