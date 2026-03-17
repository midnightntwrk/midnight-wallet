/**
 * Balancing test suite.
 * Tests balanceUnsealedTransaction and balanceSealedTransaction methods.
 */

import { describe, expect, it, vi } from 'vitest';
import { deserializeTransaction, verifyTransaction, hasDustSpend } from '../../testing.js';
import type { BalancingTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/**
 * Run balancing tests against the provided context.
 */
export const runBalancingTests = (context: BalancingTestContext): void => {
  const { environment } = context;
  const { tokenTypes } = environment;

  describe('balanceUnsealedTransaction', () => {
    describe('API contract', () => {
      it('should have balanceUnsealedTransaction method on ConnectedAPI', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          expect(typeof api.balanceUnsealedTransaction).toBe('function');
        } finally {
          await disconnect();
        }
      });
    });

    // NOTE: Happy path tests for balanceUnsealedTransaction require Transaction<SignatureEnabled, Proof, PreBinding>.
    // mockProve() produces transactions that serialize WITH binding data, so they can't be deserialized as 'pre-binding'.
    // This is a ledger limitation - creating true pre-binding proven transactions requires a real prover.
    // Input validation tests work because they test rejection cases, not the happy path.

    describe('input validation', () => {
      it('should reject malformed hex string', async () => {
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
          await expect(api.balanceUnsealedTransaction('not-valid-hex')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('malformed'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject empty hex string', async () => {
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
          await expect(api.balanceUnsealedTransaction('')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('empty'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject already-sealed transaction', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          await expect(api.balanceUnsealedTransaction(txHex)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('unsealed'),
          });
        } finally {
          await disconnect();
        }
      });
    });
  });

  describe('balanceSealedTransaction', () => {
    describe('API contract', () => {
      it('should have balanceSealedTransaction method on ConnectedAPI', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          expect(typeof api.balanceSealedTransaction).toBe('function');
        } finally {
          await disconnect();
        }
      });
    });

    describe('result structure', () => {
      it('should return deserializable sealed transaction', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex);
          const tx = deserializeTransaction(result.tx);

          expect(tx).toBeDefined();
          expect(typeof tx.bindingRandomness).toBe('bigint');
        } finally {
          await disconnect();
        }
      });
    });

    describe('input validation', () => {
      it('should reject malformed hex string', async () => {
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
          await expect(api.balanceSealedTransaction('not-valid-hex')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('malformed'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject empty hex string', async () => {
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
          await expect(api.balanceSealedTransaction('')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('empty'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('insufficient balance', () => {
      it('should reject with InsufficientFunds when wallet lacks balance to provide inputs', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: {},
          unshielded: {},
          dust: [],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          await expect(api.balanceSealedTransaction(txHex)).rejects.toMatchObject({
            code: 'InsufficientFunds',
            reason: expect.stringMatching(/insufficient|balance/i),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject with InsufficientFunds when wallet lacks dust for fees', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 1000n },
          unshielded: {},
          dust: [],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          await expect(api.balanceSealedTransaction(txHex, { payFees: true })).rejects.toMatchObject({
            code: 'InsufficientFunds',
            reason: expect.stringMatching(/insufficient|dust|fee/i),
          });
        } finally {
          await disconnect();
        }
      });

      it('should NOT reject for insufficient dust when payFees is false', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 1000n },
          unshielded: {},
          dust: [],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex, { payFees: false });
          expect(result.tx).toBeDefined();
        } finally {
          await disconnect();
        }
      });
    });

    describe('balance verification', () => {
      it('should include DustSpend when payFees is true (default)', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex);
          const tx = deserializeTransaction(result.tx);

          expect(hasDustSpend(tx)).toBe(true);
        } finally {
          await disconnect();
        }
      });

      it('should include DustSpend when payFees is explicitly true', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex, { payFees: true });
          const tx = deserializeTransaction(result.tx);

          expect(hasDustSpend(tx)).toBe(true);
        } finally {
          await disconnect();
        }
      });

      it('should NOT include DustSpend when payFees is false', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex, { payFees: false });
          const tx = deserializeTransaction(result.tx);

          expect(hasDustSpend(tx)).toBe(false);
        } finally {
          await disconnect();
        }
      });

      it('should return fully balanced transaction', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex);
          const verification = verifyTransaction(deserializeTransaction(result.tx));

          expect(verification.isBalanced).toBe(true);
        } finally {
          await disconnect();
        }
      });
    });

    describe('transaction structure', () => {
      it('should return sealed transaction (with binding randomness)', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex);
          const tx = deserializeTransaction(result.tx);

          expect(tx.bindingRandomness).toBeDefined();
          expect(typeof tx.bindingRandomness).toBe('bigint');
        } finally {
          await disconnect();
        }
      });

      it('should return transaction ready for submission', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex);
          const tx = deserializeTransaction(result.tx);

          expect(() => tx.serialize()).not.toThrow();
          expect(tx.intents).toBeDefined();
          expect(tx.intents?.size).toBeGreaterThanOrEqual(1);
        } finally {
          await disconnect();
        }
      });

      it('should preserve original transaction intents', async () => {
        const withBalances = context.withBalances;
        const buildSealedTransaction = environment.buildSealedTransaction;
        const serializeTransaction = environment.serializeTransaction;
        if (withBalances === undefined || buildSealedTransaction === undefined || serializeTransaction === undefined) {
          return;
        }

        const testContext = withBalances({
          shielded: { [tokenTypes.standard]: 10000n },
          unshielded: { [tokenTypes.standard]: 10000n },
          dust: [{ maxCap: 1000n, balance: 1000n }],
        });
        const { api, disconnect } = await testContext.createConnectedAPI();

        try {
          const sealedTx = buildSealedTransaction({ networkId: environment.networkId });
          const originalIntentCount = sealedTx.intents?.size ?? 0;
          const txHex = serializeTransaction(sealedTx);

          const result = await api.balanceSealedTransaction(txHex);
          const tx = deserializeTransaction(result.tx);

          expect(tx.intents?.size).toBeGreaterThanOrEqual(originalIntentCount);
        } finally {
          await disconnect();
        }
      });
    });
  });
};
