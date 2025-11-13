/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/no-base-to-string */
import { firstValueFrom } from 'rxjs';
import { TestContainersFixture, useTestContainersFixture } from './test-fixture.js';
import { nativeToken, ZswapSecretKeys } from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { exit } from 'node:process';
import { ShieldedWallet, ShieldedWalletClass } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';

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
  const rawNativeTokenType = (nativeToken() as { tag: string; raw: string }).raw;
  const nativeTokenHash = '02000000000000000000000000000000000000000000000000000000000000000001';
  const nativeTokenHash2 = '02000000000000000000000000000000000000000000000000000000000000000002';
  const secretKey = ZswapSecretKeys.fromSeed(utils.getShieldedSeed(seedFunded));

  let Wallet: ShieldedWalletClass;
  let walletFunded: ShieldedWallet;
  let fixture: TestContainersFixture;
  let networkId: NetworkId.NetworkId;

  beforeEach(() => {
    fixture = getFixture();
    switch (TestContainersFixture.network) {
      case 'undeployed':
        networkId = NetworkId.NetworkId.Undeployed;
        break;
      case 'devnet':
        networkId = NetworkId.NetworkId.DevNet;
        break;
      case 'testnet':
        networkId = NetworkId.NetworkId.TestNet;
        break;
    }

    const walletConfig: DefaultV1Configuration = fixture.getWalletConfig();
    Wallet = ShieldedWallet(walletConfig);
    walletFunded = Wallet.startWithShieldedSeed(Buffer.from(seedFunded, 'hex'));
  });

  afterEach(async () => {
    await walletFunded.stop();
  });

  test(
    'Is working for distribution to the test wallets',
    async () => {
      if (process.env['ADDRESSES'] === undefined) {
        logger.info('ADDRESSES env var not set');
        exit(1);
      }
      const addresses = process.env['ADDRESSES'].split(',');

      await utils.waitForSyncShielded(walletFunded);

      const sendTx = async (address: string): Promise<void> => {
        const initialState = await firstValueFrom(walletFunded.state);
        const initialBalance = initialState.balances[rawNativeTokenType] ?? 0n;
        const initialBalanceNative = initialState.balances[nativeTokenHash] ?? 0n;
        logger.info(`Wallet 1: ${initialBalance} tDUST`);
        logger.info(`Wallet 1: ${initialBalanceNative} ${nativeTokenHash}`);
        logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
        logger.info(
          `Sending ${outputValue / 1_000_000n} tDUST and ${nativeTokenValue} ${nativeTokenHash} to address: ${address}`,
        );

        const outputsToCreate = [
          {
            type: rawNativeTokenType,
            amount: outputValue,
            receiverAddress: address,
          },
          {
            type: nativeTokenHash,
            amount: nativeTokenValue,
            receiverAddress: address,
          },
        ];

        const txToProve = await walletFunded.transferTransaction(secretKey, outputsToCreate);
        const provenTx = await walletFunded.finalizeTransaction(txToProve);
        const id = await walletFunded.submitTransaction(provenTx);
        logger.info('Transaction id: ' + id);

        const pendingState = await utils.waitForPending(walletFunded);
        // logger.info(utils.walletStateTrimmed(pendingState));
        logger.info(`Wallet 1 available coins: ${pendingState.availableCoins.length}`);

        const finalState = await utils.waitForFinalizedBalance(walletFunded);
        // logger.info(utils.walletStateTrimmed(finalState));
        expect(finalState.balances[rawNativeTokenType] ?? 0n).toBeLessThan(initialBalance - outputValue);
        expect(finalState.balances[nativeTokenHash] ?? 0n).toBe(initialBalanceNative - nativeTokenValue);
        expect(finalState.pendingCoins.length).toBe(0);
        // expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 1);
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
      const walletStable: ShieldedWallet = Wallet.startWithShieldedSeed(Buffer.from(seedStable, 'hex'));

      const addressStable = (await firstValueFrom(walletStable.state)).address;
      const walletAddressStable = utils.getShieldedAddress(networkId, addressStable);
      await walletStable.stop();

      await utils.waitForSyncShielded(walletFunded);
      const initialState = await firstValueFrom(walletFunded.state);
      const initialBalance = initialState.balances[rawNativeTokenType] ?? 0n;
      const initialBalanceNative = initialState.balances[nativeTokenHash] ?? 0n;
      const initialBalanceNative2 = initialState.balances[nativeTokenHash2] ?? 0n;
      logger.info(`Wallet 1: ${initialBalance} tDUST`);
      logger.info(`Wallet 1: ${initialBalanceNative} ${nativeTokenHash}`);
      logger.info(`Wallet 1: ${initialBalanceNative2} ${nativeTokenHash2}`);
      logger.info(`Wallet 1 available coins: ${initialState.availableCoins.length}`);
      logger.info(
        `Sending ${
          outputValue / 1_000_000n
        } tDUST and ${nativeTokenValue} ${nativeTokenHash} to address: ${walletAddressStable}`,
      );

      const outputsToCreate = [
        {
          type: rawNativeTokenType,
          amount: outputValue,
          receiverAddress: walletAddressStable,
        },
        {
          type: nativeTokenHash,
          amount: nativeTokenValue,
          receiverAddress: walletAddressStable,
        },
      ];

      const outputsToCreate2 = [
        {
          type: nativeTokenHash2,
          amount: nativeTokenValue2,
          receiverAddress: walletAddressStable,
        },
      ];

      const txToProve = await walletFunded.transferTransaction(secretKey, outputsToCreate);
      const provenTx = await walletFunded.finalizeTransaction(txToProve);
      const id = await walletFunded.submitTransaction(provenTx);
      logger.info('Transaction id: ' + id);
      // await utils.waitForTxInHistory(String(id), walletFunded);

      logger.info(`Sending ${nativeTokenValue2} ${nativeTokenHash2} to address: ${walletAddressStable}`);
      const txToProve2 = await walletFunded.transferTransaction(secretKey, outputsToCreate2);
      const provenTx2 = await walletFunded.finalizeTransaction(txToProve2);
      const id2 = await walletFunded.submitTransaction(provenTx2);
      logger.info('Transaction id: ' + id2);
      // await utils.waitForTxInHistory(String(id2), walletFunded);
      const finalState = await utils.waitForSyncShielded(walletFunded);
      // logger.info(utils.walletStateTrimmed(finalState));
      expect(finalState.balances[rawNativeTokenType] ?? 0n).toBeLessThan(initialBalance - outputValue);
      expect(finalState.balances[nativeTokenHash] ?? 0n).toBe(initialBalanceNative - nativeTokenValue);
      expect(finalState.balances[nativeTokenHash2] ?? 0n).toBe(initialBalanceNative2 - nativeTokenValue2);
      expect(finalState.pendingCoins.length).toBe(0);
      // expect(finalState.transactionHistory.length).toBeGreaterThanOrEqual(initialState.transactionHistory.length + 2);

      // TO-DO: contract deploy and call, obtaining minted token from contract
    },
    timeout,
  );
});
