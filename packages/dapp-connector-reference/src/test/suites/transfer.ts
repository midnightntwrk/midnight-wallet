/** Transfer test suite. Tests makeTransfer method for creating balanced transfer transactions. */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { deserializeTransaction, verifyTransaction, hasDustSpend } from '../../testing.js';
import type { DappConnectorTestContext } from '../context.js';
import { matchesString } from './_matchers.js';

/** Run transfer tests against the provided context. */
export const runTransferTests = (context: DappConnectorTestContext): void => {
  const { environment } = context;
  const { addresses, addressKeys, tokenTypes } = environment;

  describe('API contract', () => {
    it('should have makeTransfer method on ConnectedAPI', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
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
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        const result = await setup.wallets.alice.api.makeTransfer(desiredOutputs);
        const { bindingRandomness } = deserializeTransaction(result.tx);

        expect(typeof bindingRandomness).toBe('bigint');
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('shielded outputs', () => {
    it('should create balanced transaction with requested shielded output', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ];

        const result = await setup.wallets.alice.api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        // Funded with 10_000 of standard, requested 100 → exactly one output to recipient + one change to alice
        expect(verification.shieldedOutputCount).toBe(2);

        if (addressKeys !== undefined) {
          expect(
            verification.containsShieldedOutputs(addressKeys.shielded.secretKeys, [
              { tokenType: tokenTypes.standard, value: 100n },
            ]),
          ).toBe(true);
        }
      } finally {
        await setup.disconnect();
      }
    });

    it('should create balanced transaction with multiple shielded outputs', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          { kind: 'shielded', type: tokenTypes.standard, value: 200n, recipient: addresses.shielded },
        ];

        const result = await setup.wallets.alice.api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        // 2 outputs to recipient + 1 change to alice = 3
        expect(verification.shieldedOutputCount).toBe(3);

        if (addressKeys !== undefined) {
          expect(
            verification.containsShieldedOutputs(addressKeys.shielded.secretKeys, [
              { tokenType: tokenTypes.standard, value: 100n },
              { tokenType: tokenTypes.standard, value: 200n },
            ]),
          ).toBe(true);
        }
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('unshielded outputs', () => {
    it('should create balanced transaction with requested unshielded output', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          unshielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.standard, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await setup.wallets.alice.api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        expect(verification.hasUnshieldedSignatures).toBe(true);
        // 1 source UTXO consumed → recipient gets 100, alice gets change → exactly 2 outputs
        expect(verification.unshieldedOutputCount).toBe(2);
        expect(verification.unshieldedOutputs.get(tokenTypes.standard)).toContain(100n);

        if (addressKeys !== undefined) {
          expect(
            verification.containsUnshieldedOutputs([
              { owner: addressKeys.unshielded.verifyingKey, tokenType: tokenTypes.standard, value: 100n },
            ]),
          ).toBe(true);
        }
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('mixed outputs', () => {
    it('should create balanced transaction with both shielded and unshielded outputs', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          { kind: 'unshielded', type: tokenTypes.standard, value: 200n, recipient: addresses.unshielded },
        ];

        const result = await setup.wallets.alice.api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        // 1 shielded source UTXO → 1 output + 1 change = 2; 1 unshielded source UTXO → 1 output + 1 change = 2
        expect(verification.shieldedOutputCount).toBe(2);
        expect(verification.unshieldedOutputCount).toBe(2);

        if (addressKeys !== undefined) {
          expect(
            verification.containsOutputs({
              shielded: {
                secretKeys: addressKeys.shielded.secretKeys,
                outputs: [{ tokenType: tokenTypes.standard, value: 100n }],
              },
              unshielded: [{ owner: addressKeys.unshielded.verifyingKey, tokenType: tokenTypes.standard, value: 200n }],
            }),
          ).toBe(true);
        }
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('multiple token types', () => {
    it('should create balanced transaction with different token types', async () => {
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
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          { kind: 'shielded', type: tokenTypes.alternate, value: 200n, recipient: addresses.shielded },
        ];

        const result = await setup.wallets.alice.api.makeTransfer(desiredOutputs);
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);
        // 2 source UTXOs (one per token type) → 2 outputs to recipient + 2 change to alice = 4
        expect(verification.shieldedOutputCount).toBe(4);

        if (addressKeys !== undefined) {
          expect(
            verification.containsShieldedOutputs(addressKeys.shielded.secretKeys, [
              { tokenType: tokenTypes.standard, value: 100n },
              { tokenType: tokenTypes.alternate, value: 200n },
            ]),
          ).toBe(true);
        }
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('payFees behavior', () => {
    it('should include DustSpend action when payFees is true (default)', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeTransfer([
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ]);
        expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });

    it('should include DustSpend action when payFees is explicitly true', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeTransfer(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded }],
          { payFees: true },
        );
        expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });

    it('should NOT include DustSpend action when payFees is false', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        // Doesn't need Night for payFees=false
        alice: { shielded: { [tokenTypes.standard]: 10_000n } },
      });

      try {
        const result = await setup.wallets.alice.api.makeTransfer(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded }],
          { payFees: false },
        );
        expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(false);
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('property-based tests', () => {
    // Each iteration of a property test runs against a fresh wallet built by `setupWallets`. This sidesteps the
    // wallet's pending-tx tracking (each successful makeTransfer locks its source UTXO until the tx is submitted or
    // discarded). With per-iteration setup we get clean state every run; tests stay independent of which UTXO the
    // coin selector picks. Total cost is the per-iteration Simulator+facade init + Night→Dust dance, so we keep
    // `numRuns` modest.
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
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

      await fc.assert(
        fc.asyncProperty(
          fc.array(desiredOutputArbitrary, { minLength: 1, maxLength: 5 }),
          fc.boolean(),
          async (outputs, payFees) => {
            const setup = await setupWallets({
              alice: {
                shielded: { [tokenTypes.standard]: 100_000n, [tokenTypes.alternate]: 100_000n },
                unshielded: {
                  [tokenTypes.alternate]: 100_000n,
                  [tokenTypes.night]: 100_000n,
                },
              },
            });

            try {
              const shieldedCount = outputs.filter((o) => o.kind === 'shielded').length;
              const unshieldedCount = outputs.filter((o) => o.kind === 'unshielded').length;

              const result = await setup.wallets.alice.api.makeTransfer(outputs, { payFees });
              const verification = verifyTransaction(deserializeTransaction(result.tx));

              expect(verification.isBalanced).toBe(true);
              expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(shieldedCount);
              expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(unshieldedCount);
            } finally {
              await setup.disconnect();
            }
          },
        ),
        { numRuns: 5 },
      );
    });

    it('should include DustSpend iff payFees is true', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

      await fc.assert(
        fc.asyncProperty(
          fc.array(desiredOutputArbitrary, { minLength: 1, maxLength: 5 }),
          fc.boolean(),
          async (outputs, payFees) => {
            const setup = await setupWallets({
              alice: {
                shielded: { [tokenTypes.standard]: 100_000n, [tokenTypes.alternate]: 100_000n },
                unshielded: {
                  [tokenTypes.alternate]: 100_000n,
                  [tokenTypes.night]: 100_000n,
                },
              },
            });

            try {
              const result = await setup.wallets.alice.api.makeTransfer(outputs, { payFees });
              const verification = verifyTransaction(deserializeTransaction(result.tx));
              expect(verification.hasDustSpend).toBe(payFees);
            } finally {
              await setup.disconnect();
            }
          },
        ),
        { numRuns: 5 },
      );
    });
  });

  describe('insufficient balance', () => {
    it('should reject with InsufficientFunds when wallet lacks shielded balance', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      // No shielded standard token; only Night so the wallet still has Dust for fees
      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        await expect(
          setup.wallets.alice.api.makeTransfer([
            { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          ]),
        ).rejects.toMatchObject({
          code: 'InsufficientFunds',
          reason: matchesString(/insufficient|balance/i),
        });
      } finally {
        await setup.disconnect();
      }
    });

    it('should reject with InsufficientFunds when wallet lacks unshielded balance', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      // Alice has Night (for Dust/fees) but no `alternate` token; transfer asks for `alternate` as unshielded.
      // Note: tokenTypes.standard and tokenTypes.night are the same hex string (all zeros), so we use `alternate`
      // here to set up a real "lacks this token" scenario for unshielded transfers.
      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        await expect(
          setup.wallets.alice.api.makeTransfer([
            { kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded },
          ]),
        ).rejects.toMatchObject({
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

      // No Night → no Dust; payFees defaults to true → should reject
      const setup = await setupWallets({
        alice: { shielded: { [tokenTypes.standard]: 1_000n } },
      });

      try {
        await expect(
          setup.wallets.alice.api.makeTransfer([
            { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          ]),
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
        alice: { shielded: { [tokenTypes.standard]: 1_000n } },
      });

      try {
        const result = await setup.wallets.alice.api.makeTransfer(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded }],
          { payFees: false },
        );
        expect(result.tx).toMatch(/^[0-9a-f]+$/i);
        expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(false);
      } finally {
        await setup.disconnect();
      }
    });
  });
};
