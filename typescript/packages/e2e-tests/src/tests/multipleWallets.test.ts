/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { nativeToken, NetworkId } from '@midnight-ntwrk/zswap';
import { waitForSync } from './utils';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger';

/**
 * Syncing tests
 *
 * @group undeployed
 */

describe('Syncing', () => {
  const getFixture = useTestContainersFixture();
  const timeout = 240_000;
  const seeds = [
    '0000000000000000000000000000000000000000000000000000000000000042',
    'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82',
    '0000000000000000000000000000000000000000000000000000000000000043',
    '0000000000000000000000000000000000000000000000000000000000000041',
  ];

  const wallets: Array<Wallet & Resource> = [];
  let fixture: TestContainersFixture;

  beforeEach(async () => {
    await allure.step('Start multiple wallets', async function () {
      fixture = getFixture();
      const networkId = TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed;

      async function processSeeds(array: string[]) {
        for (let i = 0; i < array.length; i++) {
          await buildWallet(array[i], i);
        }
      }

      async function buildWallet(seed: string, index: number) {
        console.log(`Item at index ${index}: ${seed}`);
        wallets[index] = await WalletBuilder.buildFromSeed(
          fixture.getIndexerUri(),
          fixture.getIndexerWsUri(),
          fixture.getProverUri(),
          fixture.getNodeUri(),
          seed,
          networkId,
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
      try {
        await wallet.close();
      } catch (e: unknown) {
        if (typeof e === 'string') {
          logger.warn(e);
        } else if (e instanceof Error) {
          logger.warn(e.message);
        }
      }
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
