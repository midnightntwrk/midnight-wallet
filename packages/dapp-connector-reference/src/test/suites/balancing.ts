/** Balancing test suite. Tests balanceUnsealedTransaction and balanceSealedTransaction methods. */

import { describe, expect, it, vi } from 'vitest';
import type { ConnectedAPI, DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { deserializeTransaction, verifyTransaction, hasDustSpend } from '../../testing.js';
import type { DappConnectorTestContext } from '../context.js';
import { containsString, matchesString } from './_matchers.js';

/**
 * Produce an imbalanced sealed transaction via `makeIntent`. With same-kind input/output (e.g. shielded standard input
 * and shielded alternate output), the wallet builds a tx whose unfilled side becomes an imbalance — which is exactly
 * what we want to feed into `balanceSealedTransaction`.
 *
 * Uses `payFees: false` so the intent itself doesn't need Dust (allowing tests to set up "no Dust" scenarios for the
 * subsequent balance call). The caller chooses the actual `payFees` for the balance step.
 */
const makeImbalancedSealedTx = async (
  api: ConnectedAPI,
  inputs: DesiredInput[],
  outputs: DesiredOutput[],
): Promise<string> => {
  const result = await api.makeIntent(inputs, outputs, { intentId: 'random', payFees: false });
  return result.tx;
};

/** Run balancing tests against the provided context. */
export const runBalancingTests = (context: DappConnectorTestContext): void => {
  const { environment } = context;
  const { addresses, tokenTypes } = environment;

  describe('balanceUnsealedTransaction', () => {
    describe('API contract', () => {
      it('should have balanceUnsealedTransaction method on ConnectedAPI', async () => {
        vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          expect(typeof api.balanceUnsealedTransaction).toBe('function');
        } finally {
          await disconnect();
        }
      });
    });

    // NOTE: Happy path tests for balanceUnsealedTransaction require a Transaction<SignatureEnabled, Proof, PreBinding>.
    // The simulator-backed proving service produces no-binding transactions (proof-erased), not pre-binding, so we
    // can't construct a real unsealed/pre-binding input here. Backends with a real prover should restore happy-path
    // tests in their own test runner.

    describe('input validation', () => {
      it('should reject malformed hex string', async () => {
        vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.balanceUnsealedTransaction('not-valid-hex')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: containsString('malformed'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject empty hex string', async () => {
        vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.balanceUnsealedTransaction('')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: containsString('empty'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject already-sealed transaction', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

        const setup = await setupWallets({
          alice: { shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n } },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          await expect(setup.wallets.alice.api.balanceUnsealedTransaction(sealedHex)).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: containsString('unsealed'),
          });
        } finally {
          await setup.disconnect();
        }
      });
    });
  });

  describe('balanceSealedTransaction', () => {
    describe('API contract', () => {
      it('should have balanceSealedTransaction method on ConnectedAPI', async () => {
        vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          expect(typeof api.balanceSealedTransaction).toBe('function');
        } finally {
          await disconnect();
        }
      });
    });

    describe('input validation', () => {
      it('should reject malformed hex string', async () => {
        vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.balanceSealedTransaction('not-valid-hex')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: containsString('malformed'),
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject empty hex string', async () => {
        vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.balanceSealedTransaction('')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: containsString('empty'),
          });
        } finally {
          await disconnect();
        }
      });
    });

    describe('result structure', () => {
      it('should return deserializable sealed transaction', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

        const setup = await setupWallets({
          alice: {
            shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n },
            unshielded: { [tokenTypes.night]: 100_000n },
          },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          const result = await setup.wallets.alice.api.balanceSealedTransaction(sealedHex);
          const { bindingRandomness } = deserializeTransaction(result.tx);

          expect(typeof bindingRandomness).toBe('bigint');
        } finally {
          await setup.disconnect();
        }
      });
    });

    describe('insufficient balance', () => {
      it('should reject with InsufficientFunds when wallet lacks balance to fill imbalance', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

        // Alice has `standard` (the input) and Night (for fees), but no `alternate` (the output token), so balancing
        // the resulting imbalance requires alternate she doesn't have.
        const setup = await setupWallets({
          alice: { shielded: { [tokenTypes.standard]: 10_000n }, unshielded: { [tokenTypes.night]: 100_000n } },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          await expect(setup.wallets.alice.api.balanceSealedTransaction(sealedHex)).rejects.toMatchObject({
            code: 'InsufficientFunds',
            reason: matchesString(/insufficient|balance/i),
          });
        } finally {
          await setup.disconnect();
        }
      });

      it('should reject with InsufficientFunds when wallet lacks dust for fees', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

        // Alice has the tokens to satisfy the intent's imbalance but no Night/Dust for fees.
        const setup = await setupWallets({
          alice: { shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n } },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          await expect(
            setup.wallets.alice.api.balanceSealedTransaction(sealedHex, { payFees: true }),
          ).rejects.toMatchObject({
            code: 'InsufficientFunds',
            reason: matchesString(/insufficient|dust|fee/i),
          });
        } finally {
          await setup.disconnect();
        }
      });

      it('should NOT reject for insufficient dust when payFees is false', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

        const setup = await setupWallets({
          alice: { shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n } },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          const result = await setup.wallets.alice.api.balanceSealedTransaction(sealedHex, { payFees: false });
          expect(result.tx).toMatch(/^[0-9a-f]+$/i);
          expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(false);
        } finally {
          await setup.disconnect();
        }
      });
    });

    describe('balance verification', () => {
      it('should include DustSpend when payFees is true (default)', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

        const setup = await setupWallets({
          alice: {
            shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n },
            unshielded: { [tokenTypes.night]: 100_000n },
          },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          const result = await setup.wallets.alice.api.balanceSealedTransaction(sealedHex);
          expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(true);
        } finally {
          await setup.disconnect();
        }
      });

      it('should include DustSpend when payFees is explicitly true', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

        const setup = await setupWallets({
          alice: {
            shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n },
            unshielded: { [tokenTypes.night]: 100_000n },
          },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          const result = await setup.wallets.alice.api.balanceSealedTransaction(sealedHex, { payFees: true });
          expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(true);
        } finally {
          await setup.disconnect();
        }
      });

      it('should NOT include DustSpend when payFees is false', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

        const setup = await setupWallets({
          alice: { shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n } },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          const result = await setup.wallets.alice.api.balanceSealedTransaction(sealedHex, { payFees: false });
          expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(false);
        } finally {
          await setup.disconnect();
        }
      });

      it('should return fully balanced transaction', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

        const setup = await setupWallets({
          alice: {
            shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n },
            unshielded: { [tokenTypes.night]: 100_000n },
          },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );

          const result = await setup.wallets.alice.api.balanceSealedTransaction(sealedHex);
          const verification = verifyTransaction(deserializeTransaction(result.tx));

          expect(verification.isBalanced).toBe(true);
        } finally {
          await setup.disconnect();
        }
      });
    });

    describe('transaction structure', () => {
      it('should preserve original transaction intent segment ids', async () => {
        const setupWallets = context.setupWallets;
        if (setupWallets === undefined) return;
        vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

        const setup = await setupWallets({
          alice: {
            shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n },
            unshielded: { [tokenTypes.night]: 100_000n },
          },
        });

        try {
          const sealedHex = await makeImbalancedSealedTx(
            setup.wallets.alice.api,
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          );
          const originalSegmentIds = Array.from(deserializeTransaction(sealedHex).intents?.keys() ?? []).sort();

          const result = await setup.wallets.alice.api.balanceSealedTransaction(sealedHex);
          const balancedSegmentIds = Array.from(deserializeTransaction(result.tx).intents?.keys() ?? []).sort();

          // Balancing may add segments (e.g., for DustSpend), but the original segments must be preserved.
          expect(balancedSegmentIds).toEqual(expect.arrayContaining(originalSegmentIds));
        } finally {
          await setup.disconnect();
        }
      });
    });
  });
};
