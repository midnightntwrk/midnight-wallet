/**
 * Proving provider factories for the DApp Connector.
 *
 * This module provides factory functions that create ProvingProvider instances
 * from DApp-provided KeyMaterialProvider. The factories abstract away the
 * proving implementation, allowing easy swapping between:
 * - WASM-based proving (in-browser)
 * - HTTP-based proving (remote server)
 * - Mock proving (testing)
 */

import type { KeyMaterialProvider, ProvingProvider } from '@midnight-ntwrk/dapp-connector-api';
import * as zkir from '@midnight-ntwrk/zkir-v2';
import type { ProvingProviderFactory } from './types.js';

// =============================================================================
// BLS Parameters Provider
// =============================================================================

/**
 * S3 bucket URL for BLS parameters.
 * These are universal parameters needed for PLONK proving.
 */
const PARAMS_S3_URL = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';

/**
 * Cache for BLS parameters to avoid repeated fetches.
 */
const paramsCache = new Map<number, Uint8Array>();

/**
 * Fetch BLS parameters from S3 with retry logic.
 */
const fetchParams = async (k: number): Promise<Uint8Array> => {
  const cached = paramsCache.get(k);
  if (cached !== undefined) {
    return cached;
  }

  const url = `${PARAMS_S3_URL}/bls_midnight_2p${k}`;
  const maxRetries = 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = new Uint8Array(await response.arrayBuffer());
      paramsCache.set(k, result);
      return result;
    } catch (e) {
      if (attempt === maxRetries - 1) {
        throw new Error(`Failed to fetch BLS parameters after ${maxRetries} attempts: ${e}`);
      }
      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt + 1)));
    }
  }
  throw new Error('Unreachable');
};

// =============================================================================
// KeyMaterialProvider Adapter
// =============================================================================

/**
 * Adapt a dapp-connector-api KeyMaterialProvider to zkir-v2's KeyMaterialProvider.
 *
 * The dapp-connector-api interface provides separate methods for each key component:
 * - getZKIR(keyLocation) -> Uint8Array
 * - getProverKey(keyLocation) -> Uint8Array
 * - getVerifierKey(keyLocation) -> Uint8Array
 *
 * The zkir-v2 interface expects:
 * - lookupKey(keyLocation) -> { ir, proverKey, verifierKey } | undefined
 * - getParams(k) -> Uint8Array (BLS parameters)
 */
const adaptKeyMaterialProvider = (provider: KeyMaterialProvider): zkir.KeyMaterialProvider => ({
  lookupKey: async (keyLocation: string): Promise<zkir.ProvingKeyMaterial | undefined> => {
    try {
      const [ir, proverKey, verifierKey] = await Promise.all([
        provider.getZKIR(keyLocation),
        provider.getProverKey(keyLocation),
        provider.getVerifierKey(keyLocation),
      ]);
      return { ir, proverKey, verifierKey };
    } catch {
      // If any key fetch fails, return undefined (key not found)
      return undefined;
    }
  },
  getParams: fetchParams,
});

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a WASM-based ProvingProviderFactory.
 *
 * This factory uses zkir-v2's WASM implementation to prove circuits directly
 * in the browser/Node.js environment. It adapts the DApp-provided
 * KeyMaterialProvider to the format expected by zkir-v2.
 *
 * Note: WASM proving can be CPU-intensive. For production use in browsers,
 * consider using Web Workers (which the WasmProver from prover-client does).
 * This implementation runs synchronously on the main thread for simplicity.
 *
 * @returns A ProvingProviderFactory that creates zkir-v2 based ProvingProviders
 *
 * @example
 * ```typescript
 * const config: ConnectorConfiguration = {
 *   networkId: 'testnet',
 *   indexerUri: 'http://localhost:8080',
 *   indexerWsUri: 'ws://localhost:8080',
 *   substrateNodeUri: 'ws://localhost:9944',
 *   provingProviderFactory: createWasmProvingProviderFactory(),
 * };
 * ```
 */
export const createWasmProvingProviderFactory = (): ProvingProviderFactory => {
  return (keyMaterialProvider: KeyMaterialProvider): ProvingProvider => {
    const adaptedProvider = adaptKeyMaterialProvider(keyMaterialProvider);
    return zkir.provingProvider(adaptedProvider);
  };
};

/**
 * Create a mock ProvingProviderFactory for testing.
 *
 * This factory creates ProvingProviders that return dummy proofs.
 * Useful for testing DApp integration without actual proving overhead.
 *
 * @param mockCheck - Optional custom check implementation
 * @param mockProve - Optional custom prove implementation
 * @returns A ProvingProviderFactory that creates mock ProvingProviders
 */
export const createMockProvingProviderFactory = (
  mockCheck?: (serializedPreimage: Uint8Array, keyLocation: string) => Promise<(bigint | undefined)[]>,
  mockProve?: (serializedPreimage: Uint8Array, keyLocation: string, overwriteBindingInput?: bigint) => Promise<Uint8Array>,
): ProvingProviderFactory => {
  return (_keyMaterialProvider: KeyMaterialProvider): ProvingProvider => ({
    check: mockCheck ?? (async () => []),
    prove: mockProve ?? (async () => new Uint8Array(0)),
  });
};
