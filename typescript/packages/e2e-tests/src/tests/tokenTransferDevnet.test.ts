import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import {
  nativeToken,
  NetworkId,
  setNetworkId,
  UnprovenOffer,
  UnprovenOutput,
  UnprovenTransaction,
} from '@midnight-ntwrk/zswap';
import { createLogger, waitForFinalizedBalance, waitForPending, waitForSync, walletStateTrimmed } from './utils';
import * as crypto2 from 'crypto';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { exit } from 'node:process';
import path from 'node:path';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const logger = await createLogger(
  path.resolve(currentDir, '..', 'logs', 'tokenTransferDevnet', `${new Date().toISOString()}.log`),
);

/**
 * Tests performing a token transfer
 *
 * @group devnet
 */

describe('Token transfer', () => {
  if (process.env.SEED2 === undefined || process.env.SEED === undefined) {
    logger.info('SEED or SEED2 env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const seed = process.env.SEED2;
  const seedFunded = process.env.SEED;
  const timeout = 1_200_000;
  const outputValue = 1_000n;

  let sender: Wallet & Resource;
  let receiver: Wallet & Resource;
  let fixture: TestContainersFixture;

  beforeEach(async () => {
    fixture = getFixture();
    setNetworkId(TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed);
    const date = new Date();
    const hour = date.getHours();

    if (hour % 2 !== 0) {
      logger.info('Using SEED2 as receiver');
      sender = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seedFunded,
        'info',
      );

      receiver = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        'info',
      );
    } else {
      logger.info('Using SEED2 as sender');
      sender = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seed,
        'info',
      );

      receiver = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seedFunded,
        'info',
      );
    }

    sender.start();
    // wait before starting another wallet to evade issues with syncing
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    receiver.start();
  }, 10_000);

  afterEach(async () => {
    await sender.close();
    await receiver.close();
  });

  test(
    'Is working for valid transfer @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-8916', 'PM-8916');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer transaction');

      await Promise.all([waitForSync(sender), waitForSync(receiver)]);
      const initialState = await firstValueFrom(sender.state());
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);

      const initialState2 = await firstValueFrom(receiver.state());
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2}`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await sender.transferTransaction(outputsToCreate);
      const provenTx = await sender.proveTransaction(txToProve);
      const id = await sender.submitTransaction(provenTx);
      logger.info('Transaction id: ' + id);

      const pendingState = await waitForPending(sender);
      logger.info(walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(1);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      const finalState = await waitForFinalizedBalance(sender);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(finalState.availableCoins.length).toBeLessThanOrEqual(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBeLessThanOrEqual(initialState.coins.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]}`);

      const finalState2 = await waitForSync(receiver);
      logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      expect(finalState2.balances[nativeToken()] ?? 0n).toBe(initialBalance2 + outputValue);
      expect(finalState2.availableCoins.length).toBe(initialState2.availableCoins.length + 1);
      expect(finalState2.pendingCoins.length).toBe(0);
      expect(finalState2.coins.length).toBeGreaterThanOrEqual(initialState2.coins.length + 1);
      expect(finalState2.transactionHistory.length).toBeGreaterThanOrEqual(initialState2.transactionHistory.length + 1);
      logger.info(`Wallet 2: ${finalState2.balances[nativeToken()]}`);
    },
    timeout,
  );

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx fails on node',
    async () => {
      allure.tms('PM-8919', 'PM-8919');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid transaction');
      const initialState = await firstValueFrom(sender.state());
      const syncedState = await waitForSync(sender);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 25000000000000000n;

      const initialState2 = await firstValueFrom(receiver.state());
      const initialBalance2 = initialState2.balances[nativeToken()];
      if (initialBalance2 === undefined || initialBalance2 === 0n) {
        logger.info(`Waiting to receive tokens...`);
      }

      // const outputsToCreate = [
      //   {
      //     type: nativeToken(),
      //     amount: outputValue,
      //     receiverAddress: initialState2.address,
      //   },
      // ];
      const coin = {
        type: nativeToken(),
        value: outputValue,
        nonce: crypto2.randomBytes(32).toString('hex'),
      };
      const output = UnprovenOutput.new(coin, initialState.coinPublicKey, initialState.encryptionPublicKey);
      const offer = UnprovenOffer.fromOutput(output, nativeToken(), outputValue);
      const unprovenTx = new UnprovenTransaction(offer);
      const provenTx = await sender.proveTransaction({
        type: 'TransactionToProve',
        transaction: unprovenTx,
      });
      // const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      // const provenTx = await walletFunded.proveTransaction(txToProve);
      await expect(
        Promise.all([sender.submitTransaction(provenTx), sender.submitTransaction(provenTx)]),
      ).rejects.toThrow();
      // const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      // const provenTx = await walletFunded.proveTransaction(txToProve);
      // const id = await walletFunded.submitTransaction(provenTx);
      // logger.info('Transaction id: ' + id);

      // const pendingState = await waitForPending(walletFunded);
      // logger.info(pendingState);
      // expect(pendingState.balances[nativeToken()]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(2);

      const finalState = await waitForFinalizedBalance(sender);
      // const finalState = await waitForTxHistory(walletFunded, 2);
      expect(finalState.balances[nativeToken()]).toBe(balance);
      expect(finalState.availableCoins.length).toBe(5);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(5);
      expect(finalState.transactionHistory.length).toBe(1);

      // const finalState2 = await waitForFinalizedBalance(wallet2);
      // logger.info(finalState2);
      // expect(finalState2.balances[nativeToken()]).toBe(outputValue);
      // expect(finalState2.availableCoins.length).toBe(1);
      // expect(finalState2.pendingCoins.length).toBe(0);
      // expect(finalState2.coins.length).toBe(1);
      // expect(finalState2.transactionHistory.length).toBe(1);
    },
    timeout,
  );

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx does not get proved',
    async () => {
      allure.tms('PM-8917', 'PM-8917');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Transaction not proved');
      const syncedState = await waitForSync(sender);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      logger.info('Stopping proof server container..');
      await fixture.getProofServerContainer().stop({ timeout: 10_000 });

      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await sender.transferTransaction(outputsToCreate);
      await expect(sender.proveTransaction(txToProve)).rejects.toThrow();

      // const pendingState = await waitForPending(walletFunded);
      // logger.info(pendingState);
      // expect(pendingState.balances[nativeToken()]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(1);

      const finalState = await waitForFinalizedBalance(sender);
      expect(finalState).toMatchObject(syncedState);
      // expect(finalState.balances[nativeToken()]).toBe(initialBalance);
      // expect(finalState.availableCoins.length).toBe(5);
      // expect(finalState.pendingCoins.length).toBe(0);
      // expect(finalState.coins.length).toBe(5);
      // expect(finalState.transactionHistory.length).toBe(1);
    },
    timeout,
  );
});
