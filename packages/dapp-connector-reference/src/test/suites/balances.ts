/**
 * Balance retrieval test suite.
 * Tests getShieldedBalances, getUnshieldedBalances, and getDustBalance.
 */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import type { DappConnectorTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

// Token type arbitrary - uses ledger's sampleRawTokenType for realistic 32-byte hex strings
const tokenTypeArbitrary = fc.constant(null).map(() => ledger.sampleRawTokenType());

// Balance value arbitrary - non-negative bigint, unbounded
const balanceValueArbitrary = fc.bigInt({ min: 0n });

// Balances record arbitrary - can be empty or have many entries
const balancesArbitrary = fc.dictionary(tokenTypeArbitrary, balanceValueArbitrary);

/**
 * Run balance retrieval tests against the provided context.
 */
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

    it('should return balances matching facade state (property-based)', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return; // Skip if implementation doesn't support balance mocking
      }

      await fc.assert(
        fc.asyncProperty(balancesArbitrary, async (expectedBalances) => {
          // Create fresh context for each property test iteration
          const testContext = withBalances({ shielded: expectedBalances });
          const { api, disconnect } = await testContext.createConnectedAPI();

          try {
            const balances = await api.getShieldedBalances();
            expect(balances).toEqual(expectedBalances);
          } finally {
            await disconnect();
          }
        }),
        { numRuns: 20 },
      );
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

    it('should return balances matching facade state (property-based)', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return; // Skip if implementation doesn't support balance mocking
      }

      await fc.assert(
        fc.asyncProperty(balancesArbitrary, async (expectedBalances) => {
          const testContext = withBalances({ unshielded: expectedBalances });
          const { api, disconnect } = await testContext.createConnectedAPI();

          try {
            const balances = await api.getUnshieldedBalances();
            expect(balances).toEqual(expectedBalances);
          } finally {
            await disconnect();
          }
        }),
        { numRuns: 20 },
      );
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

    it('should return dust balance matching facade state (property-based)', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return; // Skip if implementation doesn't support balance mocking
      }

      // Each coin has maxCap and balance where balance <= maxCap
      const dustCoinArbitrary = fc
        .record({
          maxCap: balanceValueArbitrary,
          balance: balanceValueArbitrary,
        })
        .filter(({ maxCap, balance }) => balance <= maxCap);

      // Array of coins (can be empty or have multiple)
      const dustCoinsArbitrary = fc.array(dustCoinArbitrary, { minLength: 0, maxLength: 5 });

      await fc.assert(
        fc.asyncProperty(dustCoinsArbitrary, async (coins) => {
          const testContext = withBalances({ dust: coins });
          const { api, disconnect } = await testContext.createConnectedAPI();

          try {
            const dustBalance = await api.getDustBalance();

            const expectedCap = coins.reduce((sum, coin) => sum + coin.maxCap, 0n);
            const expectedBalance = coins.reduce((sum, coin) => sum + coin.balance, 0n);
            expect(dustBalance.cap).toBe(expectedCap);
            expect(dustBalance.balance).toBe(expectedBalance);
          } finally {
            await disconnect();
          }
        }),
        { numRuns: 20 },
      );
    });
  });
};
