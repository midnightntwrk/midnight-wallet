import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import {
  LedgerParameters,
  nativeToken,
  NetworkId,
  UnprovenOffer,
  UnprovenOutput,
  UnprovenTransaction,
} from '@midnight-ntwrk/zswap';
import {
  closeWallet,
  waitForFinalizedBalance,
  waitForPending,
  waitForSync,
  waitForTxInHistory,
  walletStateTrimmed,
} from './utils';
import * as crypto2 from 'crypto';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger';

/**
 * Tests performing a token transfer
 *
 * @group undeployed
 */

describe('Token transfer', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000002';
  const timeout = 420_000;
  const outputValue = 3_000_000n;

  let walletFunded: Wallet & Resource;
  let wallet2: Wallet & Resource;
  let fixture: TestContainersFixture;
  const outputValueNativeToken = 1n;
  let tokenTypeHash: string | undefined;

  beforeEach(async () => {
    await allure.step('Start two wallets', async function () {
      fixture = getFixture();
      const networkId = NetworkId.Undeployed;

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
    await closeWallet(walletFunded);
    await closeWallet(wallet2);
  });

  test(
    'can perform a self-transaction',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-9680', 'PM-9680');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer self-transaction');

      const initialState = await waitForSync(walletFunded);
      const initialBalance = initialState.balances[nativeToken()];
      if (initialBalance === undefined || initialBalance === 0n) {
        logger.info(`Waiting to receive tokens...`);
        await waitForSync(walletFunded);
      }
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      const balance = 25000000000000000n;

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: initialState.address,
        },
      ];
      const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      const provenTx = await walletFunded.proveTransaction(txToProve);
      const txId = await walletFunded.submitTransaction(provenTx);
      console.time('txProcessing');
      const fees = provenTx.fees(LedgerParameters.dummyParameters());
      for (const [key, value] of provenTx.imbalances(true, fees)) {
        console.log(key, value);
      }
      for (const [key, value] of provenTx.imbalances(false, fees)) {
        console.log(key, value);
      }
      logger.info('Transaction id: ' + txId);

      const pendingState = await waitForPending(walletFunded);
      logger.info(walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[nativeToken()]).toBe(20000000000000000n);
      expect(pendingState.availableCoins.length).toBe(6);
      expect(pendingState.pendingCoins.length).toBe(1);
      expect(pendingState.coins.length).toBe(7);
      expect(pendingState.nullifiers.length).toBe(7);
      expect(pendingState.transactionHistory.length).toBe(1);

      await waitForTxInHistory(txId, walletFunded);
      const finalState = await waitForSync(walletFunded);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      // actually deducted fees are greater - PM-7721
      expect(finalState.balances[nativeToken()]).toBeLessThanOrEqual(balance - fees);
      expect(finalState.availableCoins.length).toBe(8);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(8);
      expect(finalState.nullifiers.length).toBe(8);
      expect(finalState.transactionHistory.length).toBe(2);
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
      const initialState = await firstValueFrom(walletFunded.state());
      const syncedState = await waitForSync(walletFunded);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 25000000000000000n;

      const initialState2 = await firstValueFrom(wallet2.state());
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
      const provenTx = await walletFunded.proveTransaction({
        type: 'TransactionToProve',
        transaction: unprovenTx,
      });
      // const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      // const provenTx = await walletFunded.proveTransaction(txToProve);
      await expect(
        Promise.all([walletFunded.submitTransaction(provenTx), walletFunded.submitTransaction(provenTx)]),
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

      const finalState = await waitForFinalizedBalance(walletFunded);
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
      const syncedState = await waitForSync(walletFunded);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 25000000000000000n;

      logger.info('Stopping proof server container..');
      await fixture.getProofServerContainer().stop({ timeout: 10_000 });

      const initialState2 = await firstValueFrom(wallet2.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      await expect(walletFunded.proveTransaction(txToProve)).rejects.toThrow();

      // const pendingState = await waitForPending(walletFunded);
      // logger.info(pendingState);
      // expect(pendingState.balances[nativeToken()]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(1);

      const finalState = await waitForFinalizedBalance(walletFunded);
      expect(finalState.balances[nativeToken()]).toBe(balance);
      expect(finalState.availableCoins.length).toBe(5);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(5);
      expect(finalState.transactionHistory.length).toBe(1);
    },
    timeout,
  );

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx does not get submitted',
    async () => {
      allure.tms('PM-8918', 'PM-8918');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Transaction not submitted');
      const syncedState = await waitForSync(walletFunded);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 25000000000000000n;

      logger.info('Stopping node container..');
      await fixture.getNodeContainer().stop({ removeVolumes: false });

      const initialState2 = await firstValueFrom(wallet2.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      const provenTx = await walletFunded.proveTransaction(txToProve);
      await expect(walletFunded.submitTransaction(provenTx)).rejects.toThrow();

      // const pendingState = await waitForPending(walletFunded);
      // logger.info(pendingState);
      // expect(pendingState.balances[nativeToken()]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(1);

      const finalState = await waitForFinalizedBalance(walletFunded);
      expect(finalState.balances[nativeToken()]).toBe(balance);
      expect(finalState.availableCoins.length).toBe(5);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(5);
      expect(finalState.transactionHistory.length).toBe(1);
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
      const syncedState = await waitForSync(walletFunded);
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
      await expect(walletFunded.transferTransaction(outputsToCreate)).rejects.toThrow(
        `Invalid address format ${invalidAddress}`,
      );
    },
    timeout,
  );

  test(
    'error message when attempting to send an amount greater than available',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await waitForSync(walletFunded);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      // the max amount that we support: Rust u128 max.
      const maxAmount = 340_282_366_920_938_463_463_374_607_431_768_211_455n;
      const initialState2 = await firstValueFrom(wallet2.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: maxAmount,
          receiverAddress: initialState2.address,
        },
      ];
      await expect(walletFunded.transferTransaction(outputsToCreate)).rejects.toThrow(
        `Not sufficient funds to balance token: 02000000000000000000000000000000000000000000000000000000000000000000`,
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
      const syncedState = await waitForSync(walletFunded);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      // the max amount that we support: Rust u128 max. The entire Midnight supply
      // is 24 billion tDUST, 1 tDUST = 10^6 specks, which is lesser
      const invalidAmount = 340_282_366_920_938_463_463_374_607_431_768_211_456n;
      const initialState2 = await firstValueFrom(wallet2.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: invalidAmount,
          receiverAddress: initialState2.address,
        },
      ];
      await expect(walletFunded.transferTransaction(outputsToCreate)).rejects.toThrow(
        `Error: Couldn't deserialize u128 from a BigInt outside u128::MIN..u128::MAX bounds`,
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
      const syncedState = await waitForSync(walletFunded);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(wallet2.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: -5n,
          receiverAddress: initialState2.address,
        },
      ];
      await expect(walletFunded.transferTransaction(outputsToCreate)).rejects.toThrow(
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
      const syncedState = await waitForSync(walletFunded);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const initialState2 = await firstValueFrom(wallet2.state());

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: 0n,
          receiverAddress: initialState2.address,
        },
      ];
      await expect(walletFunded.transferTransaction(outputsToCreate)).rejects.toThrow(
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
      const syncedState = await waitForSync(walletFunded);
      const initialBalance = syncedState?.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      await expect(walletFunded.transferTransaction([])).rejects.toThrow(
        'List of token transfers is empty or there is no positive transfers',
      );
    },
    timeout,
  );

  test(
    'Is working for valid native token transfer @smoke @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-8933', 'PM-8933');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid native token transfer transaction');

      await Promise.all([waitForSync(walletFunded), waitForSync(wallet2)]);
      const initialState = await firstValueFrom(walletFunded.state());
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

      const initialState2 = await firstValueFrom(wallet2.state());
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      const initialBalanceNative2 = initialState2.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} tDUST`);
      logger.info(`Wallet 2: ${initialBalanceNative2} ${tokenTypeHash}`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: tokenTypeHash,
          amount: outputValueNativeToken,
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
      expect(pendingState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance);
      expect(pendingState.balances[tokenTypeHash] ?? 0n).toBeLessThanOrEqual(initialBalanceNative - outputValue);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      await waitForTxInHistory(txId, walletFunded);
      const finalState = await waitForSync(walletFunded);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance);
      expect(finalState.balances[tokenTypeHash] ?? 0n).toBe(initialBalanceNative - outputValueNativeToken);
      expect(finalState.availableCoins.length).toBeLessThanOrEqual(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBeLessThanOrEqual(initialState.coins.length);
      expect(finalState.nullifiers.length).toBeLessThanOrEqual(initialState.nullifiers.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 1: ${finalState.balances[tokenTypeHash]} ${tokenTypeHash}`);

      await waitForTxInHistory(txId, wallet2);
      const finalState2 = await waitForSync(wallet2);
      logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      expect(finalState2.balances[nativeToken()] ?? 0n).toBe(initialBalance2);
      expect(finalState2.balances[tokenTypeHash] ?? 0n).toBe(initialBalanceNative2 + outputValueNativeToken);
      expect(finalState2.availableCoins.length).toBe(initialState2.availableCoins.length + 1);
      expect(finalState2.pendingCoins.length).toBe(0);
      expect(finalState2.coins.length).toBeGreaterThanOrEqual(initialState2.coins.length + 1);
      expect(finalState2.nullifiers.length).toBeGreaterThanOrEqual(initialState2.nullifiers.length + 1);
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
      const initialState = await firstValueFrom(walletFunded.state());
      const syncedState = await waitForSync(walletFunded);
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

      const syncedState2 = await waitForSync(wallet2);
      const initialDustBalance2 = syncedState2?.balances[nativeToken()] ?? 0n;
      const initialBalance2 = syncedState2?.balances[tokenTypeHash] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialDustBalance2} tDUST`);
      logger.info(`Wallet 1 balance is: ${initialBalance2} ${tokenTypeHash}`);

      const coin = {
        type: tokenTypeHash,
        value: outputValueNativeToken,
        nonce: crypto2.randomBytes(32).toString('hex'),
      };
      const output = UnprovenOutput.new(coin, initialState.coinPublicKey, initialState.encryptionPublicKey);
      const offer = UnprovenOffer.fromOutput(output, nativeToken(), outputValue);
      const unprovenTx = new UnprovenTransaction(offer);
      const provenTx = await walletFunded.proveTransaction({
        type: 'TransactionToProve',
        transaction: unprovenTx,
      });

      await expect(
        Promise.all([walletFunded.submitTransaction(provenTx), walletFunded.submitTransaction(provenTx)]),
      ).rejects.toThrow();

      const finalState = await waitForFinalizedBalance(walletFunded);
      expect(finalState).toMatchObject(syncedState);
      expect(finalState.balances[nativeToken()]).toBe(initialDustBalance);
      expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
      expect(finalState.availableCoins.length).toBe(syncedState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(syncedState.coins.length);
      expect(finalState.nullifiers.length).toBe(syncedState.nullifiers.length);
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
      const syncedState = await waitForSync(walletFunded);
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

      const initialState2 = await firstValueFrom(wallet2.state());

      const outputsToCreate = [
        {
          type: tokenTypeHash,
          amount: outputValueNativeToken,
          receiverAddress: initialState2.address,
        },
      ];
      const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      await expect(walletFunded.proveTransaction(txToProve)).rejects.toThrow();

      const finalState = await waitForFinalizedBalance(walletFunded);
      expect(finalState).toMatchObject(syncedState);
      expect(finalState.balances[nativeToken()]).toBe(initialDustBalance);
      expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
      expect(finalState.availableCoins.length).toBe(syncedState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(syncedState.coins.length);
      expect(finalState.nullifiers.length).toBe(syncedState.nullifiers.length);
      expect(finalState.transactionHistory.length).toBe(syncedState.transactionHistory.length);
    },
    timeout,
  );
});
