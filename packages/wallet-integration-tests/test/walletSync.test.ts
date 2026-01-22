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
import { WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';
import { NetworkId, ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { type Variant, type WalletLike } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DefaultV1Configuration,
  type DefaultV1Variant,
  V1Builder,
  type CoreWallet,
  V1Tag,
} from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { randomUUID } from 'node:crypto';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';

import os from 'node:os';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Effect, pipe } from 'effect';
import { getShieldedSeed } from './utils.js';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 120_000 });

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

describe('Wallet Sync', () => {
  let startedEnvironment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeAll(async () => {
    startedEnvironment = await environment.up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql`,
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

  let Wallet: WalletLike.BaseWalletClass<[Variant.VersionedVariant<DefaultV1Variant>]>;
  let wallet: WalletLike.WalletLike<[Variant.VersionedVariant<DefaultV1Variant>]>;
  type Wallet = WalletLike.WalletOf<typeof Wallet>;

  const waitForSync = (wallet: Wallet): Promise<CoreWallet> => {
    return pipe(
      wallet.rawState,
      rx.map(ProtocolState.state),
      rx.skip(1),
      rx.filter((state: CoreWallet) => state.progress.isStrictlyComplete() && state.state.coins.size > 0),
      (a) => rx.firstValueFrom(a),
    );
  };

  beforeEach(async () => {
    Wallet = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new V1Builder().withDefaults())
      .build(configuration);
    const walletKeys = ledger.ZswapSecretKeys.fromSeed(
      getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000001'),
    );
    wallet = Wallet.startEmpty(Wallet);
    await wallet.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground(walletKeys) }).pipe(Effect.runPromise);
  });

  afterEach(async () => {
    if (wallet != null) {
      await wallet.stop();
    }
  });

  it('should resync an empty wallet', async () => {
    const syncedState = await waitForSync(wallet);

    const coinsAndBalancesCapability = Wallet.allVariantsRecord()[V1Tag].variant.coinsAndBalances;
    const balances = coinsAndBalancesCapability.getTotalBalances(syncedState);

    expect(balances).toStrictEqual({
      '0000000000000000000000000000000000000000000000000000000000000000': 2500000000000000n,
      '0000000000000000000000000000000000000000000000000000000000000001': 500000000000000n,
      '0000000000000000000000000000000000000000000000000000000000000002': 500000000000000n,
    });
  });
});
