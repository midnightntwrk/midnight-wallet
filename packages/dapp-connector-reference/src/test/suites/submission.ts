/** Transaction submission test suite. Tests submitTransaction method. */

import { describe, expect, it, vi } from 'vitest';
import type { DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { ErrorCodes } from '../../errors.js';
import type { DappConnectorTestContext } from '../context.js';
import { containsString } from './_matchers.js';

/** Run transaction submission tests against the provided context. */
export const runSubmissionTests = (context: DappConnectorTestContext): void => {
  const { environment } = context;
  const { addresses, tokenTypes } = environment;

  describe('input validation', () => {
    it('should reject empty transaction hex', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.submitTransaction('')).rejects.toMatchObject({
          code: ErrorCodes.InvalidRequest,
          message: containsString('empty'),
        });
      } finally {
        await disconnect();
      }
    });

    it('should reject malformed hex', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.submitTransaction('not-valid-hex!')).rejects.toMatchObject({
          code: ErrorCodes.InvalidRequest,
          message: containsString('malformed'),
        });
      } finally {
        await disconnect();
      }
    });

    it('should reject invalid transaction bytes', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        await expect(api.submitTransaction('deadbeef')).rejects.toMatchObject({
          code: ErrorCodes.InvalidRequest,
          message: containsString('deserialize'),
        });
      } finally {
        await disconnect();
      }
    });
  });

  // NOTE: disconnected-state behavior for submitTransaction is covered centrally by disconnection.ts (which iterates
  // all ConnectedAPI methods via it.each), so we don't duplicate the check here.

  describe('successful submission', () => {
    it('should accept transaction returned by makeTransfer', async () => {
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
        const { tx } = await setup.wallets.alice.api.makeTransfer([
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
        ]);

        await expect(setup.wallets.alice.api.submitTransaction(tx)).resolves.toBeUndefined();
      } finally {
        await setup.disconnect();
      }
    });

    it('should accept transaction returned by balanceSealedTransaction', async () => {
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
        const inputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const outputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded },
        ];
        const imbalanced = await setup.wallets.alice.api.makeIntent(inputs, outputs, {
          intentId: 'random',
          payFees: false,
        });
        const balanced = await setup.wallets.alice.api.balanceSealedTransaction(imbalanced.tx);

        await expect(setup.wallets.alice.api.submitTransaction(balanced.tx)).resolves.toBeUndefined();
      } finally {
        await setup.disconnect();
      }
    });
  });

  // NOTE: submission-error propagation (e.g. network unavailable, ledger rejection) requires a backend with a clean
  // failure-injection hook. The simulator silently discards malformed txs without exposing the underlying ledger error,
  // so the test cannot distinguish "rejected by network" from other failures. Backends with controllable submission
  // outcomes should add a "should propagate submission errors" test in their own runner.
};
