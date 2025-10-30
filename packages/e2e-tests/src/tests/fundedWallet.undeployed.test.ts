import { useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import * as utils from './utils.js';
import * as allure from 'allure-js-commons';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { logger } from './logger.js';

/**
 * Tests using a funded wallet
 *
 * @group undeployed
 */

describe('Funded wallet', () => {
  const getFixture = useTestContainersFixture();
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const fundedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seedFunded));
  const fundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seedFunded));
  const rawNativeTokenType = (ledger.nativeToken() as { tag: string; raw: string }).raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 120_000;

  let wallet: WalletFacade;

  beforeEach(async () => {
    await allure.step('Start a funded wallet', async function () {
      const fixture = getFixture();
      wallet = await utils.buildWalletFacade(seedFunded, fixture);
      await wallet.start(fundedSecretKey, fundedDustSecretKey);
    });
  });

  afterEach(async () => {
    await utils.closeWallet(wallet);
  });

  test(
    'Wallet balance for native token is 25B tDUST and there are two other token types',
    async () => {
      allure.tms('PM-8928', 'PM-8928');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      logger.info('Waiting for sync...');
      const state = await utils.waitForSyncFacade(wallet);
      expect(Object.keys(state.shielded.balances)).toHaveLength(3);
      expect(state?.shielded.balances[rawNativeTokenType]).toBe(2_500_000_000_000_000n);
      expect(state?.shielded.balances['0000000000000000000000000000000000000000000000000000000000000001']).toBe(
        500000000000000n,
      );
      expect(state?.shielded.balances['0000000000000000000000000000000000000000000000000000000000000002']).toBe(
        500000000000000n,
      );
      expect(state?.unshielded.balances).toHaveLength(1);
      expect(state?.unshielded.balances.get(unshieldedTokenRaw)).toBe(2_500_000_000_000_000n);
      expect(
        state?.unshielded.balances.get('0000000000000000000000000000000000000000000000000000000000000002'),
      ).toBeUndefined();
      expect(state?.dust.totalCoins).toHaveLength(5);
      expect(state?.dust.walletBalance(new Date())).toBe(12500000000000000000000000n);
    },
    timeout,
  );

  test(
    'funded wallet facade returns total coins',
    async () => {
      allure.tms('PM-8929', 'PM-8929');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await utils.waitForSyncFacade(wallet);
      const shieldedCoins = state.shielded.totalCoins;
      expect(shieldedCoins).toHaveLength(7);
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.coin.nonce))).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.coin.type === 'string')).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.coin.value === 'bigint')).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.commitment === 'string')).toBeTruthy();
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.commitment))).toBeTruthy();
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.nullifier))).toBeTruthy();
      shieldedCoins
        .filter((c) => (c.coin.type = '02000000000000000000000000000000000000000000000000000000000000000000'))
        .forEach((coin) => {
          expect(coin.coin.nonce).toBeDefined();
          expect(coin.coin.type).toHaveLength(68);
          expect(coin.coin.value).toBe(500000000000000n);
        });

      const unshieldedCoins = state.unshielded.totalCoins;
      expect(unshieldedCoins).toHaveLength(5);
      expect(utils.isArrayUnique(unshieldedCoins.map((c) => c.intentHash))).toBeTruthy();
      unshieldedCoins.forEach((c) => {
        expect(c.value).toBe(500000000000000n);
        expect(c.outputNo).toBe(0);
        expect(typeof c.owner).toBe('string');
        expect(typeof c.type).toBe('string');
        expect(c.registeredForDustGeneration).toBe(true);
      });

      const dustCoins = state.dust.totalCoins;
      expect(dustCoins).toHaveLength(5);
      expect(utils.isArrayUnique(dustCoins.map((c) => c.nonce))).toBeTruthy();
      expect(utils.isArrayUnique(dustCoins.map((c) => c.backingNight))).toBeTruthy();
      dustCoins.forEach((c) => {
        expect(c.initialValue).toBe(0n);
        expect(c.seq).toBe(0);
        expect(typeof c.owner).toBe('bigint');
        expect(typeof c.nonce).toBe('bigint');
        expect(typeof c.ctime).toBe('object');
      });
    },
    timeout,
  );
  test(
    'funded wallet facade eturns available coins',
    async () => {
      allure.tms('PM-8930', 'PM-8930');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - funded');
      const state = await utils.waitForSyncFacade(wallet);
      const shieldedCoins = state.shielded.availableCoins;
      expect(shieldedCoins).toHaveLength(7);
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.coin.nonce))).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.coin.type === 'string')).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.coin.value === 'bigint')).toBeTruthy();
      expect(shieldedCoins.every((c) => typeof c.commitment === 'string')).toBeTruthy();
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.commitment))).toBeTruthy();
      expect(utils.isArrayUnique(shieldedCoins.map((c) => c.nullifier))).toBeTruthy();
      shieldedCoins
        .filter((c) => (c.coin.type = '02000000000000000000000000000000000000000000000000000000000000000000'))
        .forEach((coin) => {
          expect(coin.coin.nonce).toBeDefined();
          expect(coin.coin.type).toHaveLength(68);
          expect(coin.coin.value).toBe(500000000000000n);
        });

      const unshieldedCoins = state.unshielded.availableCoins;
      expect(unshieldedCoins).toHaveLength(5);
      expect(utils.isArrayUnique(unshieldedCoins.map((c) => c.intentHash))).toBeTruthy();
      unshieldedCoins.forEach((c) => {
        expect(c.value).toBe(500000000000000n);
        expect(c.outputNo).toBe(0);
        expect(typeof c.owner).toBe('string');
        expect(typeof c.type).toBe('string');
        expect(c.registeredForDustGeneration).toBe(true);
      });

      const dustCoins = state.dust.availableCoins;
      expect(dustCoins).toHaveLength(5);
      expect(utils.isArrayUnique(dustCoins.map((c) => c.nonce))).toBeTruthy();
      expect(utils.isArrayUnique(dustCoins.map((c) => c.backingNight))).toBeTruthy();
      dustCoins.forEach((c) => {
        expect(c.initialValue).toBe(0n);
        expect(c.seq).toBe(0);
        expect(typeof c.owner).toBe('bigint');
        expect(typeof c.nonce).toBe('bigint');
        expect(typeof c.ctime).toBe('object');
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
      const state = await utils.waitForSyncFacade(wallet);
      expect(state.shielded.pendingCoins).toHaveLength(0);
      expect(state.unshielded.pendingCoins).toHaveLength(0);
      expect(state.dust.pendingCoins).toHaveLength(0);
    },
    timeout,
  );

  // test(
  //   'Wallet has one tx in tx history',
  //   async () => {
  //     allure.tms('PM-8932', 'PM-8932');
  //     allure.epic('Headless wallet');
  //     allure.feature('Wallet state');
  //     allure.story('Wallet state properties - funded');
  //     const state = await waitForSyncFacade(wallet);
  //     const txHistory = state.shielded.transactionHistory;
  //     expect(txHistory).toHaveLength(0);
  //     const expectedIdentifiers = new Map(
  //       Object.entries({
  //         '02000000000000000000000000000000000000000000000000000000000000000000': 2n * -100000000000000000n,
  //         '02000000000000000000000000000000000000000000000000000000000000000001': 2n * -20000000000000000n,
  //         '02000000000000000000000000000000000000000000000000000000000000000002': 2n * -20000000000000000n,
  //       }),
  //     );
  //     // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  //     txHistory.forEach((tx) => {
  //       // deltas are doubled as node team send genesis funds to 2 sets of seeds (legacy key derivation + new key derivation)
  //       expect(tx.guaranteedOffer?.deltas).toStrictEqual(expectedIdentifiers);
  //       expect(tx.identifiers()).not.toHaveLength(0);
  //     });
  //   },
  //   timeout,
  // );
});
