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
// Dust healthcheck scenarios. The test bodies are single-sourced here and registered by both the
// upstream e2e-tests suite and downstream consumers (e.g. sentinel monitoring), each supplying its
// own environment via `getEnv`. The `@healthcheck`-tagged test names are preserved so consumers can
// select them with `vitest run -t @healthcheck`.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';
import * as rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { type WalletTestEnvironment } from '../types.js';
import { provideWallet, saveState, type WalletInit } from '../wallet.js';
import { logger } from '../logger.js';

/** Dependencies the dust scenarios need from the consumer. */
export interface DustScenarioDeps {
  /** Accessor for the active environment (typically the return of `useWalletTestEnvironment`). */
  getEnv: () => WalletTestEnvironment;
  /** Hex seed of a funded wallet holding registerable Night UTXOs. (Was the `SEED` env var.) */
  seed: string;
  /** Optional dir to persist/restore wallet state across runs. (Was the `SYNC_CACHE` env var.) */
  syncCacheDir?: string | undefined;
  /** Per-test timeout in ms. Defaults to the upstream value of 1 hour. */
  timeout?: number | undefined;
}

/** Registers the dust register/deregister healthchecks under a `describe('Dust tests')` block. */
export function registerDustHealthchecks({ getEnv, seed, syncCacheDir, timeout = 3_600_000 }: DustScenarioDeps): void {
  describe('Dust tests', () => {
    const unshieldedTokenRaw = ledger.unshieldedToken().raw;
    let wallet: WalletInit;
    let filenameWallet: string;

    beforeEach(async () => {
      const env = getEnv();
      filenameWallet = `${seed.substring(0, 7)}-${env.network}.state`;
      wallet = await provideWallet(env, { seed, syncCacheDir, filename: filenameWallet });
    });

    afterEach(async () => {
      if (syncCacheDir) {
        await saveState(wallet.wallet, syncCacheDir, filenameWallet);
      }
      await wallet.wallet.stop();
      logger.info('Wallet stopped');
    });

    test(
      'Able to register Night tokens for Dust generation @healthcheck',
      async () => {
        const initialState = await wallet.wallet.waitForSyncedState();
        const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
        const initialDustBalance = initialState.dust.balance(new Date());
        logger.info(`Wallet: ${initialUnshieldedBalance} unshielded tokens`);
        logger.info(`wallet dust balance: ${initialDustBalance}`);
        logger.info(`Wallet total unshielded coins: ${initialState.unshielded.availableCoins.length}`);
        logger.info(inspect(initialState.unshielded.availableCoins, { depth: null }));

        const unregisteredNightUtxos = initialState.unshielded.availableCoins.filter(
          (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === false,
        );

        const registeredNightUtxos = initialState.unshielded.availableCoins.filter(
          (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === true,
        );

        const unregisteredUtxosNumber = unregisteredNightUtxos.length;
        expect(unregisteredUtxosNumber, 'Not enough unregistered UTXOs found').toBeGreaterThan(1);
        logger.info(`utxo length: ${unregisteredUtxosNumber}`);

        const firstTwoNightUtxos = unregisteredNightUtxos.slice(0, 2);
        logger.info(`Registering UTXOs: ${inspect(firstTwoNightUtxos, { depth: null })}`);

        const dustRegistrationRecipe = await wallet.wallet.registerNightUtxosForDustGeneration(
          firstTwoNightUtxos,
          wallet.unshieldedKeystore.getPublicKey(),
          (payload) => wallet.unshieldedKeystore.signData(payload),
        );

        const finalizedDustTx = await wallet.wallet.finalizeRecipe(dustRegistrationRecipe);
        const dustRegistrationTxid = await wallet.wallet.submitTransaction(finalizedDustTx);
        expect(dustRegistrationTxid).toBeDefined();
        logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);
        const finalWalletState = await rx.firstValueFrom(
          wallet.wallet.state().pipe(
            rx.tap((s) => {
              const registeredTokens = s.unshielded.availableCoins.filter(
                (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === true,
              );
              logger.info(`registered tokens: ${registeredTokens.length}`);
            }),
            rx.filter(
              (s) =>
                s.unshielded.availableCoins.filter(
                  (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === true,
                ).length >=
                  registeredNightUtxos.length + 2 && s.isSynced === true,
            ),
          ),
        );
        const finalNightUtxos = finalWalletState.unshielded.availableCoins.filter(
          (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === true,
        );
        expect(finalNightUtxos.length).toBe(registeredNightUtxos.length + 2);
      },
      timeout,
    );

    test(
      'Able to deregister night tokens for dust decay @healthcheck',
      async () => {
        const initialWalletState = await wallet.wallet.waitForSyncedState();
        const initialDustBalance = initialWalletState.dust.balance(new Date());
        logger.info(`Initial Dust Balance: ${initialDustBalance}`);

        const registeredNightUtxos = initialWalletState.unshielded.availableCoins.filter(
          (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === true,
        );
        logger.info(`Registered night UTXOs: ${inspect(registeredNightUtxos, { depth: null })}`);
        expect(registeredNightUtxos.length, 'Not enough registered UTXOs found').toBeGreaterThan(1);

        const firstTwoRegisteredNightUtxos = registeredNightUtxos.slice(0, 2);
        const dustDeregistrationRecipe = await wallet.wallet.deregisterFromDustGeneration(
          firstTwoRegisteredNightUtxos,
          wallet.unshieldedKeystore.getPublicKey(),
          (payload) => wallet.unshieldedKeystore.signData(payload),
        );

        const balancedTransactionRecipe = await wallet.wallet.balanceUnprovenTransaction(
          dustDeregistrationRecipe.transaction,
          {
            shieldedSecretKeys: wallet.shieldedSecretKeys,
            dustSecretKey: wallet.dustSecretKey,
          },
          {
            ttl: new Date(Date.now() + 30 * 60 * 1000),
          },
        );

        const finalizedDustTx = await wallet.wallet.finalizeRecipe(balancedTransactionRecipe);
        const dustDeregistrationTxid = await wallet.wallet.submitTransaction(finalizedDustTx);
        expect(dustDeregistrationTxid).toBeDefined();
        logger.info(`Dust de-registration tx id: ${dustDeregistrationTxid}`);
      },
      timeout,
    );
  });
}
