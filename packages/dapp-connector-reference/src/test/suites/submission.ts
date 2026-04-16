/**
 * Transaction submission test suite.
 * Tests submitTransaction method.
 */

import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../errors.js';
import type { DappConnectorTestContext } from '../context.js';
import { buildMockSealedTransaction, serializeTransaction, testShieldedAddress } from '../testUtils.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 * Run transaction submission tests against the provided context.
 */
export const runSubmissionTests = (context: DappConnectorTestContext): void => {
  describe('input validation', () => {
    it('should reject empty transaction hex', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.submitTransaction('')).rejects.toMatchObject({
          code: ErrorCodes.InvalidRequest,
          message: expect.stringContaining('empty'),
        });
      } finally {
        await disconnect();
      }
    });

    it('should reject malformed hex', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.submitTransaction('not-valid-hex!')).rejects.toMatchObject({
          code: ErrorCodes.InvalidRequest,
          message: expect.stringContaining('malformed'),
        });
      } finally {
        await disconnect();
      }
    });

    it('should reject invalid transaction bytes', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        // Valid hex but not a valid transaction
        const invalidTxHex = 'deadbeef';

        await expect(api.submitTransaction(invalidTxHex)).rejects.toMatchObject({
          code: ErrorCodes.InvalidRequest,
          message: expect.stringContaining('deserialize'),
        });
      } finally {
        await disconnect();
      }
    });
  });

  describe('successful submission', () => {
    it('should submit a valid sealed transaction', async () => {
      const { api, disconnect, networkId } = await context.createConnectedAPI();

      try {
        const tx = buildMockSealedTransaction({ networkId });
        const txHex = serializeTransaction(tx);

        // Should resolve without error
        await expect(api.submitTransaction(txHex)).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });

    it('should accept transaction from makeTransfer', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return; // Skip if implementation doesn't support balance mocking
      }

      const tokenType = '0000000000000000000000000000000000000000000000000000000000000000';
      const testContext = withBalances({
        shielded: { [tokenType]: 10000n },
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect, networkId } = await testContext.createConnectedAPI();

      try {
        const shieldedAddress = MidnightBech32m.encode(networkId, testShieldedAddress).asString();

        // Create a transfer transaction
        const { tx } = await api.makeTransfer([
          {
            kind: 'shielded',
            type: tokenType,
            value: 100n,
            recipient: shieldedAddress,
          },
        ]);

        // Submit the transaction from makeTransfer
        await expect(api.submitTransaction(tx)).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });

    it('should accept transaction from balanceSealedTransaction', async () => {
      const withBalances = context.withBalances;
      if (withBalances === undefined) {
        return; // Skip if implementation doesn't support balance mocking
      }

      const testContext = withBalances({
        dust: [{ maxCap: 1000n, balance: 1000n }],
      });
      const { api, disconnect, networkId } = await testContext.createConnectedAPI();

      try {
        // Create a sealed transaction and balance it
        const sealedTx = buildMockSealedTransaction({ networkId });
        const { tx } = await api.balanceSealedTransaction(serializeTransaction(sealedTx));

        // Submit the balanced transaction
        await expect(api.submitTransaction(tx)).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });
  });

  describe('disconnection', () => {
    it('should reject when disconnected', async () => {
      const { api, disconnect, networkId } = await context.createConnectedAPI();
      await disconnect();

      const tx = buildMockSealedTransaction({ networkId });
      const txHex = serializeTransaction(tx);

      await expect(api.submitTransaction(txHex)).rejects.toMatchObject({
        code: ErrorCodes.Disconnected,
      });
    });
  });

  describe('submission errors', () => {
    it('should propagate submission errors from facade', async () => {
      const withSubmissionError = context.withSubmissionError;
      if (withSubmissionError === undefined) {
        return; // Skip if implementation doesn't support error mocking
      }

      const testContext = withSubmissionError(new Error('Network unavailable'));
      const { api, disconnect, networkId } = await testContext.createConnectedAPI();

      try {
        const tx = buildMockSealedTransaction({ networkId });
        const txHex = serializeTransaction(tx);

        await expect(api.submitTransaction(txHex)).rejects.toThrow('Network unavailable');
      } finally {
        await disconnect();
      }
    });
  });
};
