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
  path.resolve(currentDir, '..', 'logs', 'fundTestWallets.test.ts', `${new Date().toISOString()}.log`),
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
  const getFixture = useTestContainersFixture();
  const seedFunded = process.env.SEED;
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
    'Is working for distribution to the test wallets',
    async () => {
      await waitForSync(walletFunded);

      const addresses = [
        '32e3f356820369446e52f8420403000b8931dfe45710527a0cf5fa50a0b88b71|01000176a821ff9ca97629841f08d9b90b1aeb46f837d9c2f10bd5245ac30a4e9c4b6e',
        '914c57fb1323a2a19449c62a92e20f5eee14f9ce5e014cf0698989987b69165f|0100010e49aa79b723abf140adb7a45ee1ffdf7ac0838c35f156b39b9e25464e180f2c',
        '0388817e99dc7b3930ac412e39ad4dbcf96d35852559945b6dacd6c51fcfd062|0100016f6206bec6f7a165064a9e39ae2d0f05994627db1d082c502df46cf220bb68f1',
        '1d13cfbfea590acb51c8af8d762ac373aa7a077527f1af5bd59216cde90bb15d|01000105c4a96e902e96eff037cba32efcd1a99059ac367fd6c0e63b1950c393d8799f',
        '55a882a105bc15383e17dc5ce22e1aa380b6ad9636bfaaefc6c4daf8d6797515|010001930c269bc0befdc1f428ded5f324388a96d8c88dd2aa0da57b1c8751f8b07ba9',
        '3c187fb14935abdc568ea419608296b290e1d8d7b0489f32e65e3ccf4c865120|0100015f5e835439e9027d9e13b9fed3cfb237e9bf0794e0c2b0ca0422d1bce6b0efbf',
        'de55fee5ad5d4e3d79e85a9bb70a27f06b92b1f4dcb6cdc04a228764dea12e21|01000112a38fbc92abf8cecbd020e55fbaf6ea11a1a0e0276d5391dba5ceeb9985944d',
        '54c6a72f3e9f68faebec2641d6e56c312f9c39de05e7a5d6701bb28699e98506|0100016026ff59e85a29ec2de9bb10397969a5b3dc786ec57d0a83503385f02498a2f2',
        'b04d1408bd0184d1601fdde57c51d4288abd4c869d25c21c46dcf880f495df37|010001e14973e7d7ea87eaf968a61ead856351ec12cb042880c46f5cc3b5a9e78423f0',
        '28b79844af28b0d9f29b83ea58527b25a701d22b3b228ef06fced99a2e2a0137|010001886c931b814c3c189d1290747428b5684ff7f8d110f844ee6be9857d49c2ab19',
        '48870bbc006de6082de0eab4aa077559c2b1fd47ea99b6a50b8737fc9ec0f058|010001242e0e3faa5c7f7623d8797f706b45f8c90c000c51bc907308fa5b4ee5e8316d',
      ];

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

      for (const address of addresses) {
        await sendTx(address);
      }
    },
    timeout,
  );
});
