/**
 * Transaction submission test suite.
 * Tests submitTransaction method.
 */

import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../errors.js';
import type { DappConnectorTestContext } from '../context.js';

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
      const buildSealedTransaction = context.environment.buildSealedTransaction;
      const serializeTransaction = context.environment.serializeTransaction;
      if (buildSealedTransaction === undefined || serializeTransaction === undefined) {
        return; // Skip when the implementation can't produce strictly-proven sealed transactions
      }

      const { api, disconnect, networkId } = await context.createConnectedAPI();

      try {
        const tx = buildSealedTransaction({ networkId });
        const txHex = serializeTransaction(tx);

        // Should resolve without error
        await expect(api.submitTransaction(txHex)).resolves.toBeUndefined();
      } finally {
        await disconnect();
      }
    });

  });

  describe('disconnection', () => {
    it('should reject when disconnected', async () => {
      const { api, disconnect } = await context.createConnectedAPI();
      await disconnect();

      // The disconnected check runs before any tx deserialization, so any
      // non-empty hex string suffices to exercise this path.
      await expect(api.submitTransaction('00')).rejects.toMatchObject({
        code: ErrorCodes.Disconnected,
      });
    });
  });
};
