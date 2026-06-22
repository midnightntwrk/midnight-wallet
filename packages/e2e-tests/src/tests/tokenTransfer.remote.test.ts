// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// The `@healthcheck` token-transfer test is single-sourced in @midnightntwrk/wallet-sdk-testkit
// (shared with downstream monitoring). The remaining, upstream-only token-transfer tests live here
// and reuse the testkit's shared two-wallet setup via `useTokenTransferWallets`.
import { describe, test, expect } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { inspect } from 'node:util';
import * as ledger from '@midnight-ntwrk/ledger-v9';
import { type CombinedTokenTransfer } from '@midnightntwrk/wallet-sdk-facade';
import {
  type MidnightNetwork,
  useWalletTestEnvironment,
  tNightAmount,
  waitForFacadePending,
  waitForFinalizedShieldedBalance,
  waitForTxInHistory,
  expectSenderShieldedTxHistory,
  logger,
} from '@midnightntwrk/wallet-sdk-testkit';
import { createTestContainersEnvironment } from '@midnightntwrk/wallet-sdk-testkit/testcontainers';
import {
  registerTokenTransferHealthchecks,
  useTokenTransferWallets,
} from '@midnightntwrk/wallet-sdk-testkit/scenarios';

const getEnv = useWalletTestEnvironment(() =>
  createTestContainersEnvironment({ network: process.env['NETWORK'] as MidnightNetwork }),
);

const deps = {
  getEnv,
  fundedSeed: process.env['SEED']!,
  secondSeed: process.env['SEED2']!,
  syncCacheDir: process.env['SYNC_CACHE'],
};

// The single @healthcheck test, sourced from the testkit.
registerTokenTransferHealthchecks(deps);

