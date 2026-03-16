import { describe, it, expect } from 'vitest';
import { Connector } from '../index.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';
import { randomValue, defaultConnectorMetadataArbitrary } from '../testing.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { ErrorCodes } from '../errors.js';
import type { ConnectorConfiguration } from '../types.js';

const defaultConfig: ConnectorConfiguration = {
  networkId: 'testnet',
  indexerUri: 'http://localhost:8080',
  indexerWsUri: 'ws://localhost:8080',
  substrateNodeUri: 'ws://localhost:9944',
};

describe('hintUsage', () => {
  const createConnectedAPI = async (): Promise<ExtendedConnectedAPI> => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const facade = prepareMockFacade();
    const keystore = prepareMockUnshieldedKeystore();
    const connector = new Connector(metadata, facade, keystore, defaultConfig);
    const connectedAPI = await connector.connect('testnet');
    return connectedAPI;
  };

  describe('basic behavior', () => {
    it('should resolve without error for empty array', async () => {
      const api = await createConnectedAPI();

      await expect(api.hintUsage([])).resolves.toBeUndefined();
    });

    it('should resolve without error for single method', async () => {
      const api = await createConnectedAPI();

      await expect(api.hintUsage(['getShieldedBalances'])).resolves.toBeUndefined();
    });

    it('should resolve without error for multiple methods', async () => {
      const api = await createConnectedAPI();

      await expect(
        api.hintUsage(['getShieldedBalances', 'getUnshieldedBalances', 'makeTransfer']),
      ).resolves.toBeUndefined();
    });

    it('should accept all valid method names', async () => {
      const api = await createConnectedAPI();

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
    });
  });

  describe('multiple calls', () => {
    it('should handle multiple sequential calls', async () => {
      const api = await createConnectedAPI();

      await expect(api.hintUsage(['getShieldedBalances'])).resolves.toBeUndefined();
      await expect(api.hintUsage(['makeTransfer'])).resolves.toBeUndefined();
      await expect(api.hintUsage(['submitTransaction'])).resolves.toBeUndefined();
    });

    it('should handle repeated method names in same call', async () => {
      const api = await createConnectedAPI();

      await expect(
        api.hintUsage(['getShieldedBalances', 'getShieldedBalances', 'getShieldedBalances']),
      ).resolves.toBeUndefined();
    });

    it('should handle concurrent calls', async () => {
      const api = await createConnectedAPI();

      const results = await Promise.all([
        api.hintUsage(['getShieldedBalances']),
        api.hintUsage(['makeTransfer']),
        api.hintUsage(['submitTransaction']),
      ]);

      expect(results).toEqual([undefined, undefined, undefined]);
    });
  });

  describe('disconnection', () => {
    it('should still resolve when disconnected (reference behavior)', async () => {
      const api = await createConnectedAPI();
      await api.disconnect();

      // hintUsage is allowed even when disconnected per spec
      // (it's a hint, not an actual operation)
      await expect(api.hintUsage(['getShieldedBalances'])).resolves.toBeUndefined();
    });
  });
});
