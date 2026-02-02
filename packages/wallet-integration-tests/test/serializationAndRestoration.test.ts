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
import {
  ShieldedWallet,
  type ShieldedWalletClass,
  type ShieldedWalletState,
} from '@midnight-ntwrk/wallet-sdk-shielded';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { type DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed } from './utils.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: {
    TESTCONTAINERS_UID: environmentId,
    RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
  },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose-dynamic.yml').withEnvironment(
  environmentVars,
);

describe('Wallet serialization and restoration', () => {
  let startedEnvironment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeAll(async () => {
    startedEnvironment = await environment.up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql`,
      },
      // TODO: check
      // provingServerUrl: new URL(
      //   `http://localhost:${startedEnvironment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      // ),
      networkId: NetworkId.NetworkId.Undeployed,
    };
  });

  afterAll(async () => {
    await startedEnvironment?.down({ timeout: 10_000 });
  });

  let Wallet: ShieldedWalletClass;
  beforeEach(() => {
    Wallet = ShieldedWallet(configuration);
  });

  it('allows to restore an non-empty wallet from the serialized state', async () => {
    const seed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
    const wallet = Wallet.startWithShieldedSeed(seed);
    await wallet.start(ledger.ZswapSecretKeys.fromSeed(seed));
    try {
      const syncedState: ShieldedWalletState = await wallet.waitForSyncedState();
      const originalBalances = syncedState.balances;

      const serializedState = await wallet.serializeState();
      const restored = Wallet.restore(serializedState);
      await restored.start(ledger.ZswapSecretKeys.fromSeed(seed));
      try {
        const state = await restored.waitForSyncedState();
        const restoredBalances = state.balances;

        expect(originalBalances).not.toEqual({});
        expect(restoredBalances).toEqual(originalBalances);
      } finally {
        await restored.stop();
      }
    } finally {
      await wallet.stop();
    }
  });

  it('allows to restore an empty wallet from the serialized state', async () => {
    const seed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000009');
    const wallet = Wallet.startWithShieldedSeed(seed);
    await wallet.start(ledger.ZswapSecretKeys.fromSeed(seed));
    try {
      const syncedState: ShieldedWalletState = await wallet.waitForSyncedState();
      const originalBalances = syncedState.balances;

      const serializedState = await wallet.serializeState();
      const restored = Wallet.restore(serializedState);
      await restored.start(ledger.ZswapSecretKeys.fromSeed(seed));
      try {
        const state = await restored.waitForSyncedState();
        const restoredBalances = state.balances;

        expect(originalBalances).toEqual({});
        expect(restoredBalances).toEqual(originalBalances);
      } finally {
        await restored.stop();
      }
    } finally {
      await wallet.stop();
    }
  });
});
