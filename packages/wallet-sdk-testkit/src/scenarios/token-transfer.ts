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
// Token-transfer healthcheck scenario. Only the `@healthcheck`-tagged test lives here — it is the
// one downstream monitoring (sentinel) consumes and so must be single-sourced. The remaining
// token-transfer tests (self-transaction, swap, error cases, dev TODOs) stay in the upstream
// e2e-tests suite; they share the two-wallet setup via the exported `useTokenTransferWallets`.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { inspect } from 'node:util';
import * as ledger from '@midnight-ntwrk/ledger-v9';
import { type NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { type CombinedTokenTransfer } from '@midnight-ntwrk/wallet-sdk-facade';
import { type WalletTestEnvironment } from '../types.js';
import { provideWallet, saveState, type WalletInit } from '../wallet.js';
import { tNightAmount } from '../primitives.js';
import { getShieldedAddress, getUnshieldedAddress } from '../addresses.js';
import { waitForTxInHistory } from '../state-waiters.js';
import {
  expectReceiverShieldedTxHistory,
  expectReceiverUnshieldedTxHistory,
  expectSenderShieldedTxHistory,
  expectSenderUnshieldedTxHistory,
} from '../tx-history-asserts.js';
import { logger } from '../logger.js';

/** Dependencies the token-transfer setup + scenarios need from the consumer. */
export interface TokenTransferScenarioDeps {
  /** Accessor for the active environment (typically the return of `useWalletTestEnvironment`). */
  getEnv: () => WalletTestEnvironment;
  /** Hex seed of the primary funded wallet. (Was the `SEED` env var.) */
  fundedSeed: string;
  /** Hex seed of the second wallet. (Was the `SEED2` env var.) */
  secondSeed: string;
  /** Optional dir to persist/restore wallet state across runs. (Was the `SYNC_CACHE` env var.) */
  syncCacheDir?: string | undefined;
  /** Timeout for the sync-heavy `beforeEach` and the healthcheck test in ms. Defaults to 1 hour. */
  syncTimeout?: number | undefined;
  /** Timeout for the `afterEach` teardown in ms. Defaults to 10 minutes. */
  timeout?: number | undefined;
}

/** Accessors returned by {@link useTokenTransferWallets}, valid inside `test`/`it` bodies. */
export interface TokenTransferWallets {
  /** The wallet holding the larger shielded balance at setup time. */
  getSender: () => WalletInit;
  /** The other wallet. */
  getReceiver: () => WalletInit;
  getNetworkId: () => NetworkId.NetworkId;
}

/**
 * Registers the shared two-wallet `beforeEach`/`afterEach` used by every token-transfer test and returns accessors.
 * Call once inside a `describe`. Both the healthcheck scenario below and the upstream-only token-transfer tests reuse
 * this so the sender/receiver selection lives in one place.
 */
export function useTokenTransferWallets({
  getEnv,
  fundedSeed,
  secondSeed,
  syncCacheDir,
  syncTimeout = 60 * 60 * 1000,
  timeout = 600_000,
}: TokenTransferScenarioDeps): TokenTransferWallets {
  const shieldedTokenRaw = ledger.shieldedToken().raw;

  let sender: WalletInit;
  let receiver: WalletInit;
  let wallet: WalletInit;
  let wallet2: WalletInit;
  let networkId: NetworkId.NetworkId;
  let filenameWallet: string;
  let filenameWallet2: string;

  beforeEach(async () => {
    const env = getEnv();
    networkId = env.endpoints.networkId;
    filenameWallet = `${fundedSeed.substring(0, 7)}-${env.network}.state`;
    filenameWallet2 = `${secondSeed.substring(0, 7)}-${env.network}.state`;

    wallet = await provideWallet(env, { seed: fundedSeed, syncCacheDir, filename: filenameWallet });
    wallet2 = await provideWallet(env, { seed: secondSeed, syncCacheDir, filename: filenameWallet2 });
    logger.info('Two wallets started');

    const [state1, state2] = await Promise.all([
      wallet.wallet.waitForSyncedState(),
      wallet2.wallet.waitForSyncedState(),
    ]);
    const balance1 = state1.shielded.balances[shieldedTokenRaw] ?? 0n;
    const balance2 = state2.shielded.balances[shieldedTokenRaw] ?? 0n;
    logger.info(`Wallet 1 shielded balance: ${balance1}, Wallet 2 shielded balance: ${balance2}`);

    if (balance1 >= balance2) {
      logger.info('Wallet 1 (SEED) has more funds — using as sender');
      sender = wallet;
      receiver = wallet2;
    } else {
      logger.info('Wallet 2 (SEED2) has more funds — using as sender');
      sender = wallet2;
      receiver = wallet;
    }
  }, syncTimeout);

  afterEach(async () => {
    if (syncCacheDir) {
      await saveState(wallet.wallet, syncCacheDir, filenameWallet);
      await saveState(wallet2.wallet, syncCacheDir, filenameWallet2);
    }
    await sender.wallet.stop();
    await receiver.wallet.stop();
    logger.info('Wallets stopped');
  }, timeout);

  const requireWallet = (w: WalletInit | undefined, label: string): WalletInit => {
    if (!w) throw new Error(`${label} accessed before beforeEach completed`);
    return w;
  };

  return {
    getSender: () => requireWallet(sender, 'sender'),
    getReceiver: () => requireWallet(receiver, 'receiver'),
    getNetworkId: () => networkId,
  };
}

/**
 * Registers the single `@healthcheck`-tagged token-transfer test under a `describe('Token transfer')` block. This is
 * the only token-transfer test shipped in the testkit; downstream monitoring selects it with `vitest run -t
 *
 * @healthcheck`.
 */
export function registerTokenTransferHealthchecks(deps: TokenTransferScenarioDeps): void {
  describe('Token transfer', () => {
    const { getSender, getReceiver, getNetworkId } = useTokenTransferWallets(deps);
    const shieldedTokenRaw = ledger.shieldedToken().raw;
    const unshieldedTokenRaw = ledger.unshieldedToken().raw;
    const outputValue = tNightAmount(10n);
    const syncTimeout = deps.syncTimeout ?? 60 * 60 * 1000;

    test(
      'Is working for valid transfer @healthcheck',
      async () => {
        const sender = getSender();
        const receiver = getReceiver();
        const networkId = getNetworkId();

        await Promise.all([sender.wallet.waitForSyncedState(), receiver.wallet.waitForSyncedState()]);
        const senderInitialState = await firstValueFrom(sender.wallet.state());
        const initialShieldedBalance = senderInitialState.shielded.balances[shieldedTokenRaw];
        const initialUnshieldedBalance = senderInitialState.unshielded.balances[unshieldedTokenRaw] ?? 0n;
        const initialDustBalance = senderInitialState.dust.balance(new Date());

        logger.info(`Wallet 1: ${initialShieldedBalance} shielded tokens`);
        logger.info(`Wallet 1: ${initialUnshieldedBalance} unshielded tokens`);
        logger.info(`Wallet 1 available dust: ${initialDustBalance}`);
        logger.info(`Wallet 1 shielded address: ${getShieldedAddress(networkId, senderInitialState.shielded.address)}`);
        logger.info(`Wallet 1 available shielded coins: ${senderInitialState.shielded.availableCoins.length}`);
        logger.info(inspect(senderInitialState.shielded.availableCoins, { depth: null }));
        logger.info(`Wallet 1 available unshielded coins: ${senderInitialState.unshielded.availableCoins.length}`);
        logger.info(inspect(senderInitialState.unshielded.availableCoins, { depth: null }));
        logger.info(
          `Wallet 1 unshielded address: ${getUnshieldedAddress(networkId, senderInitialState.unshielded.address)}`,
        );

        const initialReceiverState = await firstValueFrom(receiver.wallet.state());
        const initialReceiverShieldedBalance = initialReceiverState.shielded.balances[shieldedTokenRaw] ?? 0n;
        const initialReceiverUnshieldedBalance = initialReceiverState.unshielded.balances[unshieldedTokenRaw] ?? 0n;
        logger.info(`Wallet 2: ${initialReceiverShieldedBalance} shielded tokens`);
        logger.info(`Wallet 2: ${initialReceiverUnshieldedBalance} unshielded tokens`);
        logger.info(
          `Wallet 2 unshielded address: ${getUnshieldedAddress(networkId, initialReceiverState.unshielded.address)}`,
        );
        logger.info(
          `Wallet 2 shielded address: ${getShieldedAddress(networkId, initialReceiverState.shielded.address)}`,
        );

        const senderInitialTxHistory = await sender.wallet.getAllFromTxHistory();
        const receiverInitialTxHistory = await receiver.wallet.getAllFromTxHistory();

        const outputsToCreate: CombinedTokenTransfer[] = [
          {
            type: 'shielded',
            outputs: [
              {
                type: shieldedTokenRaw,
                amount: outputValue,
                receiverAddress: initialReceiverState.shielded.address,
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
        logger.info('Signing tx...');
        logger.info(txRecipe);
        const signedTxRecipe = await sender.wallet.signRecipe(txRecipe, (payload) =>
          sender.unshieldedKeystore.signData(payload),
        );
        logger.info('Transaction to prove...');
        logger.info(signedTxRecipe);
        const finalizedTx = await sender.wallet.finalizeRecipe(signedTxRecipe);
        logger.info('Submitting transaction...');
        logger.info(finalizedTx.toString());
        const txId = await sender.wallet.submitTransaction(finalizedTx);
        const txHash = finalizedTx.transactionHash();
        logger.info('txProcessing');
        logger.info('Transaction id: ' + txId);
        logger.info('waiting for tx in history');
        const senderTxEntry = await waitForTxInHistory(
          txHash,
          sender.wallet,
          (e) => e.shielded !== undefined && e.unshielded !== undefined,
        );
        const senderFinalState = await sender.wallet.waitForSyncedState();
        const senderFinalShieldedBalance = senderFinalState.shielded.balances[shieldedTokenRaw];
        const senderFinalUnshieldedBalance = senderFinalState.unshielded.balances[unshieldedTokenRaw];
        const senderFinalDustBalance = senderFinalState.dust.balance(new Date(3 * 1000));
        logger.info(`Wallet 1 final available dust: ${senderFinalDustBalance}`);
        logger.info(`Wallet 1 final available shielded coins: ${senderFinalShieldedBalance}`);
        logger.info(`Wallet 1 final available unshielded coins: ${senderFinalUnshieldedBalance}`);
        // assert balance after tx history is fixed
        expect(senderFinalShieldedBalance).toBe(initialShieldedBalance - outputValue);
        expect(senderFinalUnshieldedBalance).toBe(initialUnshieldedBalance - outputValue);
        expect(senderFinalShieldedBalance).toBeLessThan(initialShieldedBalance);
        expect(senderFinalUnshieldedBalance).toBeLessThan(initialUnshieldedBalance);
        expect(senderFinalState.shielded.availableCoins.length).toBeLessThanOrEqual(
          senderInitialState.shielded.availableCoins.length,
        );
        expect(senderFinalState.dust.pendingCoins.length).toBe(0);
        expect(senderFinalState.shielded.pendingCoins.length).toBe(0);
        expect(senderFinalState.shielded.totalCoins.length).toBeLessThanOrEqual(
          senderInitialState.shielded.totalCoins.length,
        );
        expect(senderFinalState.unshielded.pendingCoins.length).toBe(0);
        expect(senderFinalState.unshielded.availableCoins.length).toBeLessThanOrEqual(
          senderInitialState.unshielded.availableCoins.length,
        );
        expect(senderFinalState.unshielded.totalCoins.length).toBeLessThanOrEqual(
          senderInitialState.unshielded.totalCoins.length,
        );
        // Verify sender unshielded transaction history grew and contains the specific transaction
        const senderFinalTxHistory = await sender.wallet.getAllFromTxHistory();
        expect(senderFinalTxHistory.length).toBeGreaterThanOrEqual(senderInitialTxHistory.length + 1);
        expectSenderShieldedTxHistory(senderTxEntry);
        expectSenderUnshieldedTxHistory(senderTxEntry);

        const receiverFinalState = await receiver.wallet.waitForSyncedState();
        const receiverFinalShieldedBalance = receiverFinalState.shielded.balances[shieldedTokenRaw] ?? 0n;
        const receiverFinalUnshieldedBalance = receiverFinalState.unshielded.balances[unshieldedTokenRaw] ?? 0n;
        logger.info(`Wallet 2 final available shielded coins: ${receiverFinalShieldedBalance}`);
        logger.info(`Wallet 2 final available unshielded coins: ${receiverFinalUnshieldedBalance}`);
        expect(receiverFinalShieldedBalance).toBe(initialReceiverShieldedBalance + outputValue);
        expect(receiverFinalUnshieldedBalance).toBe(initialReceiverUnshieldedBalance + outputValue);
        expect(receiverFinalState.shielded.pendingCoins.length).toBe(0);
        expect(receiverFinalState.shielded.availableCoins.length).toBeGreaterThanOrEqual(
          initialReceiverState.shielded.availableCoins.length + 1,
        );
        expect(receiverFinalState.shielded.totalCoins.length).toBeGreaterThanOrEqual(
          initialReceiverState.shielded.totalCoins.length + 1,
        );

        // Verify receiver unshielded transaction history grew and contains the specific transaction
        const receiverFinalTxHistory = await receiver.wallet.getAllFromTxHistory();
        expect(receiverFinalTxHistory.length).toBeGreaterThanOrEqual(receiverInitialTxHistory.length + 1);
        const receiverTxEntry = await waitForTxInHistory(
          txHash,
          receiver.wallet,
          (entry) => entry.shielded !== undefined && entry.unshielded !== undefined,
        );
        expectReceiverShieldedTxHistory(receiverTxEntry, outputValue);
        expectReceiverUnshieldedTxHistory(receiverTxEntry, outputValue);
      },
      syncTimeout,
    );
  });
}
