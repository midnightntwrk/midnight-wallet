import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { exit } from 'node:process';
import * as allure from 'allure-js-commons';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';

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
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const nativeTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';
  const nativeTokenHash2 = '02000000000000000000000000000000000000000000000000000000000000000002';
  const expectedShieldedBalance = 100_000_000n;
  const expectedTokenOneBalance = 25n;
  const expectedTokenTwoBalance = 50n;
  const expectedUnshieldedBalance = 100_000_000n;
  const expectedDustBalance = expectedShieldedBalance;
  const filename = `stable-${seed.substring(seed.length - 7)}-${TestContainersFixture.network}.state`;
  const syncTimeout = TestContainersFixture.network === 'testnet' ? 3_000_000 : 1_800_000;
  const shieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seed));

  let walletFacade: WalletFacade;

  beforeEach(async () => {
    const fixture = getFixture();

    walletFacade = await utils.buildWalletFacade(seed, fixture);
    await walletFacade.start(shieldedSecretKey, dustSecretKey);
  }, syncTimeout);

  afterEach(async () => {
    await utils.saveState(walletFacade, filename);
    await utils.closeWallet(walletFacade);
  });

  test(
    'Balance is constant when syncing from 0 @healthcheck',
    async () => {
      allure.tag('healthcheck');
      allure.tms('PM-13614', 'PM-13614');
      allure.epic('Headless wallet');
      allure.feature('Balance');
      allure.story('Balance constant when syncing from 0');

      const syncedState = await utils.waitForSyncFacade(walletFacade);
      // logger.info(walletStateTrimmed(syncedState));
      expect(syncedState.shielded.balances[shieldedTokenRaw] ?? 0n).toBe(expectedShieldedBalance);
      expect(syncedState.shielded.balances[nativeTokenHash] ?? 0n).toBe(expectedTokenOneBalance);
      expect(syncedState.shielded.balances[nativeTokenHash2] ?? 0n).toBe(expectedTokenTwoBalance);
      expect(syncedState.unshielded.balances.get(unshieldedTokenRaw) ?? 0n).toBe(expectedUnshieldedBalance);
      expect(syncedState.dust.walletBalance(new Date())).toBe(expectedDustBalance);
      expect(syncedState.shielded.availableCoins.length).toBeGreaterThanOrEqual(3);
      expect(syncedState.shielded.pendingCoins.length).toBe(0);
      expect(syncedState.shielded.totalCoins).toBeGreaterThanOrEqual(3);
      expect(syncedState.shielded.transactionHistory.length).toBeGreaterThanOrEqual(2);
    },
    syncTimeout,
  );

  test(
    'Balance is constant when syncing from a restored state @healthcheck',
    async () => {
      allure.tag('healthcheck');
      allure.tms('PM-13615', 'PM-13615');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Balance constant');

      const syncedState = await utils.waitForSyncFacade(walletFacade);
      expect(syncedState.shielded.balances[shieldedTokenRaw] ?? 0n).toBe(expectedDustBalance);
      expect(syncedState.shielded.balances[nativeTokenHash] ?? 0n).toBe(expectedTokenOneBalance);
      expect(syncedState.shielded.balances[nativeTokenHash2] ?? 0n).toBe(expectedTokenTwoBalance);
      expect(syncedState.unshielded.balances.get(unshieldedTokenRaw) ?? 0n).toBe(expectedUnshieldedBalance);
      expect(syncedState.dust.walletBalance(new Date())).toBe(expectedDustBalance);
      expect(syncedState.shielded.availableCoins.length).toBeGreaterThanOrEqual(3);
      expect(syncedState.shielded.pendingCoins.length).toBe(0);
      expect(syncedState.shielded.totalCoins).toBeGreaterThanOrEqual(3);
      expect(syncedState.shielded.transactionHistory.length).toBeGreaterThanOrEqual(2);
    },
    syncTimeout,
  );
});
