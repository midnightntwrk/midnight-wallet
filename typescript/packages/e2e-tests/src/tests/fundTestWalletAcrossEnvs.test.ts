import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { nativeToken, NetworkId, setNetworkId } from '@midnight-ntwrk/zswap';
import { createLogger, waitForFinalizedBalance, waitForPending, waitForSync, walletStateTrimmed } from './utils';
import { Wallet } from '@midnight-ntwrk/wallet-api';
import { exit } from 'node:process';
import path from 'node:path';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const logger = await createLogger(
  path.resolve(currentDir, '..', 'logs', 'fundTestWalletAcrossEnvs.test.ts', `${new Date().toISOString()}.log`),
);

/**
 * Tests performing a token transfer
 *
 * @group devnet
 */

describe('Token transfer', () => {
  if (process.env.SEED === undefined) {
    logger.info('SEED env var not set');
    exit(1);
  }
  const seedFunded = process.env.SEED;
  const getFixture = useTestContainersFixture();
  const timeout = 3_600_000;
  const outputValue = 100_000_000n;

  let walletFunded: Wallet & Resource;
  let fixture: TestContainersFixture;

  beforeEach(async () => {
    fixture = getFixture();
    setNetworkId(NetworkId.DevNet);

    walletFunded = await WalletBuilder.buildFromSeed(
      fixture.getIndexerUri(),
      fixture.getIndexerWsUri(),
      fixture.getProverUri(),
      fixture.getNodeUri(),
      seedFunded,
      'info',
    );

    walletFunded.start();
  });

  afterEach(async () => {
    await walletFunded.close();
  });

  test(
    'Is working for distribution to the test wallet',
    async () => {
      if (process.env.WALLET_ADDRESS === undefined) {
        logger.info('WALLET_ADDRESS env var not set');
        exit(1);
      }
      const address = process.env.WALLET_ADDRESS;
      await waitForSync(walletFunded);

      const sendTx = async (address: string): Promise<void> => {
        const initialState = await firstValueFrom(walletFunded.state());
        const initialBalance = initialState.balances[nativeToken()] ?? 0n;
        logger.info(`Wallet 1: ${initialBalance}`);
        logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);

        const outputsToCreate = [
          {
            type: nativeToken(),
            amount: outputValue,
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
        logger.info(`Wallet 1 available coins: ${finalState.availableCoins.length}`);
        expect(finalState.balances[nativeToken()] ?? 0n).toBeLessThan(initialBalance - outputValue);
        expect(finalState.pendingCoins.length).toBe(0);
        expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
        logger.info(`Wallet 1: ${finalState.balances[nativeToken()]}`);
      };

      await sendTx(address);
    },
    timeout,
  );
});
