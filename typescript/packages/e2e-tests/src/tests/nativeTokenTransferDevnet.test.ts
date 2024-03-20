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

  let fundedWallet: Wallet & Resource;
  let receivingWallet: Wallet & Resource;
  let fixture: TestContainersFixture;

  beforeEach(async () => {
    fixture = getFixture();
    setNetworkId(NetworkId.DevNet);
    switch (TestContainersFixture.deployment) {
      case 'topaz': {
        tokenTypeHash = '010001459a2973cc16b54b106afd8045501974c0ff40f49b3faf0134178c0c721c5c59';
        break;
      }
      case 'jade': {
        tokenTypeHash = '0100017b41a104b2bc7b0d80ebbbce42a92510846e95f7d304643d73a6d4b86c2e7961';
        break;
      }
      case 'ruby': {
        tokenTypeHash = '010001efcae6abf93eb3aa5acef6e0756a22ee3bd3fa20509d8874954838f28cba2f31';
        break;
      }
    }

    fundedWallet = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      fundedSeed,
      'info',
    );

    receivingWallet = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      receivingSeed,
      'info',
    );

    fundedWallet.start();
    receivingWallet.start();
  });

  afterEach(async () => {
    await fundedWallet.close();
    await receivingWallet.close();
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

      await Promise.all([waitForSync(fundedWallet), waitForSync(receivingWallet)]);
      const initialState = await firstValueFrom(fundedWallet.state());
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.balances);
      const initialBalanceNative = initialState.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1: ${initialBalance} tDUST`);
      logger.info(`Wallet 1: ${initialBalanceNative} ${tokenTypeHash}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(initialState.availableCoins);

      const initialState2 = await firstValueFrom(receivingWallet.state());
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
      const txToProve = await fundedWallet.transferTransaction(outputsToCreate);
      const provenTx = await fundedWallet.proveTransaction(txToProve);
      const id = await fundedWallet.submitTransaction(provenTx);
      logger.info('Transaction id: ' + id);

      const pendingState = await waitForPending(fundedWallet);
      logger.info(walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance);
      expect(pendingState.balances[tokenTypeHash] ?? 0n).toBe(0n);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBe(2);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      const finalState = await waitForFinalizedBalance(fundedWallet);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance);
      expect(finalState.balances[tokenTypeHash] ?? 0n).toBe(initialBalanceNative - outputValue);
      expect(finalState.availableCoins.length).toBe(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(initialState.coins.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 1: ${finalState.balances[tokenTypeHash]} ${tokenTypeHash}`);

      const finalState2 = await waitForFinalizedBalance(receivingWallet);
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
      const initialState = await firstValueFrom(fundedWallet.state());
      const syncedState = await waitForSync(fundedWallet);
      const initialDustBalance = syncedState?.balances[nativeToken()] ?? 0n;
      const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

      const syncedState2 = await waitForSync(receivingWallet);
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
      const provenTx = await fundedWallet.proveTransaction({
        type: 'TransactionToProve',
        transaction: unprovenTx,
      });

      await expect(
        Promise.all([fundedWallet.submitTransaction(provenTx), fundedWallet.submitTransaction(provenTx)]),
      ).rejects.toThrow();

      const finalState = await waitForFinalizedBalance(fundedWallet);
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
      const syncedState = await waitForSync(fundedWallet);
      const initialDustBalance = syncedState?.balances[nativeToken()] ?? 0n;
      const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

      logger.info('Stopping proof server container..');
      await fixture.getProofServerContainer().stop({ timeout: 10_000 });

      const initialState2 = await firstValueFrom(receivingWallet.state());

      const outputsToCreate = [
        {
          type: tokenTypeHash,
          amount: outputValue,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await fundedWallet.transferTransaction(outputsToCreate);
      await expect(fundedWallet.proveTransaction(txToProve)).rejects.toThrow();

      const finalState = await waitForFinalizedBalance(fundedWallet);
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
