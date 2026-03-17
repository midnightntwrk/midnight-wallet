import { describe, it, expect, vi } from 'vitest';
import { Connector } from '../index.js';
import { prepareMockFacade, prepareMockUnshieldedKeystore } from './testUtils.js';
import { randomValue, defaultConnectorMetadataArbitrary } from '../testing.js';
import type { ExtendedConnectedAPI } from '../ConnectedAPI.js';
import { ErrorCodes } from '../errors.js';
import type { ConnectorConfiguration } from '../types.js';
import type { KeyMaterialProvider } from '@midnight-ntwrk/dapp-connector-api';

const defaultConfig: ConnectorConfiguration = {
  networkId: 'testnet',
  indexerUri: 'http://localhost:8080',
  indexerWsUri: 'ws://localhost:8080',
  substrateNodeUri: 'ws://localhost:9944',
};

/**
 * Mock KeyMaterialProvider for testing.
 * In production, DApps provide this to resolve circuit keys.
 */
const createMockKeyMaterialProvider = (): KeyMaterialProvider => ({
  getZKIR: async (_circuitKeyLocation: string): Promise<Uint8Array> => {
    return new Uint8Array([1, 2, 3, 4]);
  },
  getProverKey: async (_circuitKeyLocation: string): Promise<Uint8Array> => {
    return new Uint8Array([5, 6, 7, 8]);
  },
  getVerifierKey: async (_circuitKeyLocation: string): Promise<Uint8Array> => {
    return new Uint8Array([9, 10, 11, 12]);
  },
});

describe('getProvingProvider', () => {
  const createConnectedAPI = async (): Promise<ExtendedConnectedAPI> => {
    const metadata = randomValue(defaultConnectorMetadataArbitrary);
    const facade = prepareMockFacade();
    const keystore = prepareMockUnshieldedKeystore();
    const connector = new Connector(metadata, facade, keystore, defaultConfig);
    const connectedAPI = await connector.connect('testnet');
    return connectedAPI;
  };

  describe('disconnection', () => {
    it('should reject when disconnected', async () => {
      const api = await createConnectedAPI();
      await api.disconnect();
      const keyMaterialProvider = createMockKeyMaterialProvider();

      await expect(api.getProvingProvider(keyMaterialProvider)).rejects.toMatchObject({
        code: ErrorCodes.Disconnected,
      });
    });
  });

  describe('current implementation', () => {
    it('should throw "Not implemented" error', async () => {
      const api = await createConnectedAPI();
      const keyMaterialProvider = createMockKeyMaterialProvider();

      // Current reference implementation does not support proving delegation
      // This test documents the current behavior
      await expect(api.getProvingProvider(keyMaterialProvider)).rejects.toThrow('Not implemented');
    });
  });

  // =============================================================================
  // Future Implementation Tests (skipped until prover integration is available)
  // =============================================================================
  // When implementing proving delegation:
  // 1. Add proving service to WalletFacadeView interface
  // 2. Implement ProvingProvider wrapper that:
  //    - Uses keyMaterialProvider to resolve circuit keys
  //    - Delegates to facade's prover for check() and prove()
  // 3. Enable these tests
  // =============================================================================

  describe.skip('provider interface', () => {
    it('should return a ProvingProvider with check method', async () => {
      const api = await createConnectedAPI();
      const keyMaterialProvider = createMockKeyMaterialProvider();

      const provider = await api.getProvingProvider(keyMaterialProvider);

      expect(provider).toHaveProperty('check');
      expect(typeof provider.check).toBe('function');
    });

    it('should return a ProvingProvider with prove method', async () => {
      const api = await createConnectedAPI();
      const keyMaterialProvider = createMockKeyMaterialProvider();

      const provider = await api.getProvingProvider(keyMaterialProvider);

      expect(provider).toHaveProperty('prove');
      expect(typeof provider.prove).toBe('function');
    });
  });

  describe.skip('check method', () => {
    it('should call keyMaterialProvider to resolve keys', async () => {
      const api = await createConnectedAPI();
      const keyMaterialProvider = createMockKeyMaterialProvider();
      const getZKIRSpy = vi.spyOn(keyMaterialProvider, 'getZKIR');
      const getVerifierKeySpy = vi.spyOn(keyMaterialProvider, 'getVerifierKey');

      const provider = await api.getProvingProvider(keyMaterialProvider);
      const preimage = new Uint8Array([0, 1, 2, 3]);
      const keyLocation = 'test-circuit';

      await provider.check(preimage, keyLocation);

      expect(getZKIRSpy).toHaveBeenCalledWith(keyLocation);
      expect(getVerifierKeySpy).toHaveBeenCalledWith(keyLocation);
    });

    it('should return array of bigint or undefined values', async () => {
      const api = await createConnectedAPI();
      const keyMaterialProvider = createMockKeyMaterialProvider();

      const provider = await api.getProvingProvider(keyMaterialProvider);
      const preimage = new Uint8Array([0, 1, 2, 3]);
      const keyLocation = 'test-circuit';

      const result = await provider.check(preimage, keyLocation);

      expect(Array.isArray(result)).toBe(true);
      // Each element should be bigint or undefined
      for (const value of result) {
        expect(value === undefined || typeof value === 'bigint').toBe(true);
      }
    });
  });

  describe.skip('prove method', () => {
    it('should call keyMaterialProvider to resolve prover key', async () => {
      const api = await createConnectedAPI();
      const keyMaterialProvider = createMockKeyMaterialProvider();
      const getProverKeySpy = vi.spyOn(keyMaterialProvider, 'getProverKey');

      const provider = await api.getProvingProvider(keyMaterialProvider);
      const preimage = new Uint8Array([0, 1, 2, 3]);
      const keyLocation = 'test-circuit';

      await provider.prove(preimage, keyLocation);

      expect(getProverKeySpy).toHaveBeenCalledWith(keyLocation);
    });

    it('should return proof as Uint8Array', async () => {
      const api = await createConnectedAPI();
      const keyMaterialProvider = createMockKeyMaterialProvider();

      const provider = await api.getProvingProvider(keyMaterialProvider);
      const preimage = new Uint8Array([0, 1, 2, 3]);
      const keyLocation = 'test-circuit';

      const proof = await provider.prove(preimage, keyLocation);

      expect(proof).toBeInstanceOf(Uint8Array);
    });

    it('should accept optional overwriteBindingInput parameter', async () => {
      const api = await createConnectedAPI();
      const keyMaterialProvider = createMockKeyMaterialProvider();

      const provider = await api.getProvingProvider(keyMaterialProvider);
      const preimage = new Uint8Array([0, 1, 2, 3]);
      const keyLocation = 'test-circuit';
      const bindingInput = 12345n;

      // Should not throw when providing binding input
      await expect(provider.prove(preimage, keyLocation, bindingInput)).resolves.toBeInstanceOf(Uint8Array);
    });
  });
});
