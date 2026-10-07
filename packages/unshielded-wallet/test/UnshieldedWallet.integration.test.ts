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
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnightntwrk/wallet-sdk-utilities/testing';
import * as rx from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DockerComposeEnvironment, GenericContainer, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnshieldedWallet } from '../src/index.js';
import { getUnshieldedSeed, createWalletConfig, waitForCoins } from './testUtils.js';
import { createKeystore, PublicKey } from '../src/KeyStore.js';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { IndexerLiveness, NoOpTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';

vi.setConfig({ testTimeout: 100_000, hookTimeout: 100_000 });

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: {
    TESTCONTAINERS_UID: environmentId,
  },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose.yml')
  .withWaitStrategy(`node_${environmentId}`, Wait.forListeningPorts())
  .withWaitStrategy(`indexer_${environmentId}`, Wait.forListeningPorts())
  .withEnvironment(environmentVars);

describe('UnshieldedWallet', () => {
  let indexerPort: number;
  let nodePort: number;
  let startedEnvironment: StartedDockerComposeEnvironment;
  const unshieldedSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');

  beforeAll(async () => {
    startedEnvironment = await environment.up();
    indexerPort = startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088);
    nodePort = startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944);
  });

  it('should cross-check the indexer against the node using only the submission relay URL', async () => {
    // The check reads its endpoint from `relayURL` — the node a wallet already names for submission — so no second
    // endpoint is configured here. That is the wiring that shipped switched off: it needed a `nodeClientConnection`
    // nobody set. This runs it against a real indexer and a real node and waits for an actual verdict, which is the only
    // way to show the poll loop runs and its result reaches the wallet's progress.
    const config = createWalletConfig(indexerPort, {
      relayURL: new URL(`ws://localhost:${nodePort}`),
      // The default 30-second cadence leaves roughly three polls inside this file's 100s timeout, and the first one
      // usually lands before the indexer has ingested anything. Two seconds makes the verdict a certainty rather than
      // a race against the clock.
      livenessPollInterval: '2 seconds',
    });
    const keystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, config.networkId);
    const wallet = await UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await wallet.start();

    try {
      const state = await firstValueFrom(
        wallet.state.pipe(rx.filter((state) => IndexerLiveness.isInSync(state.progress.indexerLiveness))),
      );

      const verdict = state.progress.indexerLiveness;
      expect(IndexerLiveness.isInSync(verdict)).toBe(true);
      // `Skipped` would mean the endpoint never resolved; `Unknown` that no poll completed.
      expect(verdict._tag).toBe('InSync');
    } finally {
      await wallet.stop();
    }
  });

  it('should refuse to report synced when the node it cross-checks against is on a different chain', async () => {
    // A real node on a different chain: the stack's own node image, started from the `dev` chain spec with one inert
    // storage key added to its genesis. Everything else about the chain is the same, so it produces and finalizes
    // blocks like the stack's node, but its genesis hash differs — which is exactly what the check compares before
    // trusting any height. The indexer, meanwhile, is the stack's own and fully caught up, so without the check this
    // wallet would report itself synced.
    const nodeImage = /image: '(ghcr\.io\/midnight-ntwrk\/midnight-node:[^']+)'/.exec(
      readFileSync(join(getComposeDirectory(), 'docker-compose.yml'), 'utf8'),
    )?.[1];
    if (nodeImage === undefined) {
      throw new Error('No midnight-node image found in the compose file');
    }
    const otherChainNode = await new GenericContainer(nodeImage)
      .withEnvironment({
        CFG_PRESET: 'dev',
        SIDECHAIN_BLOCK_BENEFICIARY: '04bcf7ad3be7a5c790460be82a713af570f22e0f801f6659ab8e84a52be6969e',
      })
      .withEntrypoint(['sh', '-c'])
      .withCommand([
        '/midnight-node build-spec --raw --disable-default-bootnode 2>/dev/null' +
          ` | sed 's/"top": *{/"top":{"0x${'00'.repeat(32)}":"0x01",/' > /tmp/other-chain.json` +
          ' && CHAIN=/tmp/other-chain.json exec /entrypoint.sh',
      ])
      .withExposedPorts(9944)
      .withWaitStrategy(Wait.forLogMessage(/Imported #1/))
      .start();

    const config = createWalletConfig(indexerPort, {
      nodeClientConnection: { nodeURL: `ws://localhost:${otherChainNode.getMappedPort(9944)}` },
      livenessPollInterval: '2 seconds',
    });
    const keystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, config.networkId);
    const wallet = await UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await wallet.start();

    try {
      // Waiting for the coins as well as the verdict: the gate is only shown to hold if everything else about the
      // wallet says it is synced.
      const state = await firstValueFrom(
        wallet.state.pipe(
          rx.filter(
            (state) =>
              IndexerLiveness.isWrongNetwork(state.progress.indexerLiveness) &&
              state.availableCoins.length > 0 &&
              state.progress.isConnected &&
              state.progress.appliedId === state.progress.highestTransactionId,
          ),
        ),
      );

      expect(state.progress.indexerLiveness._tag).toBe('WrongNetwork');
      expect(state.progress.isStrictlyComplete()).toBe(false);

      // `WrongNetwork` is pinned for the wallet's lifetime, so this never resolves; ten seconds is five polls.
      const synced = await Promise.race([
        wallet.waitForSyncedState().then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
      ]);
      expect(synced).toBe(false);
    } finally {
      await wallet.stop();
      await otherChainNode.stop();
    }
  });

  it('should build', async () => {
    const config = createWalletConfig(indexerPort);
    const keystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, config.networkId);

    const unshieldedWallet = await UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await unshieldedWallet.start();

    // Just waiting for synced state is not enough because there is a possibility of reporting a synced state with no coins at the very beginning
    await waitForCoins(unshieldedWallet);

    const state = await unshieldedWallet.waitForSyncedState();

    expect(UnshieldedAddress.codec.encode(config.networkId, state.address).asString()).toBe(
      'mn_addr_undeployed1gkasr3z3vwyscy2jpp53nzr37v7n4r3lsfgj6v5g584dakjzt0xqun4d4r',
    );
    expect(state.availableCoins.length).toBeGreaterThan(0);
    expect(state.pendingCoins).toHaveLength(0);

    const transactionHistory = await config.txHistoryStorage.getAll();

    expect(transactionHistory.length).toBeGreaterThan(1);
  });

  it('should instantiate without transaction history service', async () => {
    const initialConfig = createWalletConfig(indexerPort, {
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
    });
    const keystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, initialConfig.networkId);
    const initialWallet = await UnshieldedWallet(initialConfig).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await initialWallet.start();
    await waitForCoins(initialWallet);

    const initialState = await initialWallet.waitForSyncedState();

    expect(initialState.availableCoins.length).toBeGreaterThan(0);
    expect(initialState.pendingCoins.length).toBe(0);

    await initialWallet.stop();
  });

  it('should restore from serialized state', async () => {
    const initialConfig = createWalletConfig(indexerPort);
    const keystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, initialConfig.networkId);
    const initialWallet = await UnshieldedWallet(initialConfig).startWithPublicKey(PublicKey.fromKeyStore(keystore));

    await initialWallet.start();

    await initialWallet.waitForSyncedState();

    const initialState = await firstValueFrom(initialWallet.state);

    expect(initialState.availableCoins.length).toBe(initialState.availableCoins.length);
    expect(initialState.pendingCoins.length).toBe(initialState.pendingCoins.length);

    const serializedState = await initialWallet.serializeState();

    await initialWallet.stop();

    const restoreConfig = createWalletConfig(indexerPort);
    const restoredWallet = UnshieldedWallet(restoreConfig).restore(serializedState);
    await restoredWallet.start();

    await restoredWallet.waitForSyncedState();

    const restoredState = await firstValueFrom(restoredWallet.state);

    expect(UnshieldedAddress.codec.encode(restoreConfig.networkId, restoredState.address).asString()).toBe(
      UnshieldedAddress.codec.encode(restoreConfig.networkId, initialState.address).asString(),
    );
    expect(restoredState.availableCoins.length).toBe(initialState.availableCoins.length);
    expect(restoredState.pendingCoins.length).toBe(initialState.pendingCoins.length);

    await restoredWallet.stop();
  });

  describe('bookings carried across a restart', () => {
    // These start from a hand-written snapshot rather than a funded wallet: the coins only have to be tracked, and
    // the indexer never mentions them, so what is being watched is how the wallet treats its own restored state
    // while real sync updates arrive.
    const coin = (intentHash: string, ttl?: string) => ({
      utxo: { value: '1000', owner: 'owner-1', type: 'token-1', intentHash, outputNo: 0 },
      meta: { ctime: '2026-01-01T00:00:00.000Z', registeredForDustGeneration: false },
      ...(ttl === undefined ? {} : { ttl }),
    });

    const coinId = (intentHash: string) => `${intentHash}#0`;

    /** A snapshot this wallet would accept, with its coin arrays replaced. */
    const snapshotHolding = async (
      available: ReturnType<typeof coin>[],
      pending: ReturnType<typeof coin>[],
    ): Promise<string> => {
      const config = createWalletConfig(indexerPort);
      const keystore = createKeystore({ kind: 'schnorr', secret: unshieldedSeed }, config.networkId);
      const wallet = await UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore));
      await wallet.start();
      const empty = JSON.parse(await wallet.serializeState()) as { state: unknown };
      await wallet.stop();

      return JSON.stringify({ ...empty, state: { availableUtxos: available, pendingUtxos: pending } });
    };

    it('loads a snapshot holding one coin as both available and pending with the coin only pending, and keeps the two apart while syncing', async () => {
      const duplicated = 'h-integration-duplicate';
      const snapshot = await snapshotHolding([coin(duplicated)], [coin(duplicated, '2999-01-01T00:00:00.000Z')]);

      const wallet = UnshieldedWallet(createWalletConfig(indexerPort)).restore(snapshot);
      await wallet.start();

      const seen: { available: string[]; pending: string[] }[] = [];
      const subscription = wallet.state.subscribe((state) => {
        seen.push({
          available: state.availableCoins.map((c) => coinId(c.utxo.intentHash)),
          pending: state.pendingCoins.map((c) => coinId(c.utxo.intentHash)),
        });
      });

      await wallet.waitForSyncedState();
      subscription.unsubscribe();
      await wallet.stop();

      expect(seen.length).toBeGreaterThan(0);
      for (const { available, pending } of seen) {
        expect(pending.filter((id) => available.includes(id))).toEqual([]);
      }
      expect(seen.at(-1)?.pending).toEqual([coinId(duplicated)]);
    });

    it('releases a booking whose transaction can no longer be accepted, as sync updates arrive', async () => {
      // Nothing on chain will ever mention this coin, so only the wallet noticing the expiry can free it.
      const stale = 'h-integration-stale';
      const snapshot = await snapshotHolding([], [coin(stale, '1970-01-01T00:00:00.000Z')]);

      const wallet = UnshieldedWallet(createWalletConfig(indexerPort)).restore(snapshot);
      await wallet.start();
      const state = await wallet.waitForSyncedState();
      await wallet.stop();

      expect(state.pendingCoins.map((c) => coinId(c.utxo.intentHash))).not.toContain(coinId(stale));
      expect(state.availableCoins.map((c) => coinId(c.utxo.intentHash))).toContain(coinId(stale));
    });

    it('keeps a restored booking something still accounts for, and frees it once nothing does', async () => {
      // The coin a counterparty has not answered on yet: sync proves nothing spent it, but a record elsewhere says
      // its transaction is still out there.
      const held = 'h-integration-held';
      const snapshot = await snapshotHolding([], [coin(held, '2999-01-01T00:00:00.000Z')]);

      const wallet = UnshieldedWallet(createWalletConfig(indexerPort)).restore(snapshot);
      await wallet.start();
      await wallet.waitForSyncedState();

      await wallet.releaseRestoredPending([coinId(held)]);
      const stillHeld = await firstValueFrom(wallet.state);
      expect(stillHeld.pendingCoins.map((c) => coinId(c.utxo.intentHash))).toEqual([coinId(held)]);

      await wallet.releaseRestoredPending([]);
      const freed = await firstValueFrom(wallet.state);
      await wallet.stop();

      expect(freed.pendingCoins.map((c) => coinId(c.utxo.intentHash))).not.toContain(coinId(held));
      expect(freed.availableCoins.map((c) => coinId(c.utxo.intentHash))).toContain(coinId(held));
    });
  });

  afterAll(async () => {
    if (startedEnvironment) {
      await startedEnvironment.down();
    }
  });
});
