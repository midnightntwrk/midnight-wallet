// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
/** Proving delegation test suite. Tests getProvingProvider method. */

import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../errors.js';
import type { ConnectedAPITestContext } from '../context.js';
import type { KeyMaterialProvider } from '@midnightntwrk/dapp-connector-api';

/** Mock KeyMaterialProvider for testing. In production, DApps provide this to resolve circuit keys. */
const createMockKeyMaterialProvider = (): KeyMaterialProvider => ({
  getZKIR: (_circuitKeyLocation: string): Promise<Uint8Array> => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
  getProverKey: (_circuitKeyLocation: string): Promise<Uint8Array> => Promise.resolve(new Uint8Array([5, 6, 7, 8])),
  getVerifierKey: (_circuitKeyLocation: string): Promise<Uint8Array> =>
    Promise.resolve(new Uint8Array([9, 10, 11, 12])),
});

/** Run proving delegation tests against the provided context. */
export const runProvingTests = (context: ConnectedAPITestContext): void => {
  describe('disconnection', () => {
    it('should reject when disconnected', async () => {
      const { api, disconnect } = await context.createConnectedAPI();
      await disconnect();
      const keyMaterialProvider = createMockKeyMaterialProvider();

      await expect(api.getProvingProvider(keyMaterialProvider)).rejects.toMatchObject({
        code: ErrorCodes.Disconnected,
      });
    });
  });

  describe('provider interface', () => {
    it('should return a ProvingProvider with check method', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const keyMaterialProvider = createMockKeyMaterialProvider();
        const provider = await api.getProvingProvider(keyMaterialProvider);

        expect(provider).toHaveProperty('check');
        expect(typeof provider.check).toBe('function');
      } finally {
        await disconnect();
      }
    });

    it('should return a ProvingProvider with prove method', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const keyMaterialProvider = createMockKeyMaterialProvider();
        const provider = await api.getProvingProvider(keyMaterialProvider);

        expect(provider).toHaveProperty('prove');
        expect(typeof provider.prove).toBe('function');
      } finally {
        await disconnect();
      }
    });
  });

  describe('check method', () => {
    it('should return array of bigint or undefined values', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
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
      } finally {
        await disconnect();
      }
    });
  });

  describe('prove method', () => {
    it('should return proof as Uint8Array', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const keyMaterialProvider = createMockKeyMaterialProvider();
        const provider = await api.getProvingProvider(keyMaterialProvider);
        const preimage = new Uint8Array([0, 1, 2, 3]);
        const keyLocation = 'test-circuit';

        const proof = await provider.prove(preimage, keyLocation);

        expect(proof).toBeInstanceOf(Uint8Array);
      } finally {
        await disconnect();
      }
    });

    it('should accept optional overwriteBindingInput parameter', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const keyMaterialProvider = createMockKeyMaterialProvider();
        const provider = await api.getProvingProvider(keyMaterialProvider);
        const preimage = new Uint8Array([0, 1, 2, 3]);
        const keyLocation = 'test-circuit';
        const bindingInput = 12345n;

        // Should not throw when providing binding input
        await expect(provider.prove(preimage, keyLocation, bindingInput)).resolves.toBeInstanceOf(Uint8Array);
      } finally {
        await disconnect();
      }
    });
  });
};
