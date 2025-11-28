import { describe, test, expect } from 'vitest';
import * as rx from 'rxjs';
import { useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { exit } from 'node:process';

describe('Dust tests', () => {
  if (process.env['SEED'] === undefined) {
    logger.info('SEED env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const seed = process.env['SEED'];
  const walletSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
  const walletDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seed));
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 240_000;
  const outputValue = 100n * 10n ** 6n;
  let walletFacade: WalletFacade;
  let walletKeystore: UnshieldedKeystore;

  beforeAll(async () => {
    const fixture = getFixture();
    const networkId = fixture.getNetworkId();
    walletFacade = await utils.buildWalletFacade(seed, fixture);

    walletKeystore = createKeystore(utils.getUnshieldedSeed(seed), networkId);
    await walletFacade.start(walletSecretKey, walletDustSecretKey);
  });

  afterAll(async () => {
    await utils.closeWallet(walletFacade);
  }, 20_000);

  test.only(
    'Able to register Night tokens for Dust generation @healthcheck',
    async () => {
      const initialState = await utils.waitForSyncFacade(walletFacade);
      const initialUnshieldedBalance = initialState.unshielded.balances.get(unshieldedTokenRaw);
      const initialDustBalance = initialState.dust.walletBalance(new Date());
      logger.info(`Wallet: ${initialUnshieldedBalance} unshielded tokens`);
      logger.info(`wallet dust balance: ${initialDustBalance}`);
      logger.info(`Wallet total unshielded coins: ${initialState.unshielded.availableCoins.length}`);
      logger.info(`output value: ${outputValue}`);

      const nightUtxos = initialState.unshielded.availableCoins.filter(
        (coin) => coin.registeredForDustGeneration === false,
      );
      expect(nightUtxos.length).toBeGreaterThan(0);
      logger.info(`utxo length: ${nightUtxos.length}`);

      const [firstNightUtxo] = nightUtxos;

      const dustRegistrationRecipe = await walletFacade.registerNightUtxosForDustGeneration(
        [firstNightUtxo],
        walletKeystore.getPublicKey(),
        (payload) => walletKeystore.signData(payload),
      );

      const finalizedDustTx = await walletFacade.finalizeTransaction(dustRegistrationRecipe);
      const dustRegistrationTxid = await walletFacade.submitTransaction(finalizedDustTx);
      expect(dustRegistrationTxid).toBeDefined();
      logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);
    },
    timeout,
  );

  test(
    'Able to deregister night tokens for dust decay',
    async () => {
      // allure.tag('smoke');
      // allure.tag('heanthcheck');
      // allure.tms('PM-8916', 'PM-8916');
      // allure.epic('Headless wallet');
      // allure.feature('Transactions');
      // allure.story('Valid transfer transaction');

      // Wait for registered tokens
      const initialWalletState = await rx.firstValueFrom(
        walletFacade.state().pipe(
          rx.tap((s) => {
            const registeredTokens = s.unshielded.availableCoins.filter(
              (coin) => coin.registeredForDustGeneration === true,
            );
            logger.info(`registered tokens: ${registeredTokens.length}`);
          }),
          rx.filter(
            (s) => s.unshielded.availableCoins.filter((coin) => coin.registeredForDustGeneration === true).length > 0,
          ),
        ),
      );
      const initialDustBalance = initialWalletState.dust.walletBalance(new Date());
      logger.info(`Initial Dust Balance: ${initialDustBalance}`);

      const registerdNightUtxos = initialWalletState.unshielded.availableCoins.filter(
        (coin) => coin.registeredForDustGeneration === true,
      );
      expect(registerdNightUtxos.length).toBeGreaterThan(0);

      const deregisterTokens = 2;
      const dustDeregistrationRecipe = await walletFacade.deregisterFromDustGeneration(
        registerdNightUtxos.slice(0, deregisterTokens),
        walletKeystore.getPublicKey(),
        (payload) => walletKeystore.signData(payload),
      );

      const balancedTransactionRecipe = await walletFacade.balanceTransaction(
        walletSecretKey,
        walletDustSecretKey,
        dustDeregistrationRecipe.transaction,
        new Date(Date.now() + 30 * 60 * 1000),
      );

      if (balancedTransactionRecipe.type !== 'TransactionToProve') {
        throw new Error('Expected a transaction to prove');
      }

      const finalizedDustTx = await walletFacade.finalizeTransaction(balancedTransactionRecipe);
      const dustDeregistrationTxid = await walletFacade.submitTransaction(finalizedDustTx);
      logger.info(`Dust de-registration tx id: ${dustDeregistrationTxid}`);
      const finalState = await utils.waitForSyncFacade(walletFacade);
      const finalDustBalance = finalState.dust.walletBalance(new Date());

      expect(finalDustBalance).toBeLessThan(initialDustBalance);
    },
    timeout,
  );
});
