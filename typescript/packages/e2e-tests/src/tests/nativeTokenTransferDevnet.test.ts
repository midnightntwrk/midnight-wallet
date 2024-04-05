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
import { randomBytes } from 'node:crypto';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import path from 'node:path';
import { exit } from 'node:process';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const logger = await createLogger(
  path.resolve(currentDir, '..', 'logs', 'nativeTokenTransferDevnet', `${new Date().toISOString()}.log`),
);

/**
 * Tests performing a token transfer
 *
 * @group devnet
 */

describe('Token transfer', () => {
  if (process.env.NT_SEED === undefined || process.env.NT_SEED2 === undefined) {
    logger.info('NT_SEED or NT_SEED2 env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const receivingSeed = process.env.NT_SEED2;
  const fundedSeed = process.env.NT_SEED;
  const timeout = 1_200_000;
  const outputValue = 1n;
  let tokenTypeHash: string;

  let sender: Wallet & Resource;
  let receiver: Wallet & Resource;
  let fixture: TestContainersFixture;

  beforeEach(async () => {
    fixture = getFixture();
    setNetworkId(NetworkId.DevNet);
    switch (TestContainersFixture.deployment) {
      case 'ariadne-temp': {
        tokenTypeHash = '01000156199ea50f0118fe7b22eae708c057d9f051da51593c8fa1619d54774a4db665';
        break;
      }
      case 'ariadne-qa': {
        tokenTypeHash = '0100016fdbb01d1f075a0c78a279a089b59c15f9f5f0b6ae78abf5001e00ebded61004';
        break;
      }
      case 'devnet': {
        tokenTypeHash = '0100016a88f23d9a6764197790c290b29031367a64cb1c3f832c221efd32bf9701f825';
        break;
      }
      case 'qanet': {
        tokenTypeHash = '010001bbbe7ae865e85adface5606a728022920de5f7de78270b1dae71ad21d4f3c717';
        break;
      }
    }

    const date = new Date();
    const hour = date.getHours();
    if (hour % 2 !== 0) {
      logger.info('Using NT_SEED2 as receiver');
      sender = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        fundedSeed,
        'info',
      );

      receiver = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        receivingSeed,
        'info',
      );
    } else {
      logger.info('Using NT_SEED2 as sender');
      sender = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        receivingSeed,
        'info',
      );

      receiver = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        fundedSeed,
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
    'Is working for valid native token transfer @healthcheck @smoke',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-8933', 'PM-8933');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid native token transfer transaction');

      await Promise.all([waitForSync(sender), waitForSync(receiver)]);
      const initialState = await firstValueFrom(sender.state());
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.balances);
      const initialBalanceNative = initialState.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1: ${initialBalance} tDUST`);
      logger.info(`Wallet 1: ${initialBalanceNative} ${tokenTypeHash}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(initialState.availableCoins);

      const initialState2 = await firstValueFrom(receiver.state());
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      const initialBalanceNative2 = initialState2.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} tDUST`);
      logger.info(`Wallet 2: ${initialBalanceNative2} ${tokenTypeHash}`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: tokenTypeHash,
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
      expect(pendingState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance);
      expect(pendingState.balances[tokenTypeHash] ?? 0n).toBeLessThanOrEqual(initialBalanceNative - outputValue);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      const finalState = await waitForFinalizedBalance(sender);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance);
      expect(finalState.balances[tokenTypeHash] ?? 0n).toBe(initialBalanceNative - outputValue);
      expect(finalState.availableCoins.length).toBeLessThanOrEqual(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBeLessThanOrEqual(initialState.coins.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 1: ${finalState.balances[tokenTypeHash]} ${tokenTypeHash}`);

      const finalState2 = await waitForSync(receiver);
      logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      expect(finalState2.balances[nativeToken()] ?? 0n).toBe(initialBalance2);
      expect(finalState2.balances[tokenTypeHash] ?? 0n).toBe(initialBalanceNative2 + outputValue);
      expect(finalState2.availableCoins.length).toBe(initialState2.availableCoins.length + 1);
      expect(finalState2.pendingCoins.length).toBe(0);
      expect(finalState2.coins.length).toBeGreaterThanOrEqual(initialState2.coins.length + 1);
      expect(finalState2.transactionHistory.length).toBeGreaterThanOrEqual(initialState2.transactionHistory.length + 1);
      logger.info(`Wallet 2: ${finalState2.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 2: ${finalState2.balances[tokenTypeHash]} ${tokenTypeHash}`);
    },
    timeout,
  );

  test(
    'coins become available when native token tx fails on node',
    async () => {
      allure.tms('PM-8936', 'PM-8936');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid native token transaction');
      const initialState = await firstValueFrom(sender.state());
      const syncedState = await waitForSync(sender);
      const initialDustBalance = syncedState?.balances[nativeToken()] ?? 0n;
      const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

      const syncedState2 = await waitForSync(receiver);
      const initialDustBalance2 = syncedState2?.balances[nativeToken()] ?? 0n;
      const initialBalance2 = syncedState2?.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance2} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance2} ${tokenTypeHash}`);

      const coin = {
        type: tokenTypeHash,
        value: outputValue,
        nonce: randomBytes(32).toString('hex'),
      };
      const output = UnprovenOutput.new(coin, initialState.coinPublicKey, initialState.encryptionPublicKey);
      const offer = UnprovenOffer.fromOutput(output, nativeToken(), outputValue);
      const unprovenTx = new UnprovenTransaction(offer);
      const provenTx = await sender.proveTransaction({
        type: 'TransactionToProve',
        transaction: unprovenTx,
      });

      await expect(
        Promise.all([sender.submitTransaction(provenTx), sender.submitTransaction(provenTx)]),
      ).rejects.toThrow();

      const finalState = await waitForFinalizedBalance(sender);
      expect(finalState).toMatchObject(syncedState);
      expect(finalState.balances[nativeToken()]).toBe(initialDustBalance);
      expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
      expect(finalState.availableCoins.length).toBe(syncedState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(syncedState.coins.length);
      expect(finalState.transactionHistory.length).toBe(syncedState.transactionHistory.length);
    },
    timeout,
  );

  test(
    'coins become available when native token tx does not get proved',
    async () => {
      allure.tms('PM-8934', 'PM-8934');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Transaction not proved');
      const syncedState = await waitForSync(sender);
      const initialDustBalance = syncedState?.balances[nativeToken()] ?? 0n;
      const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

      logger.info('Stopping proof server container..');
      await fixture.getProofServerContainer().stop({ timeout: 10_000 });

      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate = [
        {
          type: tokenTypeHash,
          amount: outputValue,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await sender.transferTransaction(outputsToCreate);
      await expect(sender.proveTransaction(txToProve)).rejects.toThrow();

      const finalState = await waitForFinalizedBalance(sender);
      expect(finalState).toMatchObject(syncedState);
      expect(finalState.balances[nativeToken()]).toBe(initialDustBalance);
      expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
      expect(finalState.availableCoins.length).toBe(syncedState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(syncedState.coins.length);
      expect(finalState.transactionHistory.length).toBe(syncedState.transactionHistory.length);
    },
    timeout,
  );
});