// Upstream-only token-transfer tests (not shipped in the testkit). They share the testkit's
// two-wallet setup so the sender/receiver selection isn't duplicated.
describe('Token transfer (extended)', () => {
  const { getSender, getReceiver, getNetworkId } = useTokenTransferWallets(deps);
  const shieldedTokenRaw = ledger.shieldedToken().raw;
  const outputValue = tNightAmount(10n);
  const timeout = 600_000;

  test(
    'can perform a self-transaction',
    async () => {
      const sender = getSender();
      const initialState = await sender.wallet.waitForSyncedState();
      const initialBalance = initialState.shielded.balances[shieldedTokenRaw];
      logger.info(initialState.shielded.availableCoins);
      logger.info(`Wallet 1 shielded balance: ${initialBalance}`);
      logger.info(`Wallet 1 available shielded coins: ${initialState.shielded.availableCoins.length}`);

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: initialState.shielded.address,
            },
          ],
        },
      ];
      logger.info('Transfer transaction...');
      const txRecipe = await sender.wallet.transferTransaction(
        outputsToCreate,
        {
          shieldedSecretKeys: sender.shieldedSecretKeys,
          dustSecretKey: sender.dustSecretKey,
        },
        {
          ttl: new Date(Date.now() + 30 * 60 * 1000),
        },
      );
      logger.info('Transaction to prove...');
      logger.info(txRecipe);
      const finalizedTx = await sender.wallet.finalizeRecipe(txRecipe);
      logger.info('Submitting transaction...');
      logger.info(finalizedTx);
      const txId = await sender.wallet.submitTransaction(finalizedTx);
      logger.info('Transaction id: ' + txId);

      const pendingState = await waitForFacadePending(sender.wallet);
      logger.info(`Wallet 1 available coins: ${pendingState.shielded.availableCoins.length}`);
      logger.info(inspect(pendingState.shielded.pendingCoins, { depth: null }));
      expect(pendingState.shielded.availableCoins.length).toBeLessThan(initialState.shielded.availableCoins.length);
      expect(pendingState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);

      const txHash = finalizedTx.transactionHash();
      const txEntry = await waitForTxInHistory(txHash, sender.wallet, (e) => e.shielded !== undefined);
      const finalState = await sender.wallet.waitForSyncedState();
      logger.info(`Wallet 1 available coins: ${finalState.shielded.availableCoins.length}`);
      logger.info(`Wallet 1: ${finalState.shielded.balances[shieldedTokenRaw]}`);
      // actually deducted fees are greater - PM-7721
      expect(finalState.shielded.balances[shieldedTokenRaw]).toBe(initialBalance);
      expect(finalState.shielded.availableCoins.length).toBe(initialState.shielded.availableCoins.length);
      expect(finalState.shielded.pendingCoins.length).toBe(0);
      expect(finalState.shielded.totalCoins.length).toBe(initialState.shielded.totalCoins.length);

      // Self-transaction: sender has both spentCoins and receivedCoins
      expectSenderShieldedTxHistory(txEntry);
      expect(txEntry.shielded!.receivedCoins.length).toBeGreaterThan(0);
    },
    timeout,
  );

  test('Able to swap shielded tokens', async () => {
    const sender = getSender();
    const receiver = getReceiver();
    const shieldedToken1 = '0000000000000000000000000000000000000000000000000000000000000001';
    const shieldedToken2 = '0000000000000000000000000000000000000000000000000000000000000002';
    const ttl = new Date(Date.now() + 30 * 60 * 1000);

    const initialStateWallet1 = await sender.wallet.waitForSyncedState();
    const initialStateWallet2 = await receiver.wallet.waitForSyncedState();

    // Does walllet have shielded tokens to swap
    const wallet1BalanceToken1 = initialStateWallet1.shielded.balances[shieldedToken1] ?? 0n;
    const wallet1BalanceToken2 = initialStateWallet1.shielded.balances[shieldedToken2] ?? 0n;
    const wallet2BalanceToken1 = initialStateWallet2.shielded.balances[shieldedToken1] ?? 0n;
    const wallet2BalanceToken2 = initialStateWallet2.shielded.balances[shieldedToken2] ?? 0n;

    if (wallet1BalanceToken1 < 1000000n || wallet2BalanceToken2 < 1000000n) {
      logger.info('One of the wallets does not have enough shielded tokens to swap');
      return;
    }

    const swapTx = await sender.wallet.initSwap(
      { shielded: { [shieldedToken1]: 1000000n } },
      [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedToken2,
              amount: 1000000n,
              receiverAddress: initialStateWallet1.shielded.address,
            },
          ],
        },
      ],
      {
        shieldedSecretKeys: sender.shieldedSecretKeys,
        dustSecretKey: sender.dustSecretKey,
      },
      {
        ttl,
        payFees: false,
      },
    );
    const finalizedTx = await sender.wallet.finalizeRecipe(swapTx);
    const wallet1TxId = await sender.wallet.submitTransaction(finalizedTx);
    logger.info('Transaction id: ' + wallet1TxId);

    const wallet2BalancedTx = await receiver.wallet.balanceFinalizedTransaction(
      finalizedTx,
      {
        shieldedSecretKeys: receiver.shieldedSecretKeys,
        dustSecretKey: receiver.dustSecretKey,
      },
      {
        ttl,
      },
    );
    const finalizedSwapTx = await receiver.wallet.finalizeRecipe(wallet2BalancedTx);
    const wallet2TxId = await receiver.wallet.submitTransaction(finalizedSwapTx);
    logger.info('Transaction id 2: ' + wallet2TxId);

    const finalStateWallet1 = await waitForFinalizedShieldedBalance(sender.wallet.shielded);
    const finalStateWallet2 = await waitForFinalizedShieldedBalance(receiver.wallet.shielded);
    expect(finalStateWallet1.balances[shieldedToken1] ?? 0n).toBe(wallet1BalanceToken1 - 1000000n);
    expect(finalStateWallet1.balances[shieldedToken2] ?? 0n).toBe(wallet1BalanceToken2 + 1000000n);
    expect(finalStateWallet2.balances[shieldedToken2] ?? 0n).toBe(wallet2BalanceToken2 - 1000000n);
    expect(finalStateWallet2.balances[shieldedToken1] ?? 0n).toBe(wallet2BalanceToken1 + 1000000n);
  });

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx fails on node',
    async () => {
      const sender = getSender();
      const receiver = getReceiver();
      const networkId = getNetworkId();
      const initialState = await firstValueFrom(sender.wallet.state());
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const balance = 25000000000000000n;

      const initialState2 = await firstValueFrom(receiver.wallet.state());
      const initialBalance2 = initialState2.shielded.balances[shieldedTokenRaw];
      if (initialBalance2 === undefined || initialBalance2 === 0n) {
        logger.info(`Waiting to receive tokens...`);
      }

      const coin = ledger.createShieldedCoinInfo(shieldedTokenRaw, balance);
      const output = ledger.ZswapOutput.new(
        coin,
        0,
        initialState.shielded.coinPublicKey.toHexString(),
        initialState.shielded.encryptionPublicKey.toHexString(),
      );
      const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenRaw, outputValue);
      const unprovenTx = ledger.Transaction.fromParts(networkId, offer);
      const finalizedTx = await sender.wallet.finalizeTransaction(unprovenTx);
      await expect(
        Promise.all([sender.wallet.submitTransaction(finalizedTx), sender.wallet.submitTransaction(finalizedTx)]),
      ).rejects.toThrow();

      const finalState = await waitForFinalizedShieldedBalance(sender.wallet.shielded);
      expect(finalState.balances[shieldedTokenRaw]).toBe(balance);
      expect(finalState.availableCoins.length).toBe(5);
      expect(finalState.pendingCoins.length).toBe(0);
      expect(finalState.totalCoins.length).toBe(5);
    },
    timeout,
  );

  // TO-DO: check why pending is not used
  test.skip(
    'coin becomes available when tx does not get proved',
    async () => {
      const sender = getSender();
      const receiver = getReceiver();
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      // NOTE: this test needs to stop the proof server, which requires direct testcontainers
      // access that the WalletTestEnvironment abstraction intentionally hides. It stays skipped
      // until a control hook is exposed from createTestContainersEnvironment.
      logger.warn('Stopping proof server container is not available via the env abstraction; test is skipped');

      const initialState2 = await firstValueFrom(receiver.wallet.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: outputValue,
              receiverAddress: initialState2.shielded.address,
            },
          ],
        },
      ];

      const txRecipe = await sender.wallet.transferTransaction(
        outputsToCreate,
        {
          shieldedSecretKeys: sender.shieldedSecretKeys,
          dustSecretKey: sender.dustSecretKey,
        },
        {
          ttl: new Date(),
        },
      );
      await expect(sender.wallet.finalizeRecipe(txRecipe)).rejects.toThrow();

      const finalState = await waitForFinalizedShieldedBalance(sender.wallet.shielded);
      expect(finalState).toMatchObject(syncedState);
    },
    timeout,
  );

  test(
    'error message when attempting to send an invalid amount',
    async () => {
      const sender = getSender();
      const receiver = getReceiver();
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      // the max amount that we support: Rust u64 max. The entire Midnight supply
      // is 24 billion tDUST, 1 tDUST = 10^6 specks, which is lesser
      const aboveBalance = initialBalance + 1000n;
      const initialState2 = await firstValueFrom(receiver.wallet.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: aboveBalance,
              receiverAddress: initialState2.shielded.address,
            },
          ],
        },
      ];
      try {
        const txRecipe = await sender.wallet.transferTransaction(
          outputsToCreate,
          {
            shieldedSecretKeys: sender.shieldedSecretKeys,
            dustSecretKey: sender.dustSecretKey,
          },
          {
            ttl: new Date(),
          },
        );
        const finalizedTx = await sender.wallet.finalizeRecipe(txRecipe);
        await sender.wallet.submitTransaction(finalizedTx);
      } catch (e: unknown) {
        if (e instanceof Error) {
          expect(e.message).toContain('Insufficient funds');
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
      const sender = getSender();
      const receiver = getReceiver();
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      const initialState2 = await firstValueFrom(receiver.wallet.state());
      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: -5n,
              receiverAddress: initialState2.shielded.address,
            },
          ],
        },
      ];
      await expect(
        sender.wallet.transferTransaction(
          outputsToCreate,
          {
            shieldedSecretKeys: sender.shieldedSecretKeys,
            dustSecretKey: sender.dustSecretKey,
          },
          {
            ttl: new Date(),
          },
        ),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting to send a zero amount',
    async () => {
      const sender = getSender();
      const receiver = getReceiver();
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);
      const initialState2 = await firstValueFrom(receiver.wallet.state());

      const outputsToCreate: CombinedTokenTransfer[] = [
        {
          type: 'shielded',
          outputs: [
            {
              type: shieldedTokenRaw,
              amount: 0n,
              receiverAddress: initialState2.shielded.address,
            },
          ],
        },
      ];

      await expect(
        sender.wallet.transferTransaction(
          outputsToCreate,
          {
            shieldedSecretKeys: sender.shieldedSecretKeys,
            dustSecretKey: sender.dustSecretKey,
          },
          {
            ttl: new Date(),
          },
        ),
      ).rejects.toThrow('The amount needs to be positive');
    },
    timeout,
  );

  test(
    'error message when attempting to send an empty array of outputs',
    async () => {
      const sender = getSender();
      const syncedState = await sender.wallet.waitForSyncedState();
      const initialBalance = syncedState?.shielded.balances[shieldedTokenRaw] ?? 0n;
      logger.info(`Wallet 1 balance is: ${initialBalance}`);

      await expect(
        sender.wallet.transferTransaction(
          [],
          {
            shieldedSecretKeys: sender.shieldedSecretKeys,
            dustSecretKey: sender.dustSecretKey,
          },
          {
            ttl: new Date(),
          },
        ),
      ).rejects.toThrow('At least one shielded or unshielded output is required.');
    },
    timeout,
  );
});
