/**
 * Configuration test suite.
 * Tests getConfiguration and getConnectionStatus methods.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ConnectedAPITestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/**
 * Run configuration tests against the provided context.
 */
export const runConfigurationTests = (context: ConnectedAPITestContext): void => {
  describe('getConfiguration', () => {
    it('should return a promise', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const result = api.getConfiguration();
        expect(result).toBeInstanceOf(Promise);
      } finally {
        await disconnect();
      }
    });

    it('should return configuration with required fields', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const config = await api.getConfiguration();

        expect(config.networkId).toBeDefined();
        expect(typeof config.networkId).toBe('string');
        expect(config.indexerUri).toBeDefined();
        expect(typeof config.indexerUri).toBe('string');
        expect(config.indexerWsUri).toBeDefined();
        expect(typeof config.indexerWsUri).toBe('string');
        expect(config.substrateNodeUri).toBeDefined();
        expect(typeof config.substrateNodeUri).toBe('string');
      } finally {
        await disconnect();
      }
    });

    it('should return proverServerUri as string or undefined', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const config = await api.getConfiguration();

        // proverServerUri is optional
        if (config.proverServerUri !== undefined) {
          expect(typeof config.proverServerUri).toBe('string');
        }
      } finally {
        await disconnect();
      }
    });

    it('should return consistent configuration on multiple calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const config1 = await api.getConfiguration();
        const config2 = await api.getConfiguration();

        expect(config1).toEqual(config2);
      } finally {
        await disconnect();
      }
    });

    it('should return frozen configuration object', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const config = await api.getConfiguration();
        expect(Object.isFrozen(config)).toBe(true);
      } finally {
        await disconnect();
      }
    });
  });

  describe('getConnectionStatus', () => {
    it('should return a promise', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const result = api.getConnectionStatus();
        expect(result).toBeInstanceOf(Promise);
      } finally {
        await disconnect();
      }
    });

    it('should return status "connected" when connected', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const status = await api.getConnectionStatus();
        expect(status.status).toBe('connected');
      } finally {
        await disconnect();
      }
    });

    it('should include networkId when connected', async () => {
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

    it('should return consistent status on multiple calls', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const status1 = await api.getConnectionStatus();
        const status2 = await api.getConnectionStatus();

        expect(status1).toEqual(status2);
      } finally {
        await disconnect();
      }
    });

    it('should return frozen status object', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const status = await api.getConnectionStatus();
        expect(Object.isFrozen(status)).toBe(true);
      } finally {
        await disconnect();
      }
    });
  });
};
