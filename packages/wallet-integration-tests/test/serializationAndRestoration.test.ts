import { ShieldedWallet, ShieldedWalletClass, ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as path from 'node:path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed } from './utils.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe('Wallet serialization and restoration', () => {
  const environmentId = randomUUID();

  let environment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeAll(async () => {
    environment = await new DockerComposeEnvironment(
      path.resolve(new URL(import.meta.url).pathname, '../../../../packages/e2e-tests'),
      'docker-compose-dynamic.yml',
    )
      .withEnvironment({
        TESTCONTAINERS_UID: environmentId,
        RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
      })
      .up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${environment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql`,
      },
      provingServerUrl: new URL(
        `http://localhost:${environment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      relayURL: new URL(`ws://127.0.0.1:${environment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`),
      networkId: NetworkId.NetworkId.Undeployed,
    };
  });

  afterAll(async () => {
    await environment?.down({ timeout: 10_000 });
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
