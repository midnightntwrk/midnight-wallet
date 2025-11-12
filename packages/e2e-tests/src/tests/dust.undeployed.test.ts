import { describe, test, expect } from 'vitest';
import * as rx from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import * as allure from 'allure-js-commons';
import { CombinedTokenTransfer, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

/**
 *
 * @group undeployed
 */

describe('Dust tests', () => {
  const getFixture = useTestContainersFixture();
  const seed = 'b7d32a5094ec502af45aa913b196530e155f17ef05bbf5d75e743c17c3824a82';
  const seedFunded = '0000000000000000000000000000000000000000000000000000000000000001';
  const fundedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seedFunded));
  const fundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seedFunded));
  const unshieldedFundedKeyStore = createKeystore(utils.getUnshieldedSeed(seedFunded), NetworkId.NetworkId.Undeployed);
  const receiverWalletSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
  const receiverWalletDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seed));
  const receiverKeystore = createKeystore(utils.getUnshieldedSeed(seed), NetworkId.NetworkId.Undeployed);
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const timeout = 240_000;
  const outputValue = 10000n * 10n ** 6n;

  let fixture: TestContainersFixture;
  let walletFunded: WalletFacade;
  let receiverWallet: WalletFacade;

  beforeEach(async () => {
    await allure.step('Start two wallets', async function () {
      fixture = getFixture();
      walletFunded = await utils.buildWalletFacade(seedFunded, fixture);
      receiverWallet = await utils.buildWalletFacade(seed, fixture);
      await walletFunded.start(fundedSecretKey, fundedDustSecretKey);
      await receiverWallet.start(receiverWalletSecretKey, receiverWalletDustSecretKey);
      logger.info('Two wallets started');
    });
  });

  afterEach(async () => {
    await utils.closeWallet(walletFunded);
    await utils.closeWallet(receiverWallet);
  }, 20_000);

  const sendAndRegisterNightUtxos = async () => {
    const initialState = await utils.waitForSyncFacade(walletFunded);
    const receiverInitialState = await utils.waitForSyncFacade(receiverWallet);
    const initialUnshieldedBalance = initialState.unshielded.balances.get(unshieldedTokenRaw);
    logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
    logger.info(`Wallet 1 total unshielded coins: ${initialState.unshielded.totalCoins.length}`);

    const outputsToCreate: CombinedTokenTransfer[] = [
      {
        type: 'unshielded',
        outputs: [
          {
            amount: outputValue,
            receiverAddress: receiverInitialState.unshielded.address,
            type: ledger.unshieldedToken().raw,
          },
        ],
      },
    ];

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const txToProve = await walletFunded.transferTransaction(
      fundedSecretKey,
      fundedDustSecretKey,
      outputsToCreate,
      ttl,
    );
    const signedTx = await walletFunded.signTransaction(txToProve.transaction, (payload) =>
      unshieldedFundedKeyStore.signData(payload),
    );
    const provenTx = await walletFunded.finalizeTransaction({ ...txToProve, transaction: signedTx });
    const txId = await walletFunded.submitTransaction(provenTx);
    logger.info('Transaction id: ' + txId);

    logger.info('Waiting for finalized balance...');
    await utils.waitForFacadePendingClear(walletFunded);
    await utils.waitForFacadePendingClear(receiverWallet);
    const receiverState2 = await utils.waitForSyncFacade(receiverWallet);
    const finalUnshieldedBalance = receiverState2.unshielded.balances.get(unshieldedTokenRaw);
    logger.info(`Wallet 2: ${finalUnshieldedBalance} unshielded tokens`);
    expect(finalUnshieldedBalance).toBe(outputValue);

    const nightUtxos = receiverState2.unshielded.availableCoins.filter(
      (coin) => coin.registeredForDustGeneration === false,
    );
    expect(nightUtxos.length).toBeGreaterThan(0);
    logger.info(`utxo length: ${nightUtxos.length}`);

    const dustRegistrationRecipe = await receiverWallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      receiverKeystore.getPublicKey(),
      (payload) => receiverKeystore.signData(payload),
    );

    const finalizedDustTx = await receiverWallet.finalizeTransaction(dustRegistrationRecipe);
    const dustRegistrationTxid = await receiverWallet.submitTransaction(finalizedDustTx);
    logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);
  };

  test(
    'Able to register Night tokens for Dust generation after receiving unshielded tokens @healthcheck',
    async () => {
      await sendAndRegisterNightUtxos();
      const initialWalletState = await utils.waitForSyncFacade(receiverWallet);
      const receiverDustBalance = await rx.firstValueFrom(
        receiverWallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.walletBalance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.walletBalance(new Date()) > 1000n),
          rx.map((s) => s.dust.walletBalance(new Date())),
        ),
      );

      expect(receiverDustBalance).toBeGreaterThan(0n);
      await rx.firstValueFrom(
        receiverWallet.state().pipe(
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
      const registerdNightUtxos = initialWalletState.unshielded.availableCoins.filter(
        (coin) => coin.registeredForDustGeneration === true,
      );
      expect(registerdNightUtxos.length).toBeGreaterThan(0);
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

      await sendAndRegisterNightUtxos();

      // Wait for registered tokens
      const initialWalletState = await rx.firstValueFrom(
        receiverWallet.state().pipe(
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
      const dustDeregistrationRecipe = await receiverWallet.deregisterFromDustGeneration(
        registerdNightUtxos.slice(0, deregisterTokens),
        receiverKeystore.getPublicKey(),
        (payload) => receiverKeystore.signData(payload),
      );

      const balancedTransactionRecipe = await receiverWallet.balanceTransaction(
        receiverWalletSecretKey,
        receiverWalletDustSecretKey,
        dustDeregistrationRecipe.transaction,
        new Date(Date.now() + 30 * 60 * 1000),
      );

      if (balancedTransactionRecipe.type !== 'TransactionToProve') {
        throw new Error('Expected a transaction to prove');
      }

      const finalizedDustTx = await receiverWallet.finalizeTransaction(balancedTransactionRecipe);
      const dustDeregistrationTxid = await receiverWallet.submitTransaction(finalizedDustTx);
      logger.info(`Dust de-registration tx id: ${dustDeregistrationTxid}`);

      const finalDustBalance = await rx.firstValueFrom(
        receiverWallet.state().pipe(
          rx.tap((s) => {
            const dustBalance = s.dust.walletBalance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter((s) => s.dust.walletBalance(new Date()) == 0n),
          rx.map((s) => s.dust.walletBalance(new Date())),
        ),
      );

      expect(finalDustBalance).toBe(0n);
    },
    timeout,
  );

  test(
    'Able to spend generated Dust',
    async () => {
      await sendAndRegisterNightUtxos();
      // Wait for dust balance to be generated
      const initialWalletState = await rx.firstValueFrom(
        receiverWallet.state().pipe(
          rx.tap((s) => {
            const registeredTokens = s.unshielded.availableCoins.filter(
              (coin) => coin.registeredForDustGeneration === true,
            );
            logger.info(`registered tokens: ${registeredTokens.length}`);
            const dustBalance = s.dust.walletBalance(new Date());
            logger.info(`Dust balance: ${dustBalance}`);
          }),
          rx.filter(
            (s) => s.unshielded.availableCoins.filter((coin) => coin.registeredForDustGeneration === true).length > 0,
          ),
          rx.filter((s) => s.dust.walletBalance(new Date()) > 1000n),
        ),
      );

      const initialUnshieldedBalance = initialWalletState.unshielded.balances.get(unshieldedTokenRaw);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);

      const initialFundedState = await utils.waitForSyncFacade(walletFunded);
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'unshielded',
          outputs: [
            {
              amount: outputValue,
              receiverAddress: initialFundedState.unshielded.address,
              type: ledger.unshieldedToken().raw,
            },
          ],
        },
      ];
      const ttl = new Date(Date.now() + 30 * 60 * 1000);
      const txToProve = await receiverWallet.transferTransaction(
        receiverWalletSecretKey,
        receiverWalletDustSecretKey,
        outputsToCreate,
        ttl,
      );
      const signedTx = await receiverWallet.signTransaction(txToProve.transaction, (payload) =>
        receiverKeystore.signData(payload),
      );
      const provenTx = await receiverWallet.finalizeTransaction({ ...txToProve, transaction: signedTx });
      const txId = await receiverWallet.submitTransaction(provenTx);
      expect(txId).toBeDefined();
      logger.info('Transaction id: ' + txId);
    },
    timeout,
  );
});
