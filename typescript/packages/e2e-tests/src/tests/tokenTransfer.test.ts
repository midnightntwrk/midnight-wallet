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
import { webcrypto } from 'node:crypto';
import * as crypto2 from 'crypto';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import path from 'node:path';

// @ts-expect-error: It's needed to make Scala.js and WASM code able to use cryptography
globalThis.crypto = webcrypto;

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const logger = await createLogger(
  path.resolve(currentDir, '..', 'logs', 'tokenTransfer', `${new Date().toISOString()}.log`),
);

/**
 * Tests performing a token transfer
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
    fixture = getFixture();
    setNetworkId(TestContainersFixture.network === 'devnet' ? NetworkId.DevNet : NetworkId.Undeployed);

    walletFunded = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      seedFunded,
      'info',
    );

    wallet2 = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      seed,
      'info',
    );

    walletFunded.start();
    wallet2.start();
  });

  afterEach(async () => {
    await walletFunded.close();
    await wallet2.close();
  });

  test(
    'Is working for valid transfer @healthcheck',
    async () => {
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
      const id = await walletFunded.submitTransaction(provenTx);
      logger.info('Transaction id: ' + id);

      const pendingState = await waitForPending(walletFunded);
      logger.info(walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[nativeToken()]).toBe(20000000000000000n);
      expect(pendingState.availableCoins.length).toBe(4);
      expect(pendingState.pendingCoins.length).toBe(1);
      expect(pendingState.coins.length).toBe(5);
      expect(pendingState.transactionHistory.length).toBe(1);

      const finalState = await waitForFinalizedBalance(walletFunded);
      logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
      expect(finalState.balances[nativeToken()]).toBeLessThan(balance - outputValue);
      expect(finalState.availableCoins.length).toBe(5);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(5);
      expect(finalState.transactionHistory.length).toBe(2);

      const finalState2 = await waitForFinalizedBalance(wallet2);
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

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx fails on node',
    async () => {
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
});
