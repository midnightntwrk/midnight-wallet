/** Balancing test suite. Tests balanceUnsealedTransaction and balanceSealedTransaction methods. */

import { describe, expect, it, vi } from 'vitest';
import type { BalancingTestContext } from '../context.js';

vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });

/** Run balancing tests against the provided context. */
export const runBalancingTests = (context: BalancingTestContext): void => {
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

    describe('input validation', () => {
      it('should reject malformed hex string', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.balanceUnsealedTransaction('not-valid-hex')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('malformed') as unknown as string,
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject empty hex string', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.balanceUnsealedTransaction('')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('empty') as unknown as string,
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

    describe('input validation', () => {
      it('should reject malformed hex string', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.balanceSealedTransaction('not-valid-hex')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('malformed') as unknown as string,
          });
        } finally {
          await disconnect();
        }
      });

      it('should reject empty hex string', async () => {
        const { api, disconnect } = await context.createConnectedAPI();

        try {
          await expect(api.balanceSealedTransaction('')).rejects.toMatchObject({
            code: 'InvalidRequest',
            reason: expect.stringContaining('empty') as unknown as string,
          });
        } finally {
          await disconnect();
        }
      });
    });
  });
};
