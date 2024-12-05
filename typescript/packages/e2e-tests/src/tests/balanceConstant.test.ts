import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { nativeToken, NetworkId } from '@midnight-ntwrk/zswap';
import { closeWallet, provideWallet, saveState, waitForSync } from './utils';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger';
import { exit } from 'node:process';

/**
 * Tests checking balance is constant
 *
 * @group devnet
 * @group testnet
 */

describe('Balance constant', () => {
  if (process.env['SEED_STABLE'] === undefined) {
    logger.info('SEED_STABLE not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const seed = process.env['SEED_STABLE'];
  const nativeTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';
  const nativeTokenHash2 = '02000000000000000000000000000000000000000000000000000000000000000002';
  const expectedDustBalance = 100_000_000n;
  const expectedTokenOneBalance = 25n;
  const expectedTokenTwoBalance = 50n;
  const filename = `stable-${seed.substring(seed.length - 7)}-${TestContainersFixture.deployment}.state`;
  const timeout = 1_800_000;

  let wallet: Wallet & Resource;
  let restoredWallet: Wallet & Resource;

  beforeEach(async () => {
    const fixture = getFixture();
    let networkId: NetworkId;
    switch (TestContainersFixture.network) {
      case 'undeployed':
        networkId = NetworkId.Undeployed;
        break;
      case 'devnet':
        networkId = NetworkId.DevNet;
        break;
      case 'testnet':
        networkId = NetworkId.TestNet;
        break;
    }

    wallet = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      seed,
      networkId,
      'info',
    );

    restoredWallet = await provideWallet(filename, seed, networkId, fixture);
  }, timeout);

  afterEach(async () => {
    await closeWallet(wallet);
  }, timeout);

  afterAll(async () => {
    await saveState(restoredWallet, filename);
    await closeWallet(restoredWallet);
    await closeWallet(wallet);
  }, timeout);

  test(
    'Balance is constant when syncing from 0 @healthcheck',
    async () => {
      allure.tag('healthcheck');
      allure.tms('PM-13614', 'PM-13614');
      allure.epic('Headless wallet');
      allure.feature('Balance');
      allure.story('Balance constant when syncing from 0');

      wallet.start();
      const syncedState = await waitForSync(wallet);
      expect(syncedState.balances[nativeToken()] ?? 0n).toBe(expectedDustBalance);
      expect(syncedState.balances[nativeTokenHash] ?? 0n).toBe(expectedTokenOneBalance);
      expect(syncedState.balances[nativeTokenHash2] ?? 0n).toBe(expectedTokenTwoBalance);
      expect(syncedState.availableCoins.length).toBe(3);
      expect(syncedState.pendingCoins.length).toBe(0);
      expect(syncedState.coins.length).toBe(3);
      expect(syncedState.transactionHistory.length).toBe(2);
    },
    timeout,
  );

  test(
    'Balance is constant when syncing from a restored state @healthcheck',
    async () => {
      allure.tag('healthcheck');
      allure.tms('PM-13615', 'PM-13615');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Balance constant');

      restoredWallet.start();
      const syncedState = await waitForSync(restoredWallet);
      expect(syncedState.balances[nativeToken()] ?? 0n).toBe(expectedDustBalance);
      expect(syncedState.balances[nativeTokenHash] ?? 0n).toBe(expectedTokenOneBalance);
      expect(syncedState.balances[nativeTokenHash2] ?? 0n).toBe(expectedTokenTwoBalance);
      expect(syncedState.availableCoins.length).toBe(3);
      expect(syncedState.pendingCoins.length).toBe(0);
      expect(syncedState.coins.length).toBe(3);
      expect(syncedState.transactionHistory.length).toBe(2);
    },
    timeout,
  );
});
