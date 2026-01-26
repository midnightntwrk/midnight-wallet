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
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed, getDustSeed, waitForFullySynced } from './utils/index.js';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import {
  createKeystore,
  PublicKey,
  InMemoryTransactionHistoryStorage,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

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

  const unshieldedWalletKeystore = createKeystore(unshieldedWalletSeed, NetworkId.NetworkId.Undeployed);

  let startedEnvironment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeAll(async () => {
    startedEnvironment = await environment.up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql`,
        indexerWsUrl: `ws://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql/ws`,
      },
      provingServerUrl: new URL(
        `http://localhost:${startedEnvironment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      relayURL: new URL(
        `ws://127.0.0.1:${startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`,
      ),
      networkId: NetworkId.NetworkId.Undeployed,
    };
  });

  afterAll(async () => {
    await startedEnvironment?.down({ timeout: 10_000 });
  });

  let walletFacade: WalletFacade;

  beforeEach(async () => {
    const Shielded = ShieldedWallet(configuration);
    const shieldedWallet = Shielded.startWithShieldedSeed(shieldedWalletSeed);

    const Dust = DustWallet({
      ...configuration,
      costParameters: {
        additionalFeeOverhead: 300_000_000_000_000n,
        feeBlocksMargin: 5,
      },
    });
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;
    const dustWallet = Dust.startWithSeed(dustWalletSeed, dustParameters);

    const unshieldedWallet = UnshieldedWallet({
      ...configuration,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedWalletKeystore));

    walletFacade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);

    await walletFacade.start(
      ledger.ZswapSecretKeys.fromSeed(shieldedWalletSeed),
      ledger.DustSecretKey.fromSeed(dustWalletSeed),
    );
  });

  afterEach(async () => {
    await walletFacade.stop();
  });

  it('deregisters from dust generation', async () => {
    // NOTE: by default, our test account is already registered for Dust generation
    await waitForFullySynced(walletFacade);

    const walletStateWithNight = await rx.firstValueFrom(
      walletFacade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0)),
    );

    const availableCoins = walletStateWithNight.dust.availableCoinsWithFullInfo(new Date());
    expect(availableCoins.every((availableCoins) => availableCoins.dtime === undefined)).toBeTruthy();

    const nightUtxosRegisteredForDustGeneration = walletStateWithNight.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration,
    );

    const deregisterTokens = 2;
    const dustDeregistrationTx = await walletFacade.deregisterFromDustGeneration(
      nightUtxosRegisteredForDustGeneration.slice(0, deregisterTokens),
      unshieldedWalletKeystore.getPublicKey(),
      (payload) => unshieldedWalletKeystore.signData(payload),
    );

    const balancingRecipe = await walletFacade.balanceUnprovenTransaction(
      dustDeregistrationTx.transaction,
      {
        shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedWalletSeed),
        dustSecretKey: ledger.DustSecretKey.fromSeed(dustWalletSeed),
      },
      {
        ttl: new Date(Date.now() + 30 * 60 * 1000),
      },
    );

    const finalizedDustDeregistrationTx = await walletFacade.finalizeRecipe(balancingRecipe);

    const dustDeregistrationTxHash = await walletFacade.submitTransaction(finalizedDustDeregistrationTx);

    expect(dustDeregistrationTxHash).toBeTypeOf('string');

    const walletStateAfterDeregistration = await rx.firstValueFrom(
      walletFacade.state().pipe(
        rx.mergeMap(async (state) => {
          const txInHistory = await state.unshielded.transactionHistory.get(
            finalizedDustDeregistrationTx.transactionHash(),
          );

          return {
            state,
            txFound: txInHistory !== undefined,
          };
        }),
        rx.filter(({ state, txFound }) => txFound && state.isSynced),
        rx.map(({ state }) => state),
      ),
    );

    const availableCoinsWithInfo = walletStateAfterDeregistration.dust.availableCoinsWithFullInfo(new Date());
    const nightUtxosNotRegisteredForDustGeneration = walletStateAfterDeregistration.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration === false,
    );

    expect(availableCoinsWithInfo.filter((coin) => coin.dtime !== undefined).length).toBe(deregisterTokens);
    expect(nightUtxosNotRegisteredForDustGeneration).toHaveLength(2);
  });
});
