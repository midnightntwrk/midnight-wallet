// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { describe, test, expect } from 'vitest';
import * as rx from 'rxjs';
import { useTestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import * as utils from './utils.js';
import { logger } from './logger.js';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { exit } from 'node:process';
import { inspect } from 'node:util';

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
  const timeout = 600_000;
  let walletFacade: WalletFacade;
  let walletKeystore: UnshieldedKeystore;

  beforeEach(async () => {
    const fixture = getFixture();
    const networkId = fixture.getNetworkId();
    walletFacade = utils.buildWalletFacade(seed, fixture);

    walletKeystore = createKeystore(utils.getUnshieldedSeed(seed), networkId);
    await walletFacade.start(walletSecretKey, walletDustSecretKey);
  });

  afterEach(async () => {
    await walletFacade.stop();
    logger.info('Wallet stopped');
  });

  test(
    'Able to register Night tokens for Dust generation @healthcheck',
    async () => {
      const initialState = await utils.waitForSyncFacade(walletFacade);
      const initialUnshieldedBalance = initialState.unshielded.balances[unshieldedTokenRaw];
      const initialDustBalance = initialState.dust.walletBalance(new Date());
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
      expect(unregisteredUtxosNumber, 'No unregistered UTXOs found').toBeGreaterThan(0);
      logger.info(`utxo length: ${unregisteredUtxosNumber}`);

      const firstNightUtxo = unregisteredNightUtxos[0];
      logger.info(`Registering UTXO: ${inspect(unregisteredNightUtxos, { depth: null })}`);

      const dustRegistrationRecipe = await walletFacade.registerNightUtxosForDustGeneration(
        [firstNightUtxo],
        walletKeystore.getPublicKey(),
        (payload) => walletKeystore.signData(payload),
      );

      const finalizedDustTx = await walletFacade.finalizeTransaction(dustRegistrationRecipe);
      const dustRegistrationTxid = await walletFacade.submitTransaction(finalizedDustTx);
      expect(dustRegistrationTxid).toBeDefined();
      logger.info(`Dust registration tx id: ${dustRegistrationTxid}`);
      const finalWalletState = await rx.firstValueFrom(
        walletFacade.state().pipe(
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
              ).length > registeredNightUtxos.length && s.isSynced === true,
          ),
        ),
      );
      const finalNightUtxos = finalWalletState.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === true,
      );
      expect(finalNightUtxos.length).toBe(registeredNightUtxos.length + 1);
    },
    timeout,
  );

  test(
    'Able to deregister night tokens for dust decay @healthcheck',
    async () => {
      const initialWalletState = await utils.waitForSyncFacade(walletFacade);
      const initialDustBalance = initialWalletState.dust.walletBalance(new Date());
      logger.info(`Initial Dust Balance: ${initialDustBalance}`);

      const registeredNightUtxos = initialWalletState.unshielded.availableCoins.filter(
        (coin) => coin.utxo.type === unshieldedTokenRaw && coin.meta.registeredForDustGeneration === true,
      );
      logger.info(`Registered night UTXOs: ${inspect(registeredNightUtxos, { depth: null })}`);
      expect(registeredNightUtxos.length).toBeGreaterThan(0);

      const deregisterTokens = 2;
      const dustDeregistrationRecipe = await walletFacade.deregisterFromDustGeneration(
        registeredNightUtxos.slice(0, deregisterTokens),
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
