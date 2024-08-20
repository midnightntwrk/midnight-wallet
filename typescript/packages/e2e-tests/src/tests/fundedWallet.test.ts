import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { nativeToken, NetworkId } from '@midnight-ntwrk/zswap';
import { waitForSync } from './utils';
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
      const networkId = TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed;

      wallet = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seedFunded,
        networkId,
        'info',
      );
      wallet.start();
    });
  });

  afterEach(async () => {
    await wallet.close();
  });

  test(
    'Wallet balance for native token is 25B tDUST and there are no other token types',
    async () => {
      allure.tms('PM-8928', 'PM-8928');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      expect(Object.keys(state.balances)).toHaveLength(1);
      const balance = state?.balances[nativeToken()] ?? 0n;
      expect(balance).toBe(25_000_000_000_000_000n);
    },
    timeout,
  );

  test(
    'Wallet has 5 coins',
    async () => {
      allure.tms('PM-8929', 'PM-8929');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      const coins = state?.coins;
      expect(coins).toHaveLength(5);
      coins.forEach((coin) => {
        expect(coin.type).toBe('0100000000000000000000000000000000000000000000000000000000000000000000');
        expect(coin.value).toBe(5000000000000000n);
      });
    },
    timeout,
  );

  test(
    'Wallet has 5 available coins',
    async () => {
      allure.tms('PM-8930', 'PM-8930');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await waitForSync(wallet);
      const coins = state?.availableCoins;
      expect(coins).toHaveLength(5);
      coins.forEach((coin) => {
        expect(coin.type).toBe('0100000000000000000000000000000000000000000000000000000000000000000000');
        expect(coin.value).toBe(5000000000000000n);
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
          '0100000000000000000000000000000000000000000000000000000000000000000000': -50000000000000000n,
        });
        expect(tx.identifiers).not.toHaveLength(0);
      });
    },
    timeout,
  );
});
