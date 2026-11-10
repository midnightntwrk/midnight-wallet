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
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import * as ledger from '@midnightntwrk/ledger-v9';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed, getDustSeed } from './utils.js';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnightntwrk/wallet-sdk-utilities/testing';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import {
  type DefaultConfiguration,
  type FacadeState,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk-facade';
import { NetworkId, InMemoryTransactionHistoryStorage, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { makeDefaultSubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { carried } from './helpers/transactions.js';
import { outputIntentHashesOf, waitForTxInHistory } from './helpers/stateWaiters.js';
import { logger } from './logger.js';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 120_000 });

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: {
    TESTCONTAINERS_UID: environmentId,
    RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
  },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose-dynamic.yml')
  .withWaitStrategy(
    `proof-server_${environmentId}`,
    Wait.forLogMessage('Actix runtime found; starting in Actix runtime'),
  )
  .withWaitStrategy(`node_${environmentId}`, Wait.forListeningPorts())
  .withWaitStrategy(`indexer_${environmentId}`, Wait.forLogMessage(/block indexed".*height":1,.*/gm))
  .withEnvironment(environmentVars)
  .withStartupTimeout(100_000);

describe('Dust Deregistration', () => {
  const SEED = '0000000000000000000000000000000000000000000000000000000000000003';

  const shieldedWalletSeed = getShieldedSeed(SEED);
  const unshieldedWalletSeed = getUnshieldedSeed(SEED);
  const dustWalletSeed = getDustSeed(SEED);

  const unshieldedWalletKeystore = createKeystore(
    { kind: 'schnorr', secret: unshieldedWalletSeed },
    NetworkId.NetworkId.Undeployed,
  );

  let startedEnvironment: StartedDockerComposeEnvironment;
  let configuration: DefaultConfiguration;

  beforeAll(async () => {
    startedEnvironment = await environment.up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v4/graphql`,
        indexerWsUrl: `ws://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v4/graphql/ws`,
      },
      provingServerUrl: new URL(
        `http://localhost:${startedEnvironment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      relayURL: new URL(
        `ws://127.0.0.1:${startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`,
      ),
      networkId: NetworkId.NetworkId.Undeployed,
      forks: ProtocolVersion.V9NativeForkSchedule,
      costParameters: {
        feeBlocksMargin: 5,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
  });

  afterAll(async () => {
    await startedEnvironment?.down({ timeout: 10_000 });
  });

  let walletFacade: WalletFacade;

  beforeEach(async () => {
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;

    walletFacade = await WalletFacade.init({
      configuration,
      shielded: (configuration) => ShieldedWallet(configuration).startWithSeed(shieldedWalletSeed),
      unshielded: (configuration) =>
        UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(unshieldedWalletKeystore)),
      dust: (configuration) => DustWallet(configuration).startWithSeed(dustWalletSeed, dustParameters),
      submissionService: (configuration) => makeDefaultSubmissionService(configuration),
    });

    await walletFacade.start({ shielded: shieldedWalletSeed, unshielded: shieldedWalletSeed, dust: dustWalletSeed });
  });

  afterEach(async () => {
    await walletFacade.stop();
  });

  it('deregisters from dust generation', async () => {
    // NOTE: by default, our test account is already registered for Dust generation
    await walletFacade.waitForSyncedState();

    const walletStateWithNight = await rx.firstValueFrom(
      walletFacade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0)),
    );

    const decayingDustCoins = (state: FacadeState) =>
      state.dust.availableCoins.filter((coin) => coin.dtime !== undefined);
    const deregisteredNightUtxos = (state: FacadeState) =>
      state.unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration === false && coin.utxo.type === ledger.nativeToken().raw,
      );

    const availableCoins = walletStateWithNight.dust.availableCoins;
    expect(availableCoins.every((availableCoins) => availableCoins.dtime === undefined)).toBeTruthy();
    expect(deregisteredNightUtxos(walletStateWithNight)).toHaveLength(0);

    const nightUtxosRegisteredForDustGeneration = walletStateWithNight.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration,
    );

    const deregisteredUtxoCount = 2;
    expect(nightUtxosRegisteredForDustGeneration.length).toBeGreaterThanOrEqual(deregisteredUtxoCount);

    const deregistrationInputs = nightUtxosRegisteredForDustGeneration.slice(0, deregisteredUtxoCount);
    const dustDeregistrationTx = await walletFacade.deregisterFromDustGeneration(
      deregistrationInputs,
      unshieldedWalletKeystore.getPublicKey(),
      unshieldedWalletKeystore.signDataAsync,
    );

    const balancingRecipe = await walletFacade.balanceUnprovenTransaction(dustDeregistrationTx.transaction, {
      ttl: new Date(Date.now() + 30 * 60 * 1000),
    });

    const finalizedDustDeregistrationTx = await walletFacade.finalizeRecipe(balancingRecipe);

    const dustDeregistrationTxHash = await walletFacade.submitTransaction(finalizedDustDeregistrationTx);

    expect(dustDeregistrationTxHash).toBeTypeOf('string');

    const deregistrationTxHash = carried<ledger.FinalizedTransaction>(finalizedDustDeregistrationTx).transactionHash();

    // The transaction must first finalize successfully in history; then the state must show both effects, decaying
    // Dust and deregistered Night, since each wallet applies the transaction on its own schedule.
    await waitForTxInHistory(deregistrationTxHash, walletFacade, { timeoutMs: 60_000 });

    // The wait accepts at least the expected counts while the assertions below are exact, so a surplus ends the wait
    // and fails an exact assertion instead of running into the timeout.
    const walletStateAfterDeregistration = await rx.firstValueFrom(
      walletFacade.state().pipe(
        rx.tap((state) =>
          logger.info(
            `Decaying Dust coins: ${decayingDustCoins(state).length}, deregistered Night UTxOs: ${deregisteredNightUtxos(state).length}; waiting for at least ${deregisteredUtxoCount} of each...`,
          ),
        ),
        rx.filter(
          (state) =>
            decayingDustCoins(state).length >= deregisteredUtxoCount &&
            deregisteredNightUtxos(state).length >= deregisteredUtxoCount,
        ),
        rx.timeout({
          first: 60_000,
          with: () =>
            rx.throwError(
              () =>
                new Error(
                  `Timed out after 60 s waiting for at least ${deregisteredUtxoCount} decaying Dust coins and at least ${deregisteredUtxoCount} deregistered Night UTxOs; the last counts are in the log`,
                ),
            ),
        }),
      ),
    );

    expect(decayingDustCoins(walletStateAfterDeregistration)).toHaveLength(deregisteredUtxoCount);
    expect(deregisteredNightUtxos(walletStateAfterDeregistration)).toHaveLength(deregisteredUtxoCount);

    // The deregistered Night UTxOs are the outputs of this transaction and carry exactly the value of its inputs.
    const deregistrationIntentHashes = outputIntentHashesOf(finalizedDustDeregistrationTx);
    const deregisteredUtxos = deregisteredNightUtxos(walletStateAfterDeregistration);
    expect(deregisteredUtxos.every((coin) => deregistrationIntentHashes.includes(coin.utxo.intentHash))).toBe(true);
    expect(deregisteredUtxos.reduce((sum, coin) => sum + coin.utxo.value, 0n)).toBe(
      deregistrationInputs.reduce((sum, coin) => sum + coin.utxo.value, 0n),
    );
  });

  it('books Night UTxOs at build time so a concurrent overlapping deregistration fails fast', async () => {
    await walletFacade.waitForSyncedState();

    const stateWithRegisteredNight = await rx.firstValueFrom(
      walletFacade
        .state()
        .pipe(
          rx.filter(
            (s) =>
              s.isSynced &&
              s.unshielded.availableCoins.some(
                (c) => c.meta.registeredForDustGeneration === true && c.utxo.type === ledger.nativeToken().raw,
              ),
          ),
        ),
    );

    const nightUtxos = stateWithRegisteredNight.unshielded.availableCoins
      .filter((c) => c.meta.registeredForDustGeneration === true && c.utxo.type === ledger.nativeToken().raw)
      .slice(0, 2);

    expect(nightUtxos.length).toBeGreaterThan(0);

    // First call: build a deregistration recipe without submitting it.
    await walletFacade.deregisterFromDustGeneration(
      nightUtxos,
      unshieldedWalletKeystore.getPublicKey(),
      unshieldedWalletKeystore.signDataAsync,
    );

    // Booking contract: the just-deregistered UTxOs must no longer appear as available
    // before any on-chain submission has happened.
    const stateAfterDeregistration = await rx.firstValueFrom(walletFacade.state());
    const deregisteredHashes = new Set(nightUtxos.map((c) => `${c.utxo.intentHash}#${c.utxo.outputNo}`));
    const stillAvailable = stateAfterDeregistration.unshielded.availableCoins.filter((c) =>
      deregisteredHashes.has(`${c.utxo.intentHash}#${c.utxo.outputNo}`),
    );
    expect(stillAvailable).toHaveLength(0);

    // Fail-fast contract: a second deregistration over the same UTxOs must reject at build time.
    await expect(
      walletFacade.deregisterFromDustGeneration(
        nightUtxos,
        unshieldedWalletKeystore.getPublicKey(),
        unshieldedWalletKeystore.signDataAsync,
      ),
    ).rejects.toThrow();
  });
});
