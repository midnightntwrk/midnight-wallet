import { firstValueFrom } from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { exit } from 'node:process';
import * as allure from 'allure-js-commons';
import { CombinedTokenTransfer, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

/**
 * Tests performing a token transfer
 *
 * @group devnet
 * @group testnet
 */

describe('Token transfer', () => {
  if (process.env['NT_SEED'] === undefined || process.env['NT_SEED2'] === undefined) {
    logger.info('NT_SEED or NT_SEED2 env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const receivingSeed = process.env['NT_SEED2'];
  const fundedSeed = process.env['NT_SEED'];
  const initialReceiverSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(receivingSeed));
  const initialFundedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(fundedSeed));
  const receiverDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(receivingSeed));
  const fundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(fundedSeed));
  const outputValue = 1n;
  const expectedTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';
  const shieldedTokenRaw = '02000000000000000000000000000000000000000000000000000000000000000001';
  const unshieldedTokenRaw = '02000000000000000000000000000000000000000000000000000000000000000001';
  const nativeToken1Raw = '0000000000000000000000000000000000000000000000000000000000000001';
  const nativeToken2Raw = '0000000000000000000000000000000000000000000000000000000000000002';

  let sender: WalletFacade;
  let receiver: WalletFacade;
  let wallet: WalletFacade;
  let wallet2: WalletFacade;
  let senderSecretKey: ledger.ZswapSecretKeys;
  let senderDustSecretKey: ledger.DustSecretKey;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let senderKeyStore: UnshieldedKeystore;
  let fixture: TestContainersFixture;
  let networkId: NetworkId.NetworkId;
  const syncTimeout = (1 * 60 + 30) * 60 * 1000; // 1 hour + 30 minutes in milliseconds
  const timeout = 600_000;

  const filenameWallet = `${fundedSeed.substring(0, 7)}-${TestContainersFixture.deployment}.state`;
  const filenameWallet2 = `${receivingSeed.substring(0, 7)}-${TestContainersFixture.deployment}.state`;

  beforeAll(async () => {
    fixture = getFixture();
    networkId = fixture.getNetworkId();

    wallet = await utils.buildWalletFacade(fundedSeed, fixture);
    wallet2 = await utils.buildWalletFacade(receivingSeed, fixture);

    await wallet.start(initialFundedSecretKey, fundedDustSecretKey);
    await wallet2.start(initialReceiverSecretKey, receiverDustSecretKey);

    const initialState = await utils.waitForSyncFacade(wallet);
    const initialNativeBalance = initialState.shielded.balances[expectedTokenHash] ?? 0n;
    logger.info(`initial balance: ${initialNativeBalance}`);

    if (initialNativeBalance === 0n) {
      logger.info('wallet 1 has 0 native token. Wallet 2 will be sender');
      sender = wallet2;
      senderSecretKey = initialReceiverSecretKey;
      senderDustSecretKey = receiverDustSecretKey;
      receiver = wallet;
      senderKeyStore = createKeystore(utils.getUnshieldedSeed(receivingSeed), networkId);
    } else {
      logger.info('native token in wallet 1. Wallet 1 will be sender');
      sender = wallet;
      senderSecretKey = initialFundedSecretKey;
      senderDustSecretKey = fundedDustSecretKey;
      receiver = wallet2;
      senderKeyStore = createKeystore(utils.getUnshieldedSeed(fundedSeed), networkId);
    }
  }, syncTimeout);

  afterAll(async () => {
    await utils.saveState(sender.shielded, filenameWallet);
    await utils.saveState(receiver.shielded, filenameWallet2);
    await utils.closeWallet(sender);
    await utils.closeWallet(receiver);
  }, timeout);

  test(
    'Is working for valid native token transfer @smoke @healthcheck',
    async () => {
      allure.tag('smoke');
      allure.tag('healthcheck');
      allure.tms('PM-8933', 'PM-8933');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer transaction using bech32m address');
      await Promise.all([utils.waitForSyncFacade(sender), utils.waitForSyncFacade(receiver)]);
      const initialState = await firstValueFrom(sender.state());
      const initialShieldedBalance = initialState.shielded.balances[shieldedTokenRaw];
      const initialUnshieldedBalance = initialState.unshielded.balances.get(unshieldedTokenRaw);
      const initialDustBalance = initialState.dust.walletBalance(new Date());
      logger.info(`Wallet 1: ${initialShieldedBalance} shielded tokens`);
      logger.info(`Wallet 1: ${initialUnshieldedBalance} shielded tokens`);
      logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1 available unshielded coins: ${initialState.unshielded.availableCoins.length}`);

      const initialReceiverState = await firstValueFrom(receiver.state());
      const initialReceiverShieldedBalance1 = initialReceiverState.shielded.balances[nativeToken1Raw];
      const initialReceiverShieldedBalance2 = initialReceiverState.shielded.balances[nativeToken2Raw];
      const initialReceiverUnshieldedBalance = initialReceiverState.unshielded.balances.get(unshieldedTokenRaw);
      const initialReceiverDustBalance = initialReceiverState.dust.walletBalance(new Date());
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance1} native token 1`);
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance2} native token 2`);
      logger.info(`Wallet 2: ${initialReceiverUnshieldedBalance} shielded tokens`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: nativeToken1Raw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialReceiverState.shielded.address,
              ),
            },
            {
              type: nativeToken2Raw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialReceiverState.shielded.address,
              ),
            },
          ],
        },
      ];

      const txToProve = await sender.transferTransaction(
        senderSecretKey,
        senderDustSecretKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      // const signedTx = await sender.signTransaction(
      //   txToProve.transaction,
      //   async (payload) => await Promise.resolve(senderKeyStore.signData(payload)),
      // );
      const provenTx = await sender.finalizeTransaction(txToProve);
      const txId = await sender.submitTransaction(provenTx);
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(sender);
      // logger.info(utils.walletStateTrimmed(pendingState));
      expect(pendingState.shielded.balances[nativeToken1Raw] ?? 0n).toBeLessThanOrEqual(
        initialShieldedBalance - outputValue,
      );
      expect(pendingState.shielded.balances[nativeToken2Raw] ?? 0n).toBeLessThanOrEqual(
        initialShieldedBalance - outputValue,
      );
      expect(pendingState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(pendingState.shielded.pendingCoins.length).toBeGreaterThanOrEqual(1);
      expect(pendingState.unshielded.pendingCoins.length).toBe(0);
      expect(pendingState.dust.pendingCoins.length).toBeGreaterThanOrEqual(1);
      // expect(pendingState.totalCoins.length).toBe(initialState.shielded.totalCoins.length);
      // expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      // expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      logger.info('waiting for tx in history');
      // await waitForTxInHistory(txId, sender);
      await utils.waitForFacadePendingClear(sender);
      const finalState = await utils.waitForSyncFacade(sender);
      // logger.info(walletStateTrimmed(finalState));
      const senderFinalShieldedBalance1 = finalState.shielded.balances[nativeToken1Raw];
      const senderFinalShieldedBalance2 = finalState.shielded.balances[nativeToken2Raw];
      const senderFinalUnshieldedBalance = finalState.unshielded.balances.get(unshieldedTokenRaw);
      const senderFinalDustBalance = finalState.dust.walletBalance(new Date(3 * 1000));
      logger.info(`Wallet 1 final available dust: ${senderFinalDustBalance}`);
      logger.info(`Wallet 1 final available shielded coins: ${senderFinalShieldedBalance1}`);
      logger.info(`Wallet 2 final available shielded coins: ${senderFinalShieldedBalance2}`);
      logger.info(`Wallet 1 final available unshielded coins: ${senderFinalUnshieldedBalance}`);
      expect(senderFinalShieldedBalance1).toBe(initialReceiverShieldedBalance1 - outputValue);
      expect(senderFinalShieldedBalance2).toBe(initialReceiverShieldedBalance2 - outputValue);
      expect(senderFinalUnshieldedBalance).toBe(initialUnshieldedBalance);
      expect(senderFinalDustBalance).toBeLessThan(initialDustBalance);
      expect(finalState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(finalState.dust.pendingCoins.length).toBe(0);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBeLessThanOrEqual(initialState.shielded.totalCoins.length);
      expect(finalState.unshielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.unshielded.availableCoins.length,
      );
      expect(finalState.unshielded.pendingCoins.length).toBe(0);
      expect(finalState.unshielded.totalCoins.length).toBeLessThanOrEqual(initialState.shielded.totalCoins.length);
      // expect(finalState.nullifiers.length).toBeLessThanOrEqual(initialState.nullifiers.length);
      // expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);

      // await waitForTxInHistory(txId, receiver);
      const finalState2 = await utils.waitForSyncFacade(receiver);
      // logger.info(walletStateTrimmed(finalState2));
      const receiverFinalShieldedBalance1 = finalState.shielded.balances[nativeToken1Raw];
      const receiverFinalShieldedBalance2 = finalState.shielded.balances[nativeToken2Raw];
      const receiverFinalUnshieldedBalance = finalState.unshielded.balances.get(unshieldedTokenRaw);
      const receiverFinalDustBalance = finalState.dust.walletBalance(new Date(3 * 1000));
      logger.info(`Wallet 2 final available shielded coins: ${receiverFinalShieldedBalance1}`);
      logger.info(`Wallet 2 final available shielded coins: ${receiverFinalShieldedBalance2}`);
      logger.info(`Wallet 2 final available unshielded coins: ${receiverFinalUnshieldedBalance}`);
      expect(receiverFinalShieldedBalance1).toBe(initialReceiverShieldedBalance1 + outputValue);
      expect(receiverFinalShieldedBalance2).toBe(initialReceiverShieldedBalance2 + outputValue);
      expect(receiverFinalUnshieldedBalance).toBe(0n);
      expect(finalState2.shielded.pendingCoins.length).toBe(0);
      expect(finalState2.shielded.totalCoins.length).toBeGreaterThanOrEqual(
        initialReceiverState.shielded.totalCoins.length + 1,
      );
      expect(receiverFinalDustBalance).toBe(initialReceiverDustBalance);
      // expect(finalState2.nullifiers.length).toBeGreaterThanOrEqual(initialState2.nullifiers.length + 1);
      // expect(finalState2.transactionHistory.length).toBeGreaterThanOrEqual(initialState2.transactionHistory.length + 1);
    },
    syncTimeout,
  );

  test(
    'can perform a self-transaction',
    async () => {
      allure.tag('smoke');
      allure.tms('PM-9680', 'PM-9680');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Valid transfer self-transaction');

      const initialState = await utils.waitForSyncFacade(sender);
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw];
      logger.info(initialState.shielded.availableCoins);
      logger.info(`Wallet 1: ${initialBalance}`);
      logger.info(`Wallet 1 available coins: ${initialState.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(networkId, initialState.shielded.address),
            },
          ],
        },
      ];
      const txToProve = await sender.transferTransaction(
        senderSecretKey,
        senderDustSecretKey,
        outputsToCreate,
        new Date(),
      );
      const provenTx = await sender.finalizeTransaction(txToProve);
      const txId = await sender.submitTransaction(provenTx);
      const fees = provenTx.fees(ledger.LedgerParameters.initialParameters());
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForPending(sender.shielded);
      // logger.info(utils.walletStateTrimmed(pendingState));
      logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);
      expect(pendingState.balances[shieldedTokenRaw] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(pendingState.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.pendingCoins.length).toBeLessThanOrEqual(1);
      expect(pendingState.totalCoins.length).toBe(initialState.shielded.totalCoins.length);
      // expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      // expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      // await utils.waitForTxInHistory(String(txId), sender.shielded);
      const finalState = await utils.waitForSyncFacade(sender);
      // logger.info(walletStateTrimmed(finalState));
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]}`);
      // actually deducted fees are greater - PM-7721
      expect(finalState.shielded.balances[shieldedTokenRaw] ?? 0n).toBeLessThanOrEqual(initialBalance - fees);
      expect(finalState.shielded.availableCoins.length).toBeGreaterThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBeGreaterThanOrEqual(initialState.shielded.totalCoins.length);
      // expect(finalState.nullifiers.length).toBeGreaterThanOrEqual(initialState.nullifiers.length);
      // expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
    },
    syncTimeout,
  );

  // test.skip(
  //   'coins become available when native token tx fails on node @smoke',
  //   async () => {
  //     allure.tag('smoke');
  //     allure.tms('PM-8936', 'PM-8936');
  //     allure.epic('Headless wallet');
  //     allure.feature('Transactions');
  //     allure.story('Invalid native token transaction');
  //     const initialState = await firstValueFrom(sender.state());
  //     const syncedState = await utils.waitForSyncShielded(sender.shielded);
  //     const initialDustBalance = syncedState?.balances[rawNativeTokenType] ?? 0n;
  //     Object.entries(initialState.shielded.balances).forEach(([key, _]) => {
  //       if (key !== rawNativeTokenType) tokenTypeHash = key;
  //     });
  //     if (tokenTypeHash === undefined) {
  //       throw new Error('No native tokens found');
  //     }
  //     const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
  //     logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
  //     logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

  //     const syncedState2 = await utils.waitForSyncShielded(receiver.shielded);
  //     const initialDustBalance2 = syncedState2?.balances[rawNativeTokenType] ?? 0n;
  //     const initialBalance2 = syncedState2?.balances[tokenTypeHash] ?? 0n;
  //     logger.info(`Wallet 1 balance is: ${initialDustBalance2} tDUST`);
  //     logger.info(`Wallet 1 balance is: ${initialBalance2} ${tokenTypeHash}`);

  //     const coin = createShieldedCoinInfo(tokenTypeHash, outputValue);
  //     const output = ledger.ZswapOutput.new(
  //       coin,
  //       Segments.guaranteed,
  //       initialState.shielded.coinPublicKey.toHexString(),
  //       initialState.shielded.encryptionPublicKey.toHexString(),
  //     );
  //     const offer = ledger.ZswapOffer.fromOutput(output, rawNativeTokenType, outputValue);
  //     const unprovenTx = ledger.Transaction.fromParts(networkId, offer).eraseProofs();
  //     const provenTx = await sender.finalizeTransaction({
  //       type: 'TransactionToProve',
  //       transaction: unprovenTx,
  //     });

  //     await expect(
  //       Promise.all([sender.submitTransaction(provenTx), sender.submitTransaction(provenTx)]),
  //     ).rejects.toThrow();

  //     const finalState = await utils.waitForFinalizedBalance(sender.shielded);
  //     expect(finalState).toMatchObject(syncedState);
  //     expect(finalState.balances[rawNativeTokenType]).toBe(initialDustBalance);
  //     expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
  //     expect(finalState.availableCoins.length).toBe(syncedState.availableCoins.length);
  //     expect(finalState.pendingCoins.length).toBe(0);
  //     expect(finalState.totalCoins.length).toBe(syncedState.totalCoins.length);
  //     // expect(finalState.transactionHistory.length).toBe(syncedState.transactionHistory.length);
  //   },
  //   timeout,
  // );

  // test(
  //   'coins become available when native token tx does not get proved',
  //   async () => {
  //     allure.tms('PM-8934', 'PM-8934');
  //     allure.epic('Headless wallet');
  //     allure.feature('Transactions');
  //     allure.story('Transaction not proved');
  //     const syncedState = await waitForSyncShielded(sender.shielded);
  //     const initialDustBalance = syncedState?.balances[rawNativeTokenType] ?? 0n;
  //     Object.entries(syncedState.balances).forEach(([key, _]) => {
  //       if (key !== rawNativeTokenType) tokenTypeHash = key;
  //     });
  //     if (tokenTypeHash === undefined) {
  //       throw new Error('No native tokens found');
  //     }
  //     const initialBalance = syncedState?.balances[tokenTypeHash] ?? 0n;
  //     logger.info(`Wallet 1 balance is: ${initialDustBalance} tDUST`);
  //     logger.info(`Wallet 1 balance is: ${initialBalance} ${tokenTypeHash}`);

  //     logger.info('Stopping proof server container..');
  //     await fixture.getProofServerContainer().stop({ timeout: 10_000 });

  //     const initialState2 = await firstValueFrom(receiver.state());

  //     const outputsToCreate: CombinedTokenTransfer[] = [
  //       {
  //         type: 'shielded',
  //         outputs: [
  //           {
  //             type: tokenTypeHash,
  //             amount: outputValue,
  //             receiverAddress: getShieldedAddress(networkId, initialState2.shielded.address),
  //           },
  //         ],
  //       },
  //     ];
  //     const txToProve = await sender.transferTransaction(
  //       senderSecretKey,
  //       senderDustSecretKey,
  //       outputsToCreate,
  //       new Date(),
  //     );
  //     await expect(sender.finalizeTransaction(txToProve)).rejects.toThrow();

  //     const finalState = await waitForFinalizedBalance(sender.shielded);
  //     expect(finalState).toMatchObject(syncedState);
  //     expect(finalState.balances[rawNativeTokenType]).toBe(initialDustBalance);
  //     expect(finalState.balances[tokenTypeHash]).toBe(initialBalance);
  //     expect(finalState.availableCoins.length).toBe(syncedState.availableCoins.length);
  //     expect(finalState.pendingCoins.length).toBe(0);
  //     expect(finalState.totalCoins.length).toBe(syncedState.totalCoins.length);
  //     // expect(finalState.transactionHistory.length).toBe(syncedState.transactionHistory.length);
  //   },
  //   timeout,
  // );
});
