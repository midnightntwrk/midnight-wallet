import { firstValueFrom } from 'rxjs';
import { Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture';
import { nativeToken, NetworkId } from '@midnight-ntwrk/zswap';
import { waitForFinalizedBalance, waitForPending, waitForSync, walletStateTrimmed } from './utils';
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
  if (process.env.SEED === undefined) {
    logger.info('SEED env var not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const seedFunded = process.env.SEED;
  const timeout = 3_600_000;
  const outputValue = 100_000_000n;
  const nativeTokenValue = 25n;
  const nativeTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';

  let walletFunded: Wallet & Resource;
  let fixture: TestContainersFixture;

  beforeEach(async () => {
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
    await walletFunded.close();
  });

  test(
    'Is working for distribution to the test wallets',
    async () => {
      if (process.env.ADDRESSES === undefined) {
        logger.info('ADDRESSES env var not set');
        exit(1);
      }
      const addresses = process.env.ADDRESSES.split(',');

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
});
