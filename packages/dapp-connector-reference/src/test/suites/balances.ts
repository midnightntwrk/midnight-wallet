/** Balance retrieval test suite. Tests getShieldedBalances, getUnshieldedBalances, and getDustBalance. */

import { describe, expect, it, vi } from 'vitest';
import type { DappConnectorTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/** Run balance retrieval tests against the provided context. */
export const runBalanceTests = (context: DappConnectorTestContext): void => {
  describe('getShieldedBalances', () => {
    it('should return a frozen Record with string keys and bigint values', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const balances = await api.getShieldedBalances();

        expect(typeof balances).toBe('object');
        expect(balances).not.toBeNull();
        expect(Object.isFrozen(balances)).toBe(true);
        for (const key of Object.keys(balances)) {
          expect(typeof key).toBe('string');
        }
        for (const value of Object.values(balances)) {
          expect(typeof value).toBe('bigint');
          expect(value).toBeGreaterThanOrEqual(0n);
        }
      } finally {
        await disconnect();
      }
    });
  });

  describe('getUnshieldedBalances', () => {
    it('should return a frozen Record with string keys and bigint values', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const balances = await api.getUnshieldedBalances();

        expect(typeof balances).toBe('object');
        expect(balances).not.toBeNull();
        expect(Object.isFrozen(balances)).toBe(true);
        for (const key of Object.keys(balances)) {
          expect(typeof key).toBe('string');
        }
        for (const value of Object.values(balances)) {
          expect(typeof value).toBe('bigint');
          expect(value).toBeGreaterThanOrEqual(0n);
        }
      } finally {
        await disconnect();
      }
    });
  });

  describe('getDustBalance', () => {
    it('should return a frozen object with cap and balance as bigints', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const dustBalance = await api.getDustBalance();

        expect(dustBalance).toHaveProperty('cap');
        expect(dustBalance).toHaveProperty('balance');
        expect(typeof dustBalance.cap).toBe('bigint');
        expect(typeof dustBalance.balance).toBe('bigint');
        expect(Object.isFrozen(dustBalance)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should return non-negative values with balance <= cap', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const dustBalance = await api.getDustBalance();

        expect(dustBalance.cap).toBeGreaterThanOrEqual(0n);
        expect(dustBalance.balance).toBeGreaterThanOrEqual(0n);
        expect(dustBalance.balance).toBeLessThanOrEqual(dustBalance.cap);
      } finally {
        await disconnect();
      }
    });
  });
};
