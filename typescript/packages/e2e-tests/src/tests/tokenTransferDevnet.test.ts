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
import { createLogger, waitForFinalizedBalance, waitForPending, waitForSync } from './utils';
import { webcrypto } from 'node:crypto';
import * as crypto2 from 'crypto';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { exit } from 'node:process';
import path from 'node:path';

// @ts-expect-error: It's needed to make Scala.js and WASM code able to use cryptography
globalThis.crypto = webcrypto;
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
  const timeout = 600_000;
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
      await Promise.all([waitForSync(walletFunded), waitForSync(wallet2)]);
      const initialState = await firstValueFrom(walletFunded.state());
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 1: ${initialBalance}`);

      const initialState2 = await firstValueFrom(wallet2.state());
      const initialBalance2 = initialState2.balances[nativeToken()] ?? 0n;
      logger.info(`Wallet 2: ${initialBalance2}`);

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
      expect(pendingState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBe(1);
      expect(pendingState.coins.length).toBe(initialState.coins.length);
      expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      const finalState = await waitForFinalizedBalance(walletFunded);
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(finalState.availableCoins.length).toBe(initialState.availableCoins.length);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.coins.length).toBe(initialState.coins.length);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
      logger.info(`Wallet 1: ${finalState.balances[nativeToken()]}`);

      const finalState2 = await waitForFinalizedBalance(wallet2);
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
