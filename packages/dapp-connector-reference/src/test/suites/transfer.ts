/**
 * Transfer test suite.
 * Tests makeTransfer method for creating balanced transfer transactions.
 */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { deserializeTransaction, verifyTransaction, hasDustSpend } from '../../testing.js';
import type { TransactionTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/**
 * Run transfer tests against the provided context.
 */
export const runTransferTests = (context: TransactionTestContext): void => {
  const { environment } = context;
  const { addresses, tokenTypes } = environment;

  describe('API contract', () => {
    it('should have makeTransfer method on ConnectedAPI', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        expect(typeof api.makeTransfer).toBe('function');
      } finally {
        await disconnect();
      }
    });
  });

  describe('result structure', () => {
    it('should return deserializable sealed transaction', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return; // Skip if implementation doesn't support balance mocking
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        const result = await api.makeTransfer(desiredOutputs);
        const tx = deserializeTransaction(result.tx);

        expect(tx).toBeDefined();
        expect(typeof tx.bindingRandomness).toBe('bigint');
      } finally {
        await disconnect();
      }
    });
  });

  describe('shielded outputs', () => {
    it('should create balanced transaction with requested shielded output', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        const result = await api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(1);
      } finally {
        await disconnect();
      }
    });

    it('should create balanced transaction with multiple shielded outputs', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          { kind: 'shielded', type: tokenTypes.standard, value: 200n, recipient: addresses.shielded },
        ];

        const result = await api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(2);
      } finally {
        await disconnect();
      }
    });
  });

  describe('unshielded outputs', () => {
    it('should create balanced transaction with requested unshielded output', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        unshielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const outputValue = 100n;
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.standard, value: outputValue, recipient: addresses.unshielded },
        ];

        const result = await api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        expect(Object.fromEntries(verification.unshieldedOutputs)).toEqual({ [tokenTypes.standard]: [outputValue] });
        expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(1);
        expect(verification.hasUnshieldedSignatures).toBe(true);
      } finally {
        await disconnect();
      }
    });
  });

  describe('mixed outputs', () => {
    it('should create balanced transaction with both shielded and unshielded outputs', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        unshielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          { kind: 'unshielded', type: tokenTypes.standard, value: 200n, recipient: addresses.unshielded },
        ];

        const result = await api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        expect(Object.fromEntries(verification.unshieldedOutputs)).toEqual({ [tokenTypes.standard]: [200n] });
        expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(1);
        expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(1);
      } finally {
        await disconnect();
      }
    });
  });

  describe('multiple token types', () => {
    it('should create balanced transaction with different token types', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n, [tokenTypes.alternate]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          { kind: 'shielded', type: tokenTypes.alternate, value: 200n, recipient: addresses.shielded },
        ];

        const result = await api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(2);
      } finally {
        await disconnect();
      }
    });
  });

  describe('payFees behavior', () => {
    it('should include DustSpend action when payFees is true (default)', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        const result = await api.makeTransfer(desiredOutputs);
        const tx = deserializeTransaction(result.tx);

        expect(hasDustSpend(tx)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should include DustSpend action when payFees is explicitly true', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        const result = await api.makeTransfer(desiredOutputs, { payFees: true });
        const tx = deserializeTransaction(result.tx);

        expect(hasDustSpend(tx)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should NOT include DustSpend action when payFees is false', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        const result = await api.makeTransfer(desiredOutputs, { payFees: false });
        const tx = deserializeTransaction(result.tx);

        expect(hasDustSpend(tx)).toBe(false);
      } finally {
        await disconnect();
      }
    });
  });

  describe('property-based tests', () => {
    // Constrained arbitrary that uses fixed addresses and token types from environment
    const desiredOutputArbitrary = fc.oneof(
      fc.record({
        kind: fc.constant('shielded' as const),
        type: fc.constantFrom(tokenTypes.standard, tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 1000n }),
        recipient: fc.constantFrom(addresses.shielded, addresses.shielded2),
      }),
      fc.record({
        kind: fc.constant('unshielded' as const),
        type: fc.constantFrom(tokenTypes.standard, tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 1000n }),
        recipient: fc.constantFrom(addresses.unshielded, addresses.unshielded2),
      }),
    );

    it('should return balanced transaction with correct output counts', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 100000n, [tokenTypes.alternate]: 100000n },
        unshielded: { [tokenTypes.standard]: 100000n, [tokenTypes.alternate]: 100000n },
        dust: [{ maxCap: 10000n, balance: 10000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        await fc.assert(
          fc.asyncProperty(
            fc.array(desiredOutputArbitrary, { minLength: 1, maxLength: 5 }),
            fc.boolean(),
            async (outputs, payFees) => {
              const shieldedCount = outputs.filter((o) => o.kind === 'shielded').length;
              const unshieldedCount = outputs.filter((o) => o.kind === 'unshielded').length;

              const result = await api.makeTransfer(outputs, { payFees });
              const verification = verifyTransaction(deserializeTransaction(result.tx));

              expect(verification.isBalanced).toBe(true);
              expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(shieldedCount);
              expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(unshieldedCount);
            },
          ),
          { numRuns: 10 },
        );
      } finally {
        await disconnect();
      }
    }, 30_000);

    it('should include DustSpend iff payFees is true', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 100000n, [tokenTypes.alternate]: 100000n },
        unshielded: { [tokenTypes.standard]: 100000n, [tokenTypes.alternate]: 100000n },
        dust: [{ maxCap: 10000n, balance: 10000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        await fc.assert(
          fc.asyncProperty(
            fc.array(desiredOutputArbitrary, { minLength: 1, maxLength: 5 }),
            fc.boolean(),
            async (outputs, payFees) => {
              const result = await api.makeTransfer(outputs, { payFees });
              const verification = verifyTransaction(deserializeTransaction(result.tx));

              expect(verification.hasDustSpend).toBe(payFees);
            },
          ),
          { numRuns: 10 },
        );
      } finally {
        await disconnect();
      }
    }, 30_000);
  });

  describe('insufficient balance', () => {
    it('should reject with InsufficientFunds when wallet lacks shielded balance', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 0n },
        dust: [{ balance: 1000n, maxCap: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        await expect(api.makeTransfer(desiredOutputs)).rejects.toMatchObject({
          code: 'InsufficientFunds',
          reason: expect.stringMatching(/insufficient|balance/i),
        });
      } finally {
        await disconnect();
      }
    });

    it('should reject with InsufficientFunds when wallet lacks unshielded balance', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        unshielded: { [tokenTypes.standard]: 0n },
        dust: [{ balance: 1000n, maxCap: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.standard, value: 100n, recipient: addresses.unshielded },
        ];

        await expect(api.makeTransfer(desiredOutputs)).rejects.toMatchObject({
          code: 'InsufficientFunds',
          reason: expect.stringMatching(/insufficient|balance/i),
        });
      } finally {
        await disconnect();
      }
    });

    it('should reject with InsufficientFunds when wallet lacks dust for fees', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 1000n },
        dust: [],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        await expect(api.makeTransfer(desiredOutputs, { payFees: true })).rejects.toMatchObject({
          code: 'InsufficientFunds',
          reason: expect.stringMatching(/insufficient|dust|fee/i),
        });
      } finally {
        await disconnect();
      }
    });

    it('should NOT reject for insufficient dust when payFees is false', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 1000n },
        dust: [],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        const result = await api.makeTransfer(desiredOutputs, { payFees: false });
        expect(result.tx).toBeDefined();
      } finally {
        await disconnect();
      }
    });
  });
};
