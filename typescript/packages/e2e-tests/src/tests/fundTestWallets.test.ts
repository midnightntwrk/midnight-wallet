import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { nativeToken, NetworkId } from '@midnight-ntwrk/zswap';
import {
  closeWallet,
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
  if (process.env['SEED'] === undefined) {
    logger.info('SEED env var not set');
    exit(1);
  }
  if (process.env['SEED_STABLE'] === undefined) {
    logger.info('SEED_STABLE env var not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const seedFunded = process.env['SEED'];
  const seedStable = process.env['SEED_STABLE'];
  const timeout = 3_600_000;
  const outputValue = 100_000_000n;
  const nativeTokenValue = 25n;
  const nativeTokenValue2 = 50n;
  const nativeTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';
  const nativeTokenHash2 = '02000000000000000000000000000000000000000000000000000000000000000002';

  let walletFunded: Wallet & Resource;
  let fixture: TestContainersFixture;
  let networkId: NetworkId;

  beforeEach(async () => {
    fixture = getFixture();
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

  afterEach(async () => {
    await closeWallet(walletFunded);
  });

  test(
    'Is working for distribution to the test wallets',
    async () => {
      if (process.env['ADDRESSES'] === undefined) {
        logger.info('ADDRESSES env var not set');
        exit(1);
      }
      const addresses = process.env['ADDRESSES'].split(',');

      await waitForSync(walletFunded);

      const sendTx = async (address: string): Promise<void> => {
        const initialState = await firstValueFrom(walletFunded.state());
        const initialBalance = initialState.balances[nativeToken()] ?? 0n;
        const initialBalanceNative = initialState.balances[nativeTokenHash] ?? 0n;
        logger.info(`Wallet 1: ${initialBalance} tDUST`);
        logger.info(`Wallet 1: ${initialBalanceNative} ${nativeTokenHash}`);
        logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
        logger.info(
          `Sending ${outputValue / 1_000_000n} tDUST and ${nativeTokenValue} ${nativeTokenHash} to address: ${address}`,
        );

        const outputsToCreate = [
          {
            type: nativeToken(),
            amount: outputValue,
            receiverAddress: address,
          },
          {
            type: nativeTokenHash,
            amount: nativeTokenValue,
            receiverAddress: address,
          },
        ];

        const txToProve = await walletFunded.transferTransaction(outputsToCreate);
        const provenTx = await walletFunded.proveTransaction(txToProve);
        const id = await walletFunded.submitTransaction(provenTx);
        logger.info('Transaction id: ' + id);

        const pendingState = await waitForPending(walletFunded);
        logger.info(walletStateTrimmed(pendingState));
        logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);

        const finalState = await waitForFinalizedBalance(walletFunded);
        logger.info(walletStateTrimmed(finalState));
        expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
        expect(finalState.balances[nativeTokenHash] ?? 0n).toBe(initialBalanceNative - nativeTokenValue);
        expect(finalState.pendingCoins.length).toBe(0);
        expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
      };

      for (const address of addresses) {
        await sendTx(address);
      }
    },
    timeout,
  );

  test(
    'Is working for preparing the stable wallet',
    async () => {
      const walletStable = await WalletBuilder.buildFromSeed(
        fixture.getIndexerUri(),
        fixture.getIndexerWsUri(),
        fixture.getProverUri(),
        fixture.getNodeUri(),
        seedStable,
        networkId,
        'info',
      );

      walletStable.start();
      const addressStable = (await firstValueFrom(walletStable.state())).address;
      await closeWallet(walletStable);

      await waitForSync(walletFunded);
      const initialState = await firstValueFrom(walletFunded.state());
      const initialBalance = initialState.balances[nativeToken()] ?? 0n;
      const initialBalanceNative = initialState.balances[nativeTokenHash] ?? 0n;
      const initialBalanceNative2 = initialState.balances[nativeTokenHash2] ?? 0n;
      logger.info(`Wallet 1: ${initialBalance} tDUST`);
      logger.info(`Wallet 1: ${initialBalanceNative} ${nativeTokenHash}`);
      logger.info(`Wallet 1: ${initialBalanceNative2} ${nativeTokenHash2}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(
        `Sending ${
          outputValue / 1_000_000n
        } tDUST and ${nativeTokenValue} ${nativeTokenHash} to address: ${addressStable}`,
      );

      const outputsToCreate = [
        {
          type: nativeToken(),
          amount: outputValue,
          receiverAddress: addressStable,
        },
        {
          type: nativeTokenHash,
          amount: nativeTokenValue,
          receiverAddress: addressStable,
        },
      ];

      const outputsToCreate2 = [
        {
          type: nativeTokenHash2,
          amount: nativeTokenValue2,
          receiverAddress: addressStable,
        },
      ];

      const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      const provenTx = await walletFunded.proveTransaction(txToProve);
      const id = await walletFunded.submitTransaction(provenTx);
      logger.info('Transaction id: ' + id);
      await waitForTxInHistory(id, walletFunded);

      logger.info(`Sending ${nativeTokenValue2} ${nativeTokenHash2} to address: ${addressStable}`);
      const txToProve2 = await walletFunded.transferTransaction(outputsToCreate2);
      const provenTx2 = await walletFunded.proveTransaction(txToProve2);
      const id2 = await walletFunded.submitTransaction(provenTx2);
      logger.info('Transaction id: ' + id2);
      await waitForTxInHistory(id2, walletFunded);
      const finalState = await waitForSync(walletFunded);
      logger.info(walletStateTrimmed(finalState));
      expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(finalState.balances[nativeTokenHash] ?? 0n).toBe(initialBalanceNative - nativeTokenValue);
      expect(finalState.balances[nativeTokenHash2] ?? 0n).toBe(initialBalanceNative2 - nativeTokenValue2);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 2);

      // TO-DO: contract deploy and call, obtaining minted token from contract
    },
    timeout,
  );
});
