import { firstValueFrom } from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { exit } from 'node:process';
import { logger } from './logger.js';
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
  if (process.env['SEED2'] === undefined || process.env['SEED'] === undefined) {
    logger.info('SEED or SEED2 env vars not set');
    exit(1);
  }
  const getFixture = useTestContainersFixture();
  const seed = process.env['SEED2'];
  const seedFunded = process.env['SEED'];
  const initialReceiverShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seed));
  const initialFundedShieldedSecretKey = ledger.ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seedFunded));
  const initialReceiverDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seed));
  const initialFundedDustSecretKey = ledger.DustSecretKey.fromSeed(utils.getDustSeed(seedFunded));
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const unshieldedTokenRaw = ledger.unshieldedToken().raw;
  const syncTimeout = (1 * 60 + 30) * 60 * 1000; // 1 hour + 30 minutes in milliseconds
  const timeout = 600_000;
  const outputValue = 10_000n;

  let sender: WalletFacade;
  let receiver: WalletFacade;
  let wallet: WalletFacade;
  let wallet2: WalletFacade;
  let senderShieldedSecretKey: ledger.ZswapSecretKeys;
  let senderDustKey: ledger.DustSecretKey;
  let senderKeyStore: UnshieldedKeystore;
  let fixture: TestContainersFixture;
  let networkId: NetworkId.NetworkId;

  const filenameWallet = `${seedFunded.substring(0, 7)}-${TestContainersFixture.deployment}.state`;
  const filenameWallet2 = `${seed.substring(0, 7)}-${TestContainersFixture.deployment}.state`;

  beforeAll(async () => {
    fixture = getFixture();
    networkId = fixture.getNetworkId();

    wallet = await utils.buildWalletFacade(seedFunded, fixture);
    wallet2 = await utils.buildWalletFacade(seed, fixture);
    await wallet.start(initialFundedShieldedSecretKey, initialFundedDustSecretKey);
    await wallet2.start(initialReceiverShieldedSecretKey, initialReceiverDustSecretKey);
    logger.info('Two wallets started');
    logger.info(`shielded token type: ${shieldedTokenRaw}`);
    logger.info(`unshielded token type: ${unshieldedTokenRaw}`);

    const date = new Date();
    const hour = date.getHours();

    if (hour % 2 !== 0) {
      logger.info('Using SEED2 as receiver');
      sender = wallet;
      senderShieldedSecretKey = initialFundedShieldedSecretKey;
      senderDustKey = initialFundedDustSecretKey;
      receiver = wallet2;
      senderKeyStore = createKeystore(utils.getUnshieldedSeed(seedFunded), networkId);
    } else {
      logger.info('Using SEED2 as sender');
      sender = wallet2;
      senderShieldedSecretKey = initialReceiverShieldedSecretKey;
      senderDustKey = initialReceiverDustSecretKey;
      receiver = wallet;
      senderKeyStore = createKeystore(utils.getUnshieldedSeed(seed), networkId);
    }
  }, syncTimeout);

  afterAll(async () => {
    await utils.saveState(sender.shielded, filenameWallet);
    await utils.saveState(receiver.shielded, filenameWallet2);
    await utils.closeWallet(sender);
    await utils.closeWallet(receiver);
  }, timeout);

  test(
    'Is working for valid transfer @healthcheck',
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
      const initialReceiverShieldedBalance = initialReceiverState.shielded.balances[shieldedTokenRaw];
      const initialReceiverUnshieldedBalance = initialReceiverState.unshielded.balances.get(unshieldedTokenRaw);
      const initialReceiverDustBalance = initialReceiverState.dust.walletBalance(new Date());
      logger.info(`Wallet 2: ${initialReceiverShieldedBalance} shielded tokens`);
      logger.info(`Wallet 2: ${initialReceiverUnshieldedBalance} shielded tokens`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(
                NetworkId.NetworkId.Undeployed,
                initialReceiverState.shielded.address,
              ),
            },
          ],
        },
        {
          type: 'unshielded',
          outputs: [
            {
              type: unshieldedTokenRaw,
              amount: outputValue,
              receiverAddress: initialReceiverState.unshielded.address,
            },
          ],
        },
      ];

      const txToProve = await sender.transferTransaction(
        senderShieldedSecretKey,
        senderDustKey,
        outputsToCreate,
        new Date(Date.now() + 30 * 60 * 1000),
      );
      const signedTx = await sender.signTransaction(txToProve.transaction, (payload) =>
        senderKeyStore.signData(payload),
      );
      const provenTx = await sender.finalizeTransaction({ ...txToProve, transaction: signedTx });
      const txId = await sender.submitTransaction(provenTx);
      logger.info('txProcessing');
      logger.info('Transaction id: ' + txId);

      const pendingState = await utils.waitForFacadePending(sender);
      // logger.info(utils.walletStateTrimmed(pendingState));
      expect(pendingState.shielded.balances[shieldedTokenRaw] ?? 0n).toBeLessThanOrEqual(
        initialShieldedBalance - outputValue,
      );
      expect(pendingState.unshielded.balances.get(unshieldedTokenRaw)).toBeLessThanOrEqual(
        (initialUnshieldedBalance ?? 0n) - outputValue,
      );
      expect(pendingState.shielded.availableCoins.length).toBeLessThanOrEqual(
        initialState.shielded.availableCoins.length,
      );
      expect(pendingState.shielded.pendingCoins.length).toBeGreaterThanOrEqual(1);
      expect(pendingState.unshielded.pendingCoins.length).toBeGreaterThanOrEqual(1);
      expect(pendingState.dust.pendingCoins.length).toBeGreaterThanOrEqual(1);
      // expect(pendingState.totalCoins.length).toBe(initialState.shielded.totalCoins.length);
      // expect(pendingState.nullifiers.length).toBe(initialState.nullifiers.length);
      // expect(pendingState.transactionHistory.length).toBe(initialState.transactionHistory.length);

      logger.info('waiting for tx in history');
      // await waitForTxInHistory(txId, sender);
      await utils.waitForFacadePendingClear(sender);
      const finalState = await utils.waitForSyncFacade(sender);
      // logger.info(walletStateTrimmed(finalState));
      const senderFinalShieldedBalance = finalState.shielded.balances[shieldedTokenRaw];
      const senderFinalUnshieldedBalance = finalState.unshielded.balances.get(unshieldedTokenRaw);
      const senderFinalDustBalance = finalState.dust.walletBalance(new Date(3 * 1000));
      logger.info(`Wallet 1 final available dust: ${senderFinalDustBalance}`);
      logger.info(`Wallet 1 final available shielded coins: ${senderFinalShieldedBalance}`);
      logger.info(`Wallet 1 final available unshielded coins: ${senderFinalUnshieldedBalance}`);
      expect(senderFinalShieldedBalance).toBe(initialShieldedBalance - outputValue);
      expect(senderFinalUnshieldedBalance).toBe(initialUnshieldedBalance ?? 0n - outputValue);
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
      const receiverFinalShieldedBalance = finalState.shielded.balances[shieldedTokenRaw];
      const receiverFinalUnshieldedBalance = finalState.unshielded.balances.get(unshieldedTokenRaw);
      const receiverFinalDustBalance = finalState.dust.walletBalance(new Date(3 * 1000));
      logger.info(`Wallet 2 final available shielded coins: ${receiverFinalShieldedBalance}`);
      logger.info(`Wallet 2 final available unshielded coins: ${receiverFinalUnshieldedBalance}`);
      expect(receiverFinalShieldedBalance).toBe(initialReceiverShieldedBalance + outputValue);
      expect(receiverFinalUnshieldedBalance).toBe(initialReceiverUnshieldedBalance ?? 0n + outputValue);
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
        senderShieldedSecretKey,
        senderDustKey,
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
    timeout,
  );

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx fails on node',
    async () => {
      allure.tms('PM-8919', 'PM-8919');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid transaction');
      const initialState = await firstValueFrom(sender.state());
      const syncedState = await utils.waitForSyncFacade(sender);
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 25000000000000000n;

      const initialState2 = await firstValueFrom(receiver.state());
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw];
      if (initialBalance2 === undefined || initialBalance2 === 0n) {
        logger.info(`Waiting to receive tokens...`);
      }

      // const outputsToCreate = [
      //   {
      //     type: rawNativeTokenType,
      //     amount: outputValue,
      //     receiverAddress: initialState2.address,
      //   },
      // ];
      const coin = ledger.createShieldedCoinInfo(shieldedTokenRaw, balance);
      const output = ledger.ZswapOutput.new(
        coin,
        0,
        initialState.shielded.coinPublicKey.toHexString(),
        initialState.shielded.encryptionPublicKey.toHexString(),
      );
      const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenRaw, outputValue);
      const unprovenTx = ledger.Transaction.fromParts(networkId, offer);
      const provenTx = await sender.finalizeTransaction({
        type: 'TransactionToProve',
        transaction: unprovenTx,
      });
      // const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      // const provenTx = await walletFunded.proveTransaction(txToProve);
      await expect(
        Promise.all([sender.submitTransaction(provenTx), sender.submitTransaction(provenTx)]),
      ).rejects.toThrow();
      // const txToProve = await walletFunded.transferTransaction(outputsToCreate);
      // const provenTx = await walletFunded.proveTransaction(txToProve);
      // const id = await walletFunded.submitTransaction(provenTx);
      // logger.info('Transaction id: ' + id);

      // const pendingState = await waitForPending(walletFunded);
      // logger.info(pendingState);
      // expect(pendingState.balances[rawNativeTokenType]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(2);

      const finalState = await utils.waitForFinalizedBalance(sender.shielded);
      // const finalState = await waitForTxHistory(walletFunded, 2);
      expect(finalState.balances[shieldedTokenRaw]).toBe(balance);
      expect(finalState.availableCoins.length).toBe(5);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.totalCoins.length).toBe(5);
      // expect(finalState.transactionHistory.length).toBe(1);

      // const finalState2 = await waitForFinalizedBalance(wallet2);
      // logger.info(finalState2);
      // expect(finalState2.balances[rawNativeTokenType]).toBe(outputValue);
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
      allure.tms('PM-8917', 'PM-8917');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Transaction not proved');
      const syncedState = await utils.waitForSyncFacade(sender);
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      logger.info('Stopping proof server container..');
      await fixture.getProofServerContainer().stop({ timeout: 10_000 });

      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: utils.getShieldedAddress(networkId, initialState2.shielded.address),
            },
          ],
        },
      ];

      const txToProve = await sender.transferTransaction(
        senderShieldedSecretKey,
        senderDustKey,
        outputsToCreate,
        new Date(),
      );
      await expect(sender.finalizeTransaction(txToProve)).rejects.toThrow();

      // const pendingState = await waitForPending(walletFunded);
      // logger.info(pendingState);
      // expect(pendingState.balances[rawNativeTokenType]).toBe(20000000000000000n);
      // expect(pendingState.availableCoins.length).toBe(4);
      // expect(pendingState.pendingCoins.length).toBe(1);
      // expect(pendingState.coins.length).toBe(5);
      // expect(pendingState.transactionHistory.length).toBe(1);

      const finalState = await utils.waitForFinalizedBalance(sender.shielded);
      expect(finalState).toMatchObject(syncedState);
      // expect(finalState.balances[rawNativeTokenType]).toBe(initialBalance);
      // expect(finalState.availableCoins.length).toBe(5);
      // expect(finalState.pendingCoins.length).toBe(0);
      // expect(finalState.coins.length).toBe(5);
      // expect(finalState.transactionHistory.length).toBe(1);
    },
    timeout,
  );

  test(
    'error message when attempting to send to an invalid address',
    async () => {
      allure.tms('PM-9678', 'PM-9678');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid address error message');
      const syncedState = await utils.waitForSyncFacade(sender);
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const invalidAddress = 'invalidAddress';

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: invalidAddress,
            },
          ],
        },
      ];
      await expect(
        sender.transferTransaction(senderShieldedSecretKey, senderDustKey, outputsToCreate, new Date()),
      ).rejects.toThrow(
        `InvalidAddressError: Can't decode an address. Bech32m parse exception: Error: String must be lowercase or uppercase. Hex parse exception: Invalid HEX address format ${invalidAddress}`,
      );
    },
    timeout,
  );

  test(
    'error message when attempting to send an invalid amount',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(sender);
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      // the max amount that we support: Rust u64 max. The entire Midnight supply
      // is 24 billion tDUST, 1 tDUST = 10^6 specks, which is lesser
      // Check below amount is still erroring with invalid transaction after rewrite
      // const invalidAmount = 18446744073709551616n;
      const aboveBalance = initialBalance + 1000n;
      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: aboveBalance,
              receiverAddress: utils.getShieldedAddress(networkId, initialState2.shielded.address),
            },
          ],
        },
      ];
      try {
        const txToProve = await sender.transferTransaction(
          senderShieldedSecretKey,
          senderDustKey,
          outputsToCreate,
          new Date(),
        );
        const provenTx = await sender.finalizeTransaction(txToProve);
        await sender.submitTransaction(provenTx);
      } catch (e: unknown) {
        if (e instanceof Error) {
          expect(e.message).toContain(
            'Insufficient Funds: could not balance 02000000000000000000000000000000000000000000000000000000000000000000',
          );
        } else {
          logger.info(e);
        }
      }
    },
    timeout,
  );

  test(
    'error message when attempting to send a negative amount',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(sender);
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: -5n,
              receiverAddress: utils.getShieldedAddress(networkId, initialState2.shielded.address),
            },
          ],
        },
      ];
      await expect(
        sender.transferTransaction(senderShieldedSecretKey, senderDustKey, outputsToCreate, new Date()),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting to send a zero amount',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(sender);
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const initialState2 = await firstValueFrom(receiver.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: 0n,
              receiverAddress: utils.getShieldedAddress(networkId, initialState2.shielded.address),
            },
          ],
        },
      ];

      await expect(
        sender.transferTransaction(senderShieldedSecretKey, senderDustKey, outputsToCreate, new Date()),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting to send an empty array of outputs',
    async () => {
      allure.tms('PM-9679', 'PM-9679');
      allure.epic('Headless wallet');
      allure.feature('Transactions');
      allure.story('Invalid amount error message');
      const syncedState = await utils.waitForSyncFacade(sender);
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      await expect(sender.transferTransaction(senderShieldedSecretKey, senderDustKey, [], new Date())).rejects.toThrow(
        'The amount needs to be positive',
      );
    },
    timeout,
  );

  test('error message when sending token to bech32m address from different networkId', async () => {
    allure.tms('PM-14147', 'PM-14147');
    allure.epic('Headless wallet');
    allure.feature('Wallet state - Bech32m');
    allure.story('Tx to addresss from different networkId');
    const bech32mAddress =
      'mn_shield-addr_undeployed1kav2zmw5u5qtvfpcx0xnkdrsrsmnqpxd8c6rt6nrqs34yy0ttahsxqpmpljwuf6rjg0pzseww9l8xlpjwjf2sxackw69numxqs9ag2hphgx2cfjgtqvqyaeqtx97rpvy0sp2gmc60zreapu488v043';

    const syncedState = await utils.waitForSyncFacade(sender);
    const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
    logger.info(`Wallet 1 balance is: ${initialBalance}`);

    const outputsToCreate: CombinedTokenTransfer[] = [
      {
        type: 'shielded',
        outputs: [
          {
            type: shieldedTokenRaw,
            amount: 0n,
            receiverAddress: bech32mAddress,
          },
        ],
      },
    ];

    await expect(
      sender.transferTransaction(senderShieldedSecretKey, senderDustKey, outputsToCreate, new Date()),
    ).rejects.toThrow(
      "InvalidAddressError: Can't decode an address. Bech32m parse exception: Error: Expected dev address, got undeployed one. Hex parse exception: Invalid HEX address format mn_shield-addr_undeployed1kav2zmw5u5qtvfpcx0xnkdrsrsmnqpxd8c6rt6nrqs34yy0ttahsxqpmpljwuf6rjg0pzseww9l8xlpjwjf2sxackw69numxqs9ag2hphgx2cfjgtqvqyaeqtx97rpvy0sp2gmc60zreapu488v043",
    );
  });

  test('error message when sending token to bech32m address from different chain', async () => {
    allure.tms('PM-14148', 'PM-14148');
    allure.epic('Headless wallet');
    allure.feature('Wallet state - Bech32m');
    allure.story('Tx to addresss from different chain');
    const bech32mAddress = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';

    const syncedState = await utils.waitForSyncFacade(sender);
    const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
    logger.info(`Wallet 1 balance is: ${initialBalance}`);

    const outputsToCreate: CombinedTokenTransfer[] = [
      {
        type: 'shielded',
        outputs: [
          {
            type: shieldedTokenRaw,
            amount: 0n,
            receiverAddress: bech32mAddress,
          },
        ],
      },
    ];

    await expect(
      sender.transferTransaction(senderShieldedSecretKey, senderDustKey, outputsToCreate, new Date()),
    ).rejects.toThrow(
      "InvalidAddressError: Can't decode an address. Bech32m parse exception: Error: Expected prefix mn. Hex parse exception: Invalid HEX address format",
    );
  });
});
