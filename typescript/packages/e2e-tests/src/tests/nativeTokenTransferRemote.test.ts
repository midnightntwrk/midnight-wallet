import { firstValueFrom } from 'rxjs';
import { Resource } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import {
  createCoinInfo,
  nativeToken,
  NetworkId,
  UnprovenOffer,
  UnprovenOutput,
  UnprovenTransaction,
} from '@midnight-ntwrk/zswap';
import {
  closeWallet,
  provideWallet,
  saveState,
  waitForFinalizedBalance,
  waitForPending,
  waitForSync,
  waitForTxInHistory,
  walletStateTrimmed,
} from './utils';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger';
import { exit } from 'node:process';

/**
 * Tests performing a token transfer
 *
 * @group devnet
 * @group testnet
 */

describe('Token transfer', () => {
  if (process.env['NT_SEED'] === undefined || process.env['NT_SEED2'] === undefined) {
    logger.info('NT_SEED or NT_SEED2 env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const receivingSeed = process.env['NT_SEED2'];
  const fundedSeed = process.env['NT_SEED'];
  const syncTimeout = TestContainersFixture.deployment === 'testnet' ? 3_000_000 : 1_800_000;
  const timeout = 600_000;
  const outputValue = 1n;
  let tokenTypeHash: string | undefined;
  const expectedTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';

  let sender: Wallet & Resource;
  let receiver: Wallet & Resource;
  let fixture: TestContainersFixture;
  let wallet: Wallet & Resource;
  let wallet2: Wallet & Resource;

  const filenameWallet = `${fundedSeed.substring(0, 7)}-${TestContainersFixture.deployment}.state`;
  const filenameWallet2 = `${receivingSeed.substring(0, 7)}-${TestContainersFixture.deployment}.state`;

  beforeAll(async () => {
    fixture = getFixture();

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

    wallet = await provideWallet(filenameWallet, fundedSeed, networkId, fixture);
    wallet2 = await provideWallet(filenameWallet2, receivingSeed, networkId, fixture);

    wallet.start();
    const initialState = await waitForSync(wallet);
    const initialNativeBalance = initialState.balances[expectedTokenHash] ?? 0n;
    logger.info(`initial balance: ${initialNativeBalance}`);

    if (initialNativeBalance === 0n) {
      logger.info('wallet 1 has 0 native token. Wallet 2 will be sender');
      sender = wallet2;
      receiver = wallet;
      sender.start();
    } else {
      logger.info('native token in wallet 1. Wallet 1 will be sender');
      sender = wallet;
      receiver = wallet2;
      receiver.start();
    }
  }, syncTimeout);

  afterAll(async () => {
    await closeWallet(sender);
    await closeWallet(receiver);
    await saveState(sender, filenameWallet);
    await saveState(receiver, filenameWallet2);
  }, timeout);

  test(
    'Is working for valid native token transfer @smoke @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-8933', 'PM-8933');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid native token transfer transaction');

      await Promise.all([waitForSync(sender), waitForSync(receiver)]);
      const initialState = await firstValueFrom(sender.state());
      logger.info(walletStateTrimmed(initialState));
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.balances);
      Object.entries(initialState.balances).forEach(([key, _]) => {
        if (key !== nativeToken()) tokenTypeHash = key;
      });
      if (tokenTypeHash === undefined) {
        throw new Error('No native tokens found');
      }
      const initialBalanceNative = initialState.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1: ${initialBalance} tDUST`);
      logger.info(`Wallet 1: ${initialBalanceNative} ${tokenTypeHash}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(initialState.availableCoins);

      const initialState2 = await firstValueFrom(receiver.state());
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      const initialBalanceNative2 = initialState2.balances[tokenTypeHash] ?? 0n;
      logger.info(walletStateTrimmed(initialState2));
      logger.info(`Wallet 2: ${initialBalance2} tDUST`);
      logger.info(`Wallet 2: ${initialBalanceNative2} ${tokenTypeHash}`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);
      logger.info('Sending transaction');

      const outputsToCreate = [
        {
          type: tokenTypeHash,
          amount: outputValue,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await sender.transferTransaction(outputsToCreate);
      const provenTx = await sender.proveTransaction(txToProve);
      const txId = await sender.submitTransaction(provenTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await waitForPending(sender);
      logger.info(walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance);
      expect(pendingState.balances[tokenTypeHash] ?? 0n).toBeLessThanOrEqual(initialBalanceNative - outputValue);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBe(2);
      expect(pendingState.coins.length).toBeGreaterThanOrEqual(initialState.coins.length);
      expect(pendingState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length);

      await waitForTxInHistory(txId, sender);
      const finalState = await waitForSync(sender);
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

      await waitForTxInHistory(txId, receiver);
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
    syncTimeout,
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
      Object.entries(initialState.balances).forEach(([key, _]) => {
        if (key !== nativeToken()) tokenTypeHash = key;
      });
      if (tokenTypeHash === undefined) {
        throw new Error('No native tokens found');
      }
      const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

      const syncedState2 = await waitForSync(receiver);
      const initialDustBalance2 = syncedState2?.balances[nativeToken()] ?? 0n;
      const initialBalance2 = syncedState2?.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance2} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance2} ${tokenTypeHash}`);

      const coin = createCoinInfo(tokenTypeHash, outputValue);
      const output = UnprovenOutput.new(coin, initialState.coinPublicKeyLegacy, initialState.encryptionPublicKeyLegacy);
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
      Object.entries(syncedState.balances).forEach(([key, _]) => {
        if (key !== nativeToken()) tokenTypeHash = key;
      });
      if (tokenTypeHash === undefined) {
        throw new Error('No native tokens found');
      }
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
