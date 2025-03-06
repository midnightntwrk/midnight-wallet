import { WalletBuilder, Resource } from '@midnight-ntwrk/wallet_built';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { nativeToken, NetworkId } from '@midnight-ntwrk/zswap';
import { firstValueFrom } from 'rxjs';
import { logger } from './logger';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { closeWallet, waitForSync } from './utils';

/**
 * Syncing tests
 *
 * @group undeployed
 */

describe('Syncing', () => {
  const getFixture = useTestContainersFixture();
  const timeout = 240_000;
  const seeds = [
    '0000000000000000000000000000000000000000000000000000000000000002',
    'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82',
    '0000000000000000000000000000000000000000000000000000000000000001',
    '0000000000000000000000000000000000000000000000000000000000000000',
  ];

  const wallets: Array<Wallet & Resource> = [];
  let fixture: TestContainersFixture;

  beforeEach(async () => {
    await allure.step('Start multiple wallets', async function () {
      fixture = getFixture();

      async function processSeeds(array: string[]) {
        for (let i = 0; i < array.length; i++) {
          await buildWallet(array[i], i);
        }
      }

      async function buildWallet(seed: string, index: number) {
        console.log(`Item at index ${index}: ${seed}`);
        wallets[index] = await WalletBuilder.build(
          fixture.getIndexerUri(),
          fixture.getIndexerWsUri(),
          fixture.getProverUri(),
          fixture.getNodeUri(),
          seed,
          NetworkId.Undeployed,
          'info',
        );
      }

      await processSeeds(seeds);

      for (const wallet of wallets) {
        wallet.start();
      }
    });
  });

  afterEach(async () => {
    for (const wallet of wallets) {
      await closeWallet(wallet);
    }
  });

  test(
    'Syncing is working for multiple wallets concurrently',
    async () => {
      allure.tms('PM-10974', 'PM-10974');
      allure.epic('Headless wallet');
      allure.feature('Syncing');
      allure.story('Syncing wallets concurrently');

      const promises = wallets.map((wallet) => {
        return waitForSync(wallet);
      });

      await Promise.all(promises);

      wallets.forEach(async (wallet, index) => {
        const syncedState = await firstValueFrom(wallet.state());
        logger.info(`Wallet ${index}: ${syncedState.balances[nativeToken() ?? 0n]}`);
        expect(syncedState.syncProgress?.synced).toBeGreaterThan(0);
      });
    },
    timeout,
  );
});
