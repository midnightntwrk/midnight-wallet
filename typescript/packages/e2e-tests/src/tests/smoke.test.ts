/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet_built';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { nativeToken, NetworkId } from '@midnight-ntwrk/zswap';
import {
  compareStates,
  waitForFinalizedBalance,
  waitForPending,
  waitForSync,
  waitForTxInHistory,
  walletStateTrimmed,
} from './utils';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger';

/**
 * Smoke tests
 *
 * @group undeployed
 */

describe('Token transfer', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000042';
  const timeout = 240_000;
  const outputValue = 1_000n;

  let walletFunded: Wallet & Resource;
  let wallet2: Wallet & Resource;
  let fixture: TestContainersFixture;

  beforeEach(async () => {
    await allure.step('Start two wallets', async function () {
      fixture = getFixture();
      const networkId = TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed;

      walletFunded = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seedFunded,
        networkId,
        'info',
      );

      wallet2 = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        networkId,
        'info',
      );

      walletFunded.start();
      wallet2.start();
    });
  });

  afterEach(async () => {
    try {
      await walletFunded.close();
    } catch (e: unknown) {
      if (typeof e === 'string') {
        logger.warn(e);
      } else if (e instanceof Error) {
        logger.warn(e.message);
      }
    }
    try {
      await wallet2.close();
    } catch (e: unknown) {
      if (typeof e === 'string') {
        logger.warn(e);
      } else if (e instanceof Error) {
        logger.warn(e.message);
      }
    }
  });

  test(
    'Is working for valid transfer @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('heanthcheck');
      allure.tms('PM-8916', 'PM-8916');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer transaction');

      const initialState = await firstValueFrom(walletFunded.state());
      const initialBalance = initialState.balances[nativeToken()];
      if (initialBalance === undefined || initialBalance === 0n) {
        logger.info(`Waiting to receive tokens...`);
        await waitForSync(walletFunded);
      }
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      const balance = 25000000000000000n;

      const initialState2 = await firstValueFrom(wallet2.state());
      const initialBalance2 = initialState2.balances[nativeToken()];
      if (initialBalance2 === undefined || initialBalance2 === 0n) {
        logger.info(`Waiting to receive tokens...`);
      }
      logger.info(`Wallet 2: ${initialBalance2}`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      const provenTx = await walletFunded.proveTransaction(txToProve);
      const txId = await walletFunded.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await waitForPending(walletFunded);
      logger.info(walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[nativeToken()]).toBe(20000000000000000n);
      expect(pendingState.availableCoins.length).toBe(6);
      expect(pendingState.pendingCoins.length).toBe(1);
      expect(pendingState.coins.length).toBe(7);
      expect(pendingState.transactionHistory.length).toBe(1);

      const finalState = await waitForFinalizedBalance(walletFunded);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      expect(finalState.balances[nativeToken()]).toBeLessThan(balance - outputValue);
      expect(finalState.availableCoins.length).toBe(7);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(7);
      expect(finalState.transactionHistory.length).toBe(2);

      await waitForTxInHistory(txId, wallet2);
      const finalState2 = await waitForSync(wallet2);
      logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.balances[nativeToken()]}`);
      expect(finalState2.balances[nativeToken()]).toBe(outputValue);
      expect(finalState2.availableCoins.length).toBe(1);
      expect(finalState2.pendingCoins.length).toBe(0);
      expect(finalState2.coins.length).toBe(1);
      expect(finalState2.transactionHistory.length).toBe(1);
    },
    timeout,
  );

  test(
    'Wallet state can be serialized and then restored',
    async () => {
      allure.tag('smoke');
      allure.tms('PM-9084', 'PM-9084');
      allure.epic('Headless wallet');
      allure.feature('Wallet state');
      allure.story('Wallet state properties - serialize');
      const fixture = getFixture();
      const state = await waitForSync(walletFunded);
      const serialized = await walletFunded.serializeState();
      const stateObject = JSON.parse(serialized);
      expect(stateObject.txHistory).toHaveLength(1);
      expect(stateObject.offset).toBeGreaterThan(0);
      expect(typeof stateObject.state).toBe('string');
      expect(stateObject.state).toBeTruthy();
      await walletFunded.close();

      const restoredWallet = await WalletBuilder.restore(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        serialized,
        'info',
      );
      restoredWallet.start();
      const newState = await waitForSync(restoredWallet);
      compareStates(newState, state);
      expect(newState.syncProgress?.total).toBeGreaterThanOrEqual(state.syncProgress?.total ?? 0n);
      await restoredWallet.close();
    },
    timeout,
  );
});

describe('Wallet building', () => {
  const getFixture = useTestContainersFixture();
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000042';
  const timeout = 60_000;

  let walletFunded: Wallet & Resource;
  let fixture: TestContainersFixture;

  afterEach(async () => {
    try {
      await walletFunded.close();
    } catch (e: unknown) {
      if (typeof e === 'string') {
        logger.warn(e);
      } else if (e instanceof Error) {
        logger.warn(e.message);
      }
    }
  });

  test(
    'Is working if discardTxHistory not defined @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-11088', 'PM-11088');
      allure.epic('Headless wallet');
      allure.feature('Wallet building');
      allure.story('Building with discardTxHistory undefined');

      await allure.step('Start a wallet', async function () {
        fixture = getFixture();
        const networkId = TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed;

        walletFunded = await WalletBuilder.buildFromSeed(
          fixture.getIndexerUri(),
          fixture.getIndexerWsUri(),
          fixture.getProverUri(),
          fixture.getNodeUri(),
          seedFunded,
          networkId,
          'info',
        );

        walletFunded.start();
      });
      logger.info(`Waiting to receive tokens...`);
      const syncedState = await waitForSync(walletFunded);
      logger.info(`Wallet 1 balance: ${syncedState.balances[nativeToken()]}`);
      expect(syncedState.transactionHistory).toHaveLength(1);
    },
    timeout,
  );

  test(
    'Is working if discardTxHistory is set to false @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-11090', 'PM-11090');
      allure.epic('Headless wallet');
      allure.feature('Wallet building');
      allure.story('Building with discardTxHistory set to false');

      await allure.step('Start a wallet', async function () {
        fixture = getFixture();
        const networkId = TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed;

        walletFunded = await WalletBuilder.buildFromSeed(
          fixture.getIndexerUri(),
          fixture.getIndexerWsUri(),
          fixture.getProverUri(),
          fixture.getNodeUri(),
          seedFunded,
          networkId,
          'info',
          false,
        );

        walletFunded.start();
      });

      logger.info(`Waiting to receive tokens...`);
      const syncedState = await waitForSync(walletFunded);
      logger.info(`Wallet 1 balance: ${syncedState.balances[nativeToken()]}`);
      expect(syncedState.transactionHistory).toHaveLength(1);
    },
    timeout,
  );

  test(
    'Is working if discardTxHistory is set to true @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-11091', 'PM-11091');
      allure.epic('Headless wallet');
      allure.feature('Wallet building');
      allure.story('Building with discardTxHistory set to true');

      await allure.step('Start a wallet', async function () {
        fixture = getFixture();
        const networkId = TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed;

        walletFunded = await WalletBuilder.buildFromSeed(
          fixture.getIndexerUri(),
          fixture.getIndexerWsUri(),
          fixture.getProverUri(),
          fixture.getNodeUri(),
          seedFunded,
          networkId,
          'info',
          true,
        );

        walletFunded.start();
      });

      logger.info(`Waiting to receive tokens...`);
      const syncedState = await waitForSync(walletFunded);
      logger.info(`Wallet 1 balance: ${syncedState.balances[nativeToken()]}`);
      expect(syncedState.transactionHistory).toHaveLength(0);
    },
    timeout,
  );
});
