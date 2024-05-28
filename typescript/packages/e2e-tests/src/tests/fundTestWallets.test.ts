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
        // Lace Tests
        '32e3f356820369446e52f8420403000b8931dfe45710527a0cf5fa50a0b88b71|01000176a821ff9ca97629841f08d9b90b1aeb46f837d9c2f10bd5245ac30a4e9c4b6e',
        '914c57fb1323a2a19449c62a92e20f5eee14f9ce5e014cf0698989987b69165f|0100010e49aa79b723abf140adb7a45ee1ffdf7ac0838c35f156b39b9e25464e180f2c',
        '0388817e99dc7b3930ac412e39ad4dbcf96d35852559945b6dacd6c51fcfd062|0100016f6206bec6f7a165064a9e39ae2d0f05994627db1d082c502df46cf220bb68f1',
        '1d13cfbfea590acb51c8af8d762ac373aa7a077527f1af5bd59216cde90bb15d|01000105c4a96e902e96eff037cba32efcd1a99059ac367fd6c0e63b1950c393d8799f',
        '7c4ff65763b449aadea55a477c81af9b013181aa318c0857e0fec55f9c4d2034|01000117e7c639cb384a3a189a285adae900b4de9440531578499b810d2d7345bd83b3',
        // Wallet tests
        '0b564a72ab1cda0c65d27fb2aa59dfd2f1eecd397015274e58da48ebd67cc808|010001b8778f8c2f14bf2f15c5d80f93f55f5ec8aea99e321f011d27107cbc4153dcdf',
        '8a235e714d3b484c777be4fd9e32992c593440221039cc5333970bb3eab6295c|010001bd0366818b3476605bbb411403075ed23b8bfc4840acb7654dfbc42e3d7d514e',
        'b829268c8932f07308fa86bc65949670a80d8cd49018474f414e904b90587e5d|01000126babb4e98e689d58133b95b744378e36281e246751e88ff26aa40b1e2d19701',
        '11e2fdc721690b3c3393b80336452c783e66489376b3971ede605d63b4b9c649|010001e1f6f241a777ff33c91e60cc613fb35f53cdd89d792ea089a6d64d19c4a6d781',
        // Pubsub Tests
        'de55fee5ad5d4e3d79e85a9bb70a27f06b92b1f4dcb6cdc04a228764dea12e21|01000112a38fbc92abf8cecbd020e55fbaf6ea11a1a0e0276d5391dba5ceeb9985944d',
        // DAO Tests
        '8b00a0ca300c46ed64fec104a11c3f3cb875eadc319045285d0365e52544d80a|01000138381db54746d2ff29096e18a0320d8e300401132b87b4e86c7943b82aaeb389',
        'b04d1408bd0184d1601fdde57c51d4288abd4c869d25c21c46dcf880f495df37|010001e14973e7d7ea87eaf968a61ead856351ec12cb042880c46f5cc3b5a9e78423f0',
        // Bboard Smoke Test
        '28b79844af28b0d9f29b83ea58527b25a701d22b3b228ef06fced99a2e2a0137|010001886c931b814c3c189d1290747428b5684ff7f8d110f844ee6be9857d49c2ab19',
        // Counter Smoke Test
        'cc40d2bea58f4b0236f80d109d6c30c014eaef4f73892d1a78a13661386b7604|0100017effb6eb31085756ad8f3218337565dc6fe6ce10f01652405fc6bd58ffa4ea85',
        // Welcome Smoke Test
        '59635b5c800718f646b6d625bd62fb1031e9e1feef476146cceea7de42011759|010001327575f94c032c37baa943a6553f5ee5ed50db460877582eff327108007a800d',
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
