import { ShieldedWallet, ShieldedWalletClass, ShieldedWalletState } from '@midnight-ntwrk/wallet-ts';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-ts/v1';
import * as zswap from '@midnight-ntwrk/zswap';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as path from 'node:path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 30_000 });

describe('Wallet serialization and restoration', () => {
  const environmentId = randomUUID();
  const seed = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex');
  let environment: StartedDockerComposeEnvironment | null = null;
  let configuration: DefaultV1Configuration | null = null;

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
        indexerHttpUrl: `http://localhost:${environment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v1/graphql`,
      },
      provingServerUrl: new URL(
        `http://localhost:${environment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      relayURL: new URL(`ws://127.0.0.1:${environment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`),
      networkId: zswap.NetworkId.Undeployed,
      costParameters: {
        ledgerParams: zswap.LedgerParameters.dummyParameters(),
        additionalFeeOverhead: 50_000n,
      },
    };
  });

  afterAll(async () => {
    await environment?.down({ timeout: 10_000 });
  });

  let Wallet: ShieldedWalletClass;
  let wallet: ShieldedWallet;
  beforeEach(() => {
    Wallet = ShieldedWallet(configuration!);
    wallet = Wallet.startWithShieldedSeed(seed);
  });

  afterEach(async () => {
    if (wallet != null) {
      await wallet.stop();
    }
  });

  it('allows to restart wallet from the serialized state', async () => {
    const syncedState: ShieldedWalletState = await wallet.waitForSyncedState();
    const originalBalances = syncedState.balances;

    const serializedState = await wallet.serializeState();
    const restored = Wallet.restore(seed, serializedState);
    try {
      const state = await restored.waitForSyncedState();
      const restoredBalances = state.balances;

      expect(originalBalances).not.toEqual({});
      expect(restoredBalances).toEqual(originalBalances);
    } finally {
      await restored.stop();
    }
  });
});
