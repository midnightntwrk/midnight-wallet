import { describe, test, expect } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import { nativeToken, NetworkId, Transaction } from '@midnight-ntwrk/zswap';
import {
  closeWallet,
  validateWalletTxHistory,
  waitForPending,
  waitForSync,
  waitForTxInHistory,
  walletStateTrimmed,
} from './utils.js';
import { TransactionToProve, Wallet } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger.js';
import { randomBytes } from 'node:crypto';
import * as allure from 'allure-js-commons';

/**
 * Tests checking transaction balancing
 *
 * @group undeployed
 */

describe('Transaction balancing examples', () => {
  const getFixture = useTestContainersFixture();
  const seedSender = randomBytes(32).toString('hex');
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const timeout = 600_000;

  let walletFunded: Wallet & Resource;
  let sender: Wallet & Resource;
  let receiver1: Wallet & Resource;
  let receiver2: Wallet & Resource;
  let receiver3: Wallet & Resource;
  let fixture: TestContainersFixture;
  const nativeTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';
  const nativeTokenHash2 = '02000000000000000000000000000000000000000000000000000000000000000002';

  const output100 = 100_000_000n;
  const output50 = 50_000_000n;
  const output30 = 30_000_000n;

  beforeEach(async () => {
    await allure.step('Distribute coins to sender', async function () {
      fixture = getFixture();

      walletFunded = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seedFunded,
        NetworkId.Undeployed,
        'info',
      );

      walletFunded.start();
      await waitForSync(walletFunded);

      const sendTx = async (address: string): Promise<void> => {
        const initialState = await firstValueFrom(walletFunded.state());
        const initialBalance = initialState.balances[nativeToken()] ?? 0n;
        const initialBalanceNative = initialState.balances[nativeTokenHash] ?? 0n;
        const initialBalanceNative2 = initialState.balances[nativeTokenHash2] ?? 0n;
        logger.info(`Funded Wallet: ${initialBalance} tDUST`);
        logger.info(`Funded Wallet: ${initialBalanceNative} ${nativeTokenHash}`);
        logger.info(`Funded Wallet: ${initialBalanceNative2} ${nativeTokenHash2}`);
        logger.info(`Funded Wallet available coins: ${initialState.availableCoins.length}`);
        logger.info(
          `Sending ${output100 / 1_000_000n}, ${output50 / 1_000_000n} and ${
            output30 / 1_000_000n
          } tDUST, 1 ${nativeTokenHash} and 2 ${nativeTokenHash2} to address: ${address}`,
        );

        const outputsToCreate = [
          {
            type: nativeToken(),
            amount: output100,
            receiverAddress: address,
          },
          {
            type: nativeToken(),
            amount: output50,
            receiverAddress: address,
          },
          {
            type: nativeToken(),
            amount: output30,
            receiverAddress: address,
          },
        ];

        const outputsToCreate2 = [
          {
            type: nativeTokenHash,
            amount: 1n,
            receiverAddress: address,
          },
          {
            type: nativeTokenHash2,
            amount: 2n,
            receiverAddress: address,
          },
        ];

        const txToProve = await walletFunded.transferTransaction(outputsToCreate);
        const provenTx = await walletFunded.proveTransaction(txToProve);
        const id = await walletFunded.submitTransaction(provenTx);
        logger.info('Transaction id: ' + id);

        await waitForTxInHistory(id, walletFunded);

        const txToProve2 = await walletFunded.transferTransaction(outputsToCreate2);
        const provenTx2 = await walletFunded.proveTransaction(txToProve2);
        const id2 = await walletFunded.submitTransaction(provenTx2);
        logger.info('Transaction id: ' + id2);

        await waitForTxInHistory(id2, walletFunded);

        const finalState = await waitForSync(walletFunded);
        logger.info(walletStateTrimmed(finalState));
        expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - output100 - output50 - output30);
        expect(finalState.balances[nativeTokenHash] ?? 0n).toBe(initialBalanceNative - 1n);
        expect(finalState.balances[nativeTokenHash2] ?? 0n).toBe(initialBalanceNative2 - 2n);
        expect(finalState.pendingCoins.length).toBe(0);
        expect(finalState.transactionHistory.length).toBe(initialState.transactionHistory.length + 2);
      };

      sender = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seedSender,
        NetworkId.Undeployed,
        'info',
      );

      sender.start();
      const state = await waitForSync(sender);
      await sendTx(state.address);
    });
  }, timeout);

  afterEach(async () => {
    await walletFunded.close();
    await sender.close();
  }, timeout);

  test(
    'tDUST transfer up to 2nd lowest native coin',
    async () => {
      allure.tms('PM-13746', 'PM-13746');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('tDUST transfer which uses the second lowest coin');

      const output35 = 35_000_000n;

      receiver1 = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        randomBytes(32).toString('hex'),
        NetworkId.Undeployed,
        'info',
      );

      receiver1.start();

      const initialState = await waitForSync(sender);
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.balances);
      logger.info(`Wallet 1: ${initialBalance} tDUST`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(initialState.availableCoins);

      const initialState2 = await waitForSync(receiver1);
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} tDUST`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: output35,
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
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      await waitForTxInHistory(txId, sender);
      const finalState = await waitForSync(sender);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]} tDUST`);
      logger.info(finalState.availableCoins);
      expect(finalState.balances[nativeToken()] ?? 0n).toBe(144840380n);
      expect(finalState.availableCoins.length).toBeLessThanOrEqual(initialState.availableCoins.length - 1); // Lowest available coin used up in transfer
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(initialState.coins.length - 1);
      expect(finalState.nullifiers.length).toBe(initialState.nullifiers.length - 1);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);

      await waitForTxInHistory(txId, receiver1);
      const finalState2 = await waitForSync(receiver1);
      logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.balances[nativeToken()]} tDUST`);
      logger.info(finalState2.availableCoins);
      expect(finalState2.balances[nativeToken()] ?? 0n).toBe(output35);
      validateWalletTxHistory(finalState2, initialState2);

      await closeWallet(receiver1);
    },
    timeout,
  );

  test(
    'tDUST transfer with lowest native coin',
    async () => {
      allure.tms('PM-13747', 'PM-13747');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('Native token transfer which uses the lowest coin');

      const output = 1n;

      receiver1 = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        randomBytes(32).toString('hex'),
        NetworkId.Undeployed,
        'info',
      );

      receiver1.start();

      const initialState = await waitForSync(sender);
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.balances);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(initialState.availableCoins);

      const initialState2 = await waitForSync(receiver1);
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} tDUST`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: nativeTokenHash2,
          amount: output,
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
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      await waitForTxInHistory(txId, sender);
      const finalState = await waitForSync(sender);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 1: ${finalState.balances[nativeTokenHash2]} NT2`);
      logger.info(finalState.availableCoins);
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - output);
      expect(finalState.availableCoins.length).toBeLessThanOrEqual(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBeLessThanOrEqual(initialState.coins.length);
      expect(finalState.nullifiers.length).toBeLessThanOrEqual(initialState.nullifiers.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);

      await waitForTxInHistory(txId, receiver1);
      const finalState2 = await waitForSync(receiver1);
      logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 2: ${finalState2.balances[nativeTokenHash2]} NT2`);
      logger.info(finalState2.availableCoins);
      expect(finalState2.balances[nativeToken()] ?? 0n).toBe(initialBalance2);
      expect(finalState2.balances[nativeTokenHash2] ?? 0n).toBe(output);
      validateWalletTxHistory(finalState2, initialState2);

      await closeWallet(receiver1);
    },
    timeout,
  );

  test(
    'Token transfer involving multiple token types and recipients in one transaction',
    async () => {
      allure.tms('PM-13748', 'PM-13748');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('Multiple token types and recipients in one tx');

      const NativeTokenOutput = 1n;
      const output2 = 10_000_000n;
      const output3 = 3_000_000n;

      receiver1 = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        randomBytes(32).toString('hex'),
        NetworkId.Undeployed,
        'info',
      );

      receiver1.start();

      receiver2 = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        randomBytes(32).toString('hex'),
        NetworkId.Undeployed,
        'info',
      );
      // wait before starting another wallet to evade issues with syncing
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      receiver2.start();

      receiver3 = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        randomBytes(32).toString('hex'),
        NetworkId.Undeployed,
        'info',
      );

      // wait before starting another wallet to evade issues with syncing
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      receiver3.start();

      const initialState = await waitForSync(sender);
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.balances);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(initialState.availableCoins);

      const initialState2 = await waitForSync(receiver1);
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} tDUST`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);

      const initialState3 = await waitForSync(receiver2);
      const initialBalance3 = initialState3.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 3: ${initialBalance3} tDUST`);
      logger.info(`Wallet 3 available coins: ${initialState3.availableCoins.length}`);

      const initialState4 = await waitForSync(receiver3);
      const initialBalance4 = initialState4.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 4: ${initialBalance4} tDUST`);
      logger.info(`Wallet 4 available coins: ${initialState4.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: nativeTokenHash2,
          amount: NativeTokenOutput,
          receiverAddress: initialState2.address,
        },
        {
          type: nativeToken(),
          amount: output2,
          receiverAddress: initialState3.address,
        },
        {
          type: nativeToken(),
          amount: output3,
          receiverAddress: initialState4.address,
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
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(2);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      await waitForTxInHistory(txId, sender);
      const finalState = await waitForSync(sender);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 1: ${finalState.balances[nativeTokenHash2]} NT2`);
      logger.info(finalState.availableCoins);
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - output2 - output3);
      expect(finalState.availableCoins.length).toBeLessThanOrEqual(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBeLessThanOrEqual(initialState.coins.length);
      expect(finalState.nullifiers.length).toBeLessThanOrEqual(initialState.nullifiers.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);

      await waitForTxInHistory(txId, receiver1);
      const finalState2 = await waitForSync(receiver1);
      logger.info(walletStateTrimmed(finalState2));
      logger.info(`Wallet 2 available coins: ${finalState2.availableCoins.length}`);
      logger.info(`Wallet 2: ${finalState2.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 2: ${finalState2.balances[nativeTokenHash2]} NT2`);
      logger.info(finalState2.availableCoins);
      expect(finalState2.balances[nativeToken()] ?? 0n).toBe(0n);
      expect(finalState2.balances[nativeTokenHash2] ?? 0n).toBe(NativeTokenOutput);
      validateWalletTxHistory(finalState2, initialState2);

      await waitForTxInHistory(txId, receiver2);
      const finalState3 = await waitForSync(receiver2);
      logger.info(walletStateTrimmed(finalState3));
      logger.info(`Wallet 3 available coins: ${finalState3.availableCoins.length}`);
      logger.info(`Wallet 3: ${finalState3.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 3: ${finalState3.balances[nativeTokenHash2]} NT2`);
      logger.info(finalState3.availableCoins);
      expect(finalState3.balances[nativeToken()] ?? 0n).toBe(output2);
      validateWalletTxHistory(finalState3, initialState3);

      await waitForTxInHistory(txId, receiver3);
      const finalState4 = await waitForSync(receiver3);
      logger.info(walletStateTrimmed(finalState4));
      logger.info(`Wallet 4 available coins: ${finalState4.availableCoins.length}`);
      logger.info(`Wallet 4: ${finalState4.balances[nativeToken()]} tDUST`);
      logger.info(`Wallet 4: ${finalState4.balances[nativeTokenHash2]} NT2`);
      logger.info(finalState4.availableCoins);
      expect(finalState4.balances[nativeToken()] ?? 0n).toBe(output3);
      validateWalletTxHistory(finalState4, initialState4);

      await closeWallet(receiver1);
      await closeWallet(receiver2);
      await closeWallet(receiver3);
    },
    timeout,
  );

  test(
    'Insufficient balance error when trying to transfer all available tdust',
    async () => {
      allure.tms('PM-15080', 'PM-15080');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('Error when trying to transfer all available tdust');

      receiver1 = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        randomBytes(32).toString('hex'),
        NetworkId.Undeployed,
        'info',
      );

      receiver1.start();

      const initialState = await waitForSync(sender);
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.balances);
      logger.info(`Wallet 1: ${initialBalance} tDUST`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(initialState.availableCoins);

      const initialState2 = await waitForSync(receiver1);
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2} tDUST`);
      logger.info(`Wallet 2 available coins: ${initialState2.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: initialBalance,
          receiverAddress: initialState2.address,
        },
      ];
      try {
        const txToProve = await sender.transferTransaction(outputsToCreate);
        const provenTx = await sender.proveTransaction(txToProve);
        await sender.submitTransaction(provenTx);
      } catch (e: unknown) {
        if (e instanceof Error) {
          expect(e.message).toContain(
            'Insufficient Funds: could not balance 02000000000000000000000000000000000000000000000000000000000000000000',
          );
        } else {
          logger.info(e);
        }
      }
      await closeWallet(receiver1);
    },
    timeout,
  );

  test(
    'Able to transfer all available tDust incl fees',
    async () => {
      allure.tms('PM-15023', 'PM-15023');
      allure.epic('Headless wallet');
      allure.feature('Transaction balancing');
      allure.story('tDUST transfer that uses all available tokens');

      const output1 = 1_000_000n;
      const walletFees = 159620n;
      let txToProve: TransactionToProve;
      let provenTx: Transaction;
      let txId: string;

      receiver1 = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        randomBytes(32).toString('hex'),
        NetworkId.Undeployed,
        'info',
      );

      receiver1.start();

      const initialState = await waitForSync(sender);
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(initialState.balances);
      logger.info(`Wallet 1: ${initialBalance} tDUST`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(initialState.availableCoins);

      const initialReceiverState = await waitForSync(receiver1);
      const initialReceiverBalance = initialReceiverState.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 2: ${initialReceiverBalance} tDUST`);
      logger.info(`Wallet 2 available coins: ${initialReceiverState.availableCoins.length}`);

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: output1,
          receiverAddress: initialReceiverState.address,
        },
      ];
      txToProve = await sender.transferTransaction(outputsToCreate);
      provenTx = await sender.proveTransaction(txToProve);
      txId = await sender.submitTransaction(provenTx);
      logger.info('sending tDUST to wallet 2');
      logger.info('Transaction id: ' + txId);

      await waitForPending(sender);
      await waitForTxInHistory(txId, sender);
      const senderState = await waitForSync(sender);
      const newSenderWalletBalance = senderState.balances[nativeToken()] ?? 0n;
      const totalFees = initialBalance - newSenderWalletBalance - output1;
      logger.info(walletStateTrimmed(senderState));
      logger.info(`Wallet 1: ${newSenderWalletBalance} tDUST`);
      expect(totalFees).toBeGreaterThanOrEqual(59730n);

      await waitForTxInHistory(txId, receiver1);
      const receiverWalletState = await waitForSync(receiver1);
      logger.info(walletStateTrimmed(receiverWalletState));
      logger.info(`Wallet 2: ${receiverWalletState.balances[nativeToken()] ?? 0n} tDUST`);

      const outputsToCreate2 = [
        {
          type: nativeToken(),
          amount: walletFees,
          receiverAddress: initialReceiverState.address,
        },
      ];

      txToProve = await sender.transferTransaction(outputsToCreate2);
      provenTx = await sender.proveTransaction(txToProve);
      txId = await sender.submitTransaction(provenTx);
      logger.info('Sending transaction fee to wallet 2');
      logger.info('Transaction id: ' + txId);

      await waitForPending(sender);
      await waitForTxInHistory(txId, receiver1);

      const ReceiverWalletState2 = await waitForSync(receiver1);
      const ReceiverWalletBalance2 = ReceiverWalletState2.balances[nativeToken()] ?? 0n;
      logger.info(walletStateTrimmed(ReceiverWalletState2));
      logger.info(`Wallet 2 available coins: ${ReceiverWalletState2.availableCoins.length}`);
      logger.info(`Wallet 2: ${ReceiverWalletBalance2} tDUST`);
      expect(ReceiverWalletBalance2).toBe(output1 + walletFees);

      const outputsToCreate3 = [
        {
          type: nativeToken(),
          amount: output1,
          receiverAddress: initialState.address,
        },
      ];

      txToProve = await receiver1.transferTransaction(outputsToCreate3);
      provenTx = await receiver1.proveTransaction(txToProve);
      txId = await receiver1.submitTransaction(provenTx);
      logger.info('Sending maximum available tDust not incl fees');
      logger.info('Transaction id: ' + txId);

      const pendingState = await waitForPending(receiver1);
      logger.info(walletStateTrimmed(pendingState));
      await waitForTxInHistory(txId, receiver1);

      const receiverWalletState3 = await waitForSync(receiver1);
      const ReceiverWalletBalance3 = receiverWalletState3.balances[nativeToken()] ?? 0n;
      logger.info(walletStateTrimmed(receiverWalletState3));
      logger.info(`Wallet 2 available coins: ${receiverWalletState3.availableCoins.length}`);
      logger.info(`Wallet 2: ${ReceiverWalletBalance3} tDUST`);
      expect(ReceiverWalletBalance3).toBe(0n);

      await closeWallet(receiver1);

      receiver1 = await WalletBuilder.build(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        randomBytes(32).toString('hex'),
        NetworkId.Undeployed,
        'info',
      );
      receiver1.start();

      const finalReceiverWalletState = await waitForSync(receiver1);
      const finalWalletBalancer = finalReceiverWalletState.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 2: ${finalWalletBalancer} tDUST`);
      logger.info(`Wallet 2 available coins: ${finalReceiverWalletState.availableCoins.length}`);
      expect(finalWalletBalancer).toBe(0n);
      await closeWallet(receiver1);
    },
    timeout,
  );
});
