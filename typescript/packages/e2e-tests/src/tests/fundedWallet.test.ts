import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { useTestContainersFixture } from './test-fixture';
import { NetworkId, nativeToken } from '@midnight-ntwrk/zswap';
import { closeWallet, isArrayUnique, waitForSync } from './utils';
import { Wallet } from '@midnight-ntwrk/wallet-api';

/**
 * Tests using a funded wallet
 *
 * @group undeployed
 */

describe('Funded wallet', () => {
  const getFixture = useTestContainersFixture();
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000042';
  const timeout = 120_000;

  let wallet: Wallet & Resource;

  beforeEach(async () => {
    await allure.step('Start a funded wallet', async function () {
      const fixture = getFixture();

      wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seedFunded,
        NetworkId.Undeployed,
        'info',
      );
      wallet.start();
    });
  });

  afterEach(async () => {
    await closeWallet(wallet);
  });

  test(
    'Wallet balance for native token is 25B tDUST and there are two other token types',
    async () => {
      allure.tms('PM-8928', 'PM-8928');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      expect(Object.keys(state.balances)).toHaveLength(3);
      expect(state?.balances[nativeToken()]).toBe(25_000_000_000_000_000n);
      const balanceNativeTokens = 5_000_000_000_000_000n;
      const nativeTokenHash1 = '02000000000000000000000000000000000000000000000000000000000000000001';
      const nativeTokenHash2 = '02000000000000000000000000000000000000000000000000000000000000000002';
      expect(state?.balances[nativeTokenHash1]).toBe(balanceNativeTokens);
      expect(state?.balances[nativeTokenHash2]).toBe(balanceNativeTokens);
    },
    timeout,
  );

  test(
    'Wallet has 7 coins',
    async () => {
      allure.tms('PM-8929', 'PM-8929');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      const coins = state?.coins;
      expect(coins).toHaveLength(7);
      expect(isArrayUnique(coins.map((c) => c.mt_index))).toBeTruthy();
      expect(isArrayUnique(coins.map((c) => c.nonce))).toBeTruthy();
      coins
        .filter((c) => (c.type = '02000000000000000000000000000000000000000000000000000000000000000000'))
        .forEach((coin) => {
          expect(coin.value).toBe(5000000000000000n);
        });
    },
    timeout,
  );

  test(
    'Wallet has 7 available coins',
    async () => {
      allure.tms('PM-8930', 'PM-8930');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      const coins = state?.availableCoins;
      expect(coins).toHaveLength(7);
      expect(isArrayUnique(coins.map((c) => c.mt_index))).toBeTruthy();
      expect(isArrayUnique(coins.map((c) => c.nonce))).toBeTruthy();
      coins
        .filter((c) => (c.type = '02000000000000000000000000000000000000000000000000000000000000000000'))
        .forEach((coin) => {
          expect(coin.value).toBe(5000000000000000n);
        });
    },
    timeout,
  );

  test(
    'Wallet has 7 nullifiers',
    async () => {
      allure.tms('PM-12950', 'PM-12950');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      const nullifiers = state?.nullifiers;
      expect(nullifiers).toHaveLength(7);
      nullifiers.forEach((n) => {
        expect(n).toMatch(/^[0-9a-f]{64}$/);
      });
    },
    timeout,
  );

  test(
    'Wallet has no pending coins',
    async () => {
      allure.tms('PM-8931', 'PM-8931');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      const coins = state?.pendingCoins;
      expect(coins).toHaveLength(0);
    },
    timeout,
  );

  test(
    'Wallet has one tx in tx history',
    async () => {
      allure.tms('PM-8932', 'PM-8932');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      const txHistory = state?.transactionHistory;
      expect(txHistory).toHaveLength(1);
      txHistory.forEach((tx) => {
        expect(tx.applyStage).toBe('SucceedEntirely');
        expect(tx.deltas).toStrictEqual({
          '02000000000000000000000000000000000000000000000000000000000000000000': -100000000000000000n,
          '02000000000000000000000000000000000000000000000000000000000000000001': -20000000000000000n,
          '02000000000000000000000000000000000000000000000000000000000000000002': -20000000000000000n,
        });
        expect(tx.identifiers).not.toHaveLength(0);
      });
    },
    timeout,
  );
});
