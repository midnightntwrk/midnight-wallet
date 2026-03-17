/**
 * Intent test suite.
 * Tests makeIntent method for creating swap/intent transactions.
 */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { deserializeTransaction, verifyTransaction, hasDustSpend } from '../../testing.js';
import type { TransactionTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/**
 * Run intent tests against the provided context.
 */
export const runIntentTests = (context: TransactionTestContext): void => {
  const { environment } = context;
  const { addresses, addressKeys, tokenTypes } = environment;

  describe('API contract', () => {
    it('should have makeIntent method on ConnectedAPI', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        expect(typeof api.makeIntent).toBe('function');
      } finally {
        await disconnect();
      }
    });
  });

  describe('result structure', () => {
    it('should return deserializable sealed transaction', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n, [tokenTypes.alternate]: 10000n },
        unshielded: { [tokenTypes.standard]: 10000n, [tokenTypes.alternate]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const tx = deserializeTransaction(result.tx);

        expect(tx).toBeDefined();
        expect(typeof tx.bindingRandomness).toBe('bigint');
      } finally {
        await disconnect();
      }
    });
  });

  describe('input handling', () => {
    it('should create swap with shielded input and unshielded output', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        unshielded: { [tokenTypes.alternate]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.imbalances).toEqual({
          shielded: { [tokenTypes.standard]: -100n },
          unshielded: { [tokenTypes.alternate]: 50n },
        });

        // Verify unshielded output if address keys available
        if (addressKeys !== undefined) {
          expect(
            verification.containsUnshieldedOutputs([
              { owner: addressKeys.unshielded.verifyingKey, tokenType: tokenTypes.alternate, value: 50n },
            ]),
          ).toBe(true);
        }

        expect(verification.hasDustSpend).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should create swap with unshielded input and shielded output', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.alternate]: 10000n },
        unshielded: { [tokenTypes.standard]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredInputs: DesiredInput[] = [{ kind: 'unshielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.imbalances).toEqual({
          shielded: { [tokenTypes.alternate]: 50n },
          unshielded: { [tokenTypes.standard]: -100n },
        });

        // Verify shielded output if address keys available
        if (addressKeys !== undefined) {
          expect(
            verification.containsShieldedOutputs(addressKeys.shielded.secretKeys, [
              { tokenType: tokenTypes.alternate, value: 50n },
            ]),
          ).toBe(true);
        }

        expect(verification.hasDustSpend).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should create balanced swap with multiple inputs and outputs', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        unshielded: { [tokenTypes.alternate]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredInputs: DesiredInput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n },
          { kind: 'unshielded', type: tokenTypes.alternate, value: 50n },
        ];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          { kind: 'unshielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);

        // Verify outputs if address keys available
        if (addressKeys !== undefined) {
          expect(
            verification.containsOutputs({
              shielded: {
                secretKeys: addressKeys.shielded.secretKeys,
                outputs: [{ tokenType: tokenTypes.standard, value: 100n }],
              },
              unshielded: [{ owner: addressKeys.unshielded.verifyingKey, tokenType: tokenTypes.alternate, value: 50n }],
            }),
          ).toBe(true);
        }
      } finally {
        await disconnect();
      }
    });
  });

  describe('intentId option', () => {
    it('should accept intentId as "random" and place in non-zero segment', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.standard, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const tx = deserializeTransaction(result.tx);

        expect(tx.intents).toBeDefined();
        expect(tx.intents!.size).toBeGreaterThanOrEqual(1);
        expect(tx.intents!.has(0)).toBe(false);
        const segmentIds = Array.from(tx.intents!.keys());
        expect(segmentIds.every((id) => id >= 1 && id <= 65535)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should place intent in exact segment when intentId is 1', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.standard, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 1, payFees: true });
        const tx = deserializeTransaction(result.tx);

        expect(tx.intents).toBeDefined();
        expect(tx.intents!.size).toBeGreaterThanOrEqual(1);
        expect(tx.intents!.has(1)).toBe(true);
        expect(tx.intents!.has(0)).toBe(false);
      } finally {
        await disconnect();
      }
    });

    it('should place intent in exact segment when intentId is arbitrary value', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.standard, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 42, payFees: true });
        const tx = deserializeTransaction(result.tx);

        expect(tx.intents).toBeDefined();
        expect(tx.intents!.size).toBeGreaterThanOrEqual(1);
        expect(tx.intents!.has(42)).toBe(true);
        expect(tx.intents!.has(0)).toBe(false);
      } finally {
        await disconnect();
      }
    });
  });

  describe('payFees option', () => {
    it('should include DustSpend when payFees is true', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.standard, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const tx = deserializeTransaction(result.tx);

        expect(hasDustSpend(tx)).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should NOT include DustSpend when payFees is false', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.standard, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: false });
        const tx = deserializeTransaction(result.tx);

        expect(hasDustSpend(tx)).toBe(false);
      } finally {
        await disconnect();
      }
    });
  });

  describe('transaction properties', () => {
    it('should return sealed transaction (cryptographically bound)', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const tx = deserializeTransaction(result.tx);

        expect(tx.bindingRandomness).toBeDefined();
        expect(typeof tx.bindingRandomness).toBe('bigint');
      } finally {
        await disconnect();
      }
    });

    it('should return transaction with valid TTL', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.hasValidTtl).toBe(true);
      } finally {
        await disconnect();
      }
    });
  });

  describe('imbalance verification', () => {
    it('should create exact imbalances matching desired inputs/outputs', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return;
      }

      const testContext = withBalances({
        shielded: { [tokenTypes.standard]: 10000n },
        unshielded: { [tokenTypes.alternate]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect } = await testContext.createConnectedAPI();

      try {
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.unshielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 'random', payFees: true });
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.imbalances).toEqual({
          shielded: { [tokenTypes.standard]: -100n },
          unshielded: { [tokenTypes.alternate]: 50n },
        });
      } finally {
        await disconnect();
      }
    });
  });

  describe('property-based tests', () => {
    const intentIdArbitrary = fc.oneof(fc.constant('random' as const), fc.integer({ min: 1, max: 65535 }));

    // Constrained arbitraries using environment addresses and token types
    const desiredInputArbitrary = fc.oneof(
      fc.record({
        kind: fc.constant('shielded' as const),
        type: fc.constantFrom(tokenTypes.standard, tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 100n }),
      }),
      fc.record({
        kind: fc.constant('unshielded' as const),
        type: fc.constantFrom(tokenTypes.standard, tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 100n }),
      }),
    );

    const desiredOutputArbitrary = fc.oneof(
      fc.record({
        kind: fc.constant('shielded' as const),
        type: fc.constantFrom(tokenTypes.standard, tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 100n }),
        recipient: fc.constantFrom(addresses.shielded, addresses.shielded2),
      }),
      fc.record({
        kind: fc.constant('unshielded' as const),
        type: fc.constantFrom(tokenTypes.standard, tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 100n }),
        recipient: fc.constantFrom(addresses.unshielded, addresses.unshielded2),
      }),
    );

    // Combined arbitrary that enforces count(inputs) + count(outputs) > 0
    const inputsOutputsArbitrary = fc
      .tuple(fc.array(desiredInputArbitrary, { maxLength: 3 }), fc.array(desiredOutputArbitrary, { maxLength: 3 }))
      .filter(([inputs, outputs]) => inputs.length + outputs.length > 0);

    it('should have DustSpend iff payFees is true', async () => {
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
          fc.asyncProperty(inputsOutputsArbitrary, intentIdArbitrary, fc.boolean(), async ([inputs, outputs], intentId, payFees) => {
            const result = await api.makeIntent(inputs, outputs, { intentId, payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));

            expect(verification.hasDustSpend).toBe(payFees);
          }),
          { numRuns: 25 },
        );
      } finally {
        await disconnect();
      }
    }, 60_000);

    it('should place intent in exact segment specified by numeric intentId', async () => {
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
            inputsOutputsArbitrary,
            fc.integer({ min: 1, max: 65535 }),
            fc.boolean(),
            async ([inputs, outputs], segmentId, payFees) => {
              const result = await api.makeIntent(inputs, outputs, { intentId: segmentId, payFees });
              const tx = deserializeTransaction(result.tx);

              expect(tx.intents).toBeDefined();
              expect(tx.intents!.size).toBeGreaterThanOrEqual(1);
              expect(tx.intents!.has(segmentId)).toBe(true);
            },
          ),
          { numRuns: 25 },
        );
      } finally {
        await disconnect();
      }
    }, 60_000);

    it('should have correct output counts', async () => {
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
          fc.asyncProperty(inputsOutputsArbitrary, intentIdArbitrary, fc.boolean(), async ([inputs, outputs], intentId, payFees) => {
            const shieldedOutputCount = outputs.filter((o) => o.kind === 'shielded').length;
            const unshieldedOutputCount = outputs.filter((o) => o.kind === 'unshielded').length;

            const result = await api.makeIntent(inputs, outputs, { intentId, payFees });
            const verification = verifyTransaction(deserializeTransaction(result.tx));

            expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(shieldedOutputCount);
            expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(unshieldedOutputCount);
          }),
          { numRuns: 25 },
        );
      } finally {
        await disconnect();
      }
    }, 60_000);
  });

  describe('insufficient balance', () => {
    it('should reject with InsufficientFunds when wallet lacks shielded balance for inputs', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded },
        ];

        await expect(api.makeIntent(desiredInputs, desiredOutputs, { intentId: 1, payFees: true })).rejects.toMatchObject({
          code: 'InsufficientFunds',
          reason: expect.stringMatching(/insufficient|balance/i),
        });
      } finally {
        await disconnect();
      }
    });

    it('should reject with InsufficientFunds when wallet lacks unshielded balance for inputs', async () => {
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
        const desiredInputs: DesiredInput[] = [{ kind: 'unshielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.unshielded },
        ];

        await expect(api.makeIntent(desiredInputs, desiredOutputs, { intentId: 1, payFees: true })).rejects.toMatchObject({
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded },
        ];

        await expect(api.makeIntent(desiredInputs, desiredOutputs, { intentId: 1, payFees: true })).rejects.toMatchObject({
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
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded },
        ];

        const result = await api.makeIntent(desiredInputs, desiredOutputs, { intentId: 1, payFees: false });
        expect(result.tx).toBeDefined();
      } finally {
        await disconnect();
      }
    });
  });
};
