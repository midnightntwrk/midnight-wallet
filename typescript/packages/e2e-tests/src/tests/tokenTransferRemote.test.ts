import { firstValueFrom } from 'rxjs';
import { Resource } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import {
  createCoinInfo,
  LedgerParameters,
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
import { exit } from 'node:process';
import { logger } from './logger';

/**
 * Tests performing a token transfer
 *
 * @group devnet
 * @group testnet
 */

describe('Token transfer', () => {
  if (process.env['SEED2'] === undefined || process.env['SEED'] === undefined) {
    logger.info('SEED or SEED2 env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const seed = process.env['SEED2'];
  const seedFunded = process.env['SEED'];
  const syncTimeout = TestContainersFixture.deployment === 'testnet' ? 3_000_000 : 1_800_000;
  const timeout = 600_000;
  const outputValue = 10_000n;

  let sender: Wallet & Resource;
  let receiver: Wallet & Resource;
  let wallet: Wallet & Resource;
  let wallet2: Wallet & Resource;
  let fixture: TestContainersFixture;

  const filenameWallet = `${seedFunded.substring(0, 7)}-${TestContainersFixture.deployment}.state`;
  const filenameWallet2 = `${seed.substring(0, 7)}-${TestContainersFixture.deployment}.state`;

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
    const date = new Date();
    const hour = date.getHours();

    wallet = await provideWallet(filenameWallet, seedFunded, networkId, fixture);
    wallet2 = await provideWallet(filenameWallet2, seed, networkId, fixture);

    if (hour % 2 !== 0) {
      logger.info('Using SEED2 as receiver');
      sender = wallet;
      receiver = wallet2;
    } else {
      logger.info('Using SEED2 as sender');
      sender = wallet2;
      receiver = wallet;
    }

    sender.start();
    // wait before starting another wallet to evade issues with syncing
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    receiver.start();
  }, syncTimeout);

  afterAll(async () => {
    await closeWallet(sender);
    await closeWallet(receiver);
    await saveState(sender, filenameWallet);
    await saveState(receiver, filenameWallet2);
  }, timeout);

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
      const txId = await sender.submitTransaction(provenTx);
      console.time('txProcessing');
      logger.info('Transaction id: ' + txId);

      const pendingState = await waitForPending(sender);
      logger.info(walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeGreaterThanOrEqual(1);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      await waitForTxInHistory(txId, sender);
      const finalState = await waitForSync(sender);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(finalState.availableCoins.length).toBeLessThanOrEqual(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBeLessThanOrEqual(initialState.coins.length);
      expect(finalState.nullifiers.length).toBeLessThanOrEqual(initialState.nullifiers.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]}`);

      await waitForTxInHistory(txId, receiver);
      const finalState2 = await waitForSync(receiver);
      logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      expect(finalState2.balances[nativeToken()] ?? 0n).toBe(initialBalance2 + outputValue);
      expect(finalState2.availableCoins.length).toBe(initialState2.availableCoins.length + 1);
      expect(finalState2.pendingCoins.length).toBe(0);
      expect(finalState2.coins.length).toBeGreaterThanOrEqual(initialState2.coins.length + 1);
      expect(finalState2.nullifiers.length).toBeGreaterThanOrEqual(initialState2.nullifiers.length + 1);
      expect(finalState2.transactionHistory.length).toBeGreaterThanOrEqual(initialState2.transactionHistory.length + 1);
      logger.info(`Wallet 2: ${finalState2.balances[nativeToken()]}`);
    },
    syncTimeout,
  );

  test(
    'can perform a self-transaction',
    async () => {
      allure.tag('smoke');
      allure.tms('PM-9680', 'PM-9680');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer self-transaction');

      const initialState = await waitForSync(sender);
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.availableCoins);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: initialState.address,
        },
      ];
      const txToProve = await sender.transferTransaction(outputsToCreate);
      const provenTx = await sender.proveTransaction(txToProve);
      const txId = await sender.submitTransaction(provenTx);
      const fees = provenTx.fees(LedgerParameters.dummyParameters());
      logger.info('Transaction id: ' + txId);

      const pendingState = await waitForPending(sender);
      logger.info(walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(1);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      await waitForTxInHistory(txId, sender);
      const finalState = await waitForSync(sender);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]}`);
      // actually deducted fees are greater - PM-7721
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThanOrEqual(initialBalance - fees);
      expect(finalState.availableCoins.length).toBeGreaterThanOrEqual(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBeGreaterThanOrEqual(initialState.coins.length);
      expect(finalState.nullifiers.length).toBeGreaterThanOrEqual(initialState.nullifiers.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
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
      const coin = createCoinInfo(nativeToken(), balance);
      const output = UnprovenOutput.new(coin, initialState.coinPublicKeyLegacy, initialState.encryptionPublicKeyLegacy);
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

  test(
    'error message when attempting to send to an invalid address',
    async () => {
      allure.tms('PM-9678', 'PM-9678');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid address error message');
      const syncedState = await waitForSync(sender);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const invalidAddress = 'invalidAddress';

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: invalidAddress,
        },
      ];
      await expect(sender.transferTransaction(outputsToCreate)).rejects.toThrow(
        `Invalid address format ${invalidAddress}`,
      );
    },
    timeout,
  );

  test(
    'error message when attempting to send an invalid amount',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await waitForSync(sender);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      // the max amount that we support: Rust u64 max. The entire Midnight supply
      // is 24 billion tDUST, 1 tDUST = 10^6 specks, which is lesser
      const invalidAmount = 18446744073709551616n;
      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: invalidAmount,
          receiverAddress: initialState2.address,
        },
      ];
      await expect(sender.transferTransaction(outputsToCreate)).rejects.toThrow(
        `Not sufficient funds to balance token: 02000000000000000000000000000000000000000000000000000000000000000000`,
      );
    },
    timeout,
  );

  test(
    'error message when attempting to send a negative amount',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await waitForSync(sender);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: -5n,
          receiverAddress: initialState2.address,
        },
      ];
      await expect(sender.transferTransaction(outputsToCreate)).rejects.toThrow(
        'List of token transfers is empty or there is no positive transfers',
      );
    },
    timeout,
  );

  test(
    'error message when attempting to send a zero amount',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await waitForSync(sender);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: 0n,
          receiverAddress: initialState2.address,
        },
      ];
      await expect(sender.transferTransaction(outputsToCreate)).rejects.toThrow(
        'List of token transfers is empty or there is no positive transfers',
      );
    },
    timeout,
  );

  test(
    'error message when attempting to send an empty array of outputs',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await waitForSync(sender);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      await expect(sender.transferTransaction([])).rejects.toThrow(
        'List of token transfers is empty or there is no positive transfers',
      );
    },
    timeout,
  );
});
