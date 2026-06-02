/** Balance retrieval test suite. Tests getShieldedBalances, getUnshieldedBalances, and getDustBalance. */

import { describe, expect, it, vi } from 'vitest';
import type { DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import type { DappConnectorTestContext } from '../context.js';

/** The simulator backend mints in raw subunits (6 decimals). Tests pass token amounts; balances come back in subunits. */
const TOKEN_DECIMALS = 10n ** 6n;
const subunits = (tokens: bigint): bigint => tokens * TOKEN_DECIMALS;

/** Run balance retrieval tests against the provided context. */
export const runBalanceTests = (context: DappConnectorTestContext): void => {
  const { environment } = context;

  describe('getShieldedBalances', () => {
    it('should return a frozen Record with string keys and non-negative bigint values', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const balances = await api.getShieldedBalances();

        expect(Object.isFrozen(balances)).toBe(true);
        expect(
          Object.entries(balances).every(([k, v]) => typeof k === 'string' && typeof v === 'bigint' && v >= 0n),
        ).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should return balances matching what the wallet was funded with', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;

      vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

      const standard = context.environment.tokenTypes.standard;
      const alternate = context.environment.tokenTypes.alternate;
      const setup = await setupWallets({
        alice: { shielded: { [standard]: 1500n, [alternate]: 800n } },
      });

      try {
        const balances = await setup.wallets.alice.api.getShieldedBalances();
        expect(balances).toEqual({ [standard]: subunits(1500n), [alternate]: subunits(800n) });
      } finally {
        await setup.disconnect();
      }
    });

    it('should report only available balance (exclude UTXOs locked by a pending makeTransfer)', async () => {
      // Spec: "Wallet must ensure that balances reported in `getShieldedBalances` and `getUnshieldedBalances` methods
      // are available balances". After a successful makeTransfer the consumed UTXO is pending, so its value must drop
      // from the reported balance until the tx settles or is discarded.
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const standard = environment.tokenTypes.standard;
      // Two equal-sized UTXOs so coin selection necessarily locks exactly one.
      const setup = await setupWallets({
        alice: {
          shielded: { [standard]: [10_000n, 10_000n] },
          unshielded: { [environment.tokenTypes.night]: 100_000n },
        },
      });

      try {
        const before = await setup.wallets.alice.api.getShieldedBalances();
        expect(before).toEqual({ [standard]: subunits(20_000n) });

        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: standard, value: 100n, recipient: environment.addresses.shielded },
        ];
        await setup.wallets.alice.api.makeTransfer(desiredOutputs);

        const after = await setup.wallets.alice.api.getShieldedBalances();
        // The locked UTXO (10_000) drops out of the reported balance; the unconfirmed change isn't yet available either.
        expect(after).toEqual({ [standard]: subunits(10_000n) });
      } finally {
        await setup.disconnect();
      }
    });

    it('should return empty record when the wallet has no shielded funding', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;

      vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

      const setup = await setupWallets({
        // alice has no shielded; bob has shielded funding so the genesis isn't empty
        alice: {},
        bob: { shielded: { [context.environment.tokenTypes.standard]: 100n } },
      });

      try {
        const balances = await setup.wallets.alice.api.getShieldedBalances();
        expect(balances).toEqual({});
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('getUnshieldedBalances', () => {
    it('should return a frozen Record with string keys and non-negative bigint values', async () => {
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        const balances = await api.getUnshieldedBalances();

        expect(Object.isFrozen(balances)).toBe(true);
        expect(
          Object.entries(balances).every(([k, v]) => typeof k === 'string' && typeof v === 'bigint' && v >= 0n),
        ).toBe(true);
      } finally {
        await disconnect();
      }
    });

    it('should return balances matching what the wallet was funded with', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;

      vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

      const setup = await setupWallets({
        alice: { shielded: { [context.environment.tokenTypes.standard]: 1n } },
      });

      try {
        const balances = await setup.wallets.alice.api.getUnshieldedBalances();
        // No unshielded funding -> empty record (Night is the only relevant unshielded type and it's zero here)
        expect(balances[setup.tokenTypes.night] ?? 0n).toBe(0n);
      } finally {
        await setup.disconnect();
      }
    });

    it('should report Night exactly equal to funding (registration tx pays fees in Dust, not Night)', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;

      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: { unshielded: { [context.environment.tokenTypes.night]: 100_000n } },
      });

      try {
        const balances = await setup.wallets.alice.api.getUnshieldedBalances();
        expect(balances).toEqual({ [setup.tokenTypes.night]: subunits(100_000n) });
      } finally {
        await setup.disconnect();
      }
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

    it('should report a non-zero Dust cap once Night is funded and registered', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;

      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: { unshielded: { [context.environment.tokenTypes.night]: 100_000n } },
      });

      try {
        const dustBalance = await setup.wallets.alice.api.getDustBalance();
        expect(dustBalance.cap).toBeGreaterThan(0n);
      } finally {
        await setup.disconnect();
      }
    });

    it('should report zero Dust cap when the wallet has no Night', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;

      vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

      const setup = await setupWallets({
        alice: { shielded: { [context.environment.tokenTypes.standard]: 100n } },
      });

      try {
        const dustBalance = await setup.wallets.alice.api.getDustBalance();
        expect(dustBalance.cap).toBe(0n);
        expect(dustBalance.balance).toBe(0n);
      } finally {
        await setup.disconnect();
      }
    });
  });
};
