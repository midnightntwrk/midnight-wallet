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
// A wallet that has been quiet for minutes must report itself synchronized as soon as it has applied a transaction
// that reaches it. The indexer tells an unshielded wallet how far its address's timeline goes only on progress messages
// of their own, and while the address is idle it spaces those out: 30 s, then doubling up to 240 s, each ±20%. A
// transaction is sent the moment it is indexed. So the wait here is placed after the spacing has reached its cap, which
// is where a wallet that waited for a progress message to learn its own tip would read as unsynchronized for minutes.
import * as ledger from '@midnightntwrk/ledger-v9';
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import {
  type DefaultConfiguration,
  type FacadeState,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '@midnightntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { PublicKey, UnshieldedWallet, createKeystore } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnightntwrk/wallet-sdk-utilities/testing';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { carried } from './helpers/transactions.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed, tokenValue } from './utils.js';

vi.setConfig({ testTimeout: 900_000, hookTimeout: 300_000 });

/**
 * How long the receiving wallet is left alone before anything reaches it.
 *
 * @remarks
 *   The indexer's progress spacing for an idle address is 30 s, 60 s, 120 s and then 240 s, each ±20%, so the fourth
 *   message has gone out by 252 s at the latest and the next is at least 192 s after it. Waiting 260 s therefore lands
 *   the transfer inside a capped gap with well over a minute to spare, however the jitter fell.
 */
const IDLE_MS = 260_000;

/** How long after the transfer reaches the receiver it may take to report itself synchronized. */
const SYNCED_WITHIN_MS = 20_000;

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

describe('Unshielded sync after an idle period', () => {
  const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
  const RECEIVER_SEED = '0000000000000000000000000000000000000000000000000000000000002222';

  const unshieldedSenderKeystore = createKeystore(
    { kind: 'schnorr', secret: getUnshieldedSeed(SENDER_SEED) },
    NetworkId.NetworkId.Undeployed,
  );
  const unshieldedReceiverKeystore = createKeystore(
    { kind: 'schnorr', secret: getUnshieldedSeed(RECEIVER_SEED) },
    NetworkId.NetworkId.Undeployed,
  );

  let startedEnvironment: StartedDockerComposeEnvironment;
  let configuration: DefaultConfiguration;
  let sender: WalletFacade;
  let receiver: WalletFacade;

  const facadeFor = async (seed: string, keystore: typeof unshieldedSenderKeystore): Promise<WalletFacade> => {
    const shieldedSeed = getShieldedSeed(seed);
    const dustSeed = getDustSeed(seed);
    const facade = await WalletFacade.init({
      configuration: {
        ...configuration,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      },
      shielded: (config) => ShieldedWallet(config).startWithSeed(shieldedSeed),
      unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
      dust: (config) => DustWallet(config).startWithSeed(dustSeed, ledger.LedgerParameters.initialParameters().dust),
    });
    await facade.start({ shielded: shieldedSeed, unshielded: shieldedSeed, dust: dustSeed });
    return facade;
  };

  /** The three sync positions, so a failure says which wallet is behind and by how much. */
  const describeProgress = (state: FacadeState): string =>
    JSON.stringify(
      {
        synced: state.isSynced,
        unshielded: state.unshielded.progress,
        shielded: state.shielded.progress,
        dust: state.dust.progress,
      },
      (_key, value: unknown) => (typeof value === 'bigint' ? `${value}n` : value),
    );

  beforeAll(async () => {
    startedEnvironment = await environment.up();
    const indexerPort = startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088);

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${indexerPort}/api/v4/graphql`,
        indexerWsUrl: `ws://localhost:${indexerPort}/api/v4/graphql/ws`,
      },
      relayURL: new URL(
        `ws://127.0.0.1:${startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`,
      ),
      networkId: NetworkId.NetworkId.Undeployed,
      forks: ProtocolVersion.V9NativeForkSchedule,
      provers: { v9: { kind: 'wasm' } },
      costParameters: { feeBlocksMargin: 5 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };

    [sender, receiver] = await Promise.all([
      facadeFor(SENDER_SEED, unshieldedSenderKeystore),
      facadeFor(RECEIVER_SEED, unshieldedReceiverKeystore),
    ]);
  });

  afterAll(async () => {
    await Promise.all([sender?.stop(), receiver?.stop()]);
    await startedEnvironment?.down({ timeout: 10_000 });
  });

  it('should report a quiet wallet synchronized within seconds of applying a transfer to it, because a transaction it has applied proves how far its timeline goes', async () => {
    await Promise.all([sender.waitForSyncedState(), receiver.waitForSyncedState()]);
    await sleep(IDLE_MS);

    const before = await receiver.waitForSyncedState();
    const appliedBefore = before.unshielded.progress.appliedId;

    const recipe = await sender.transferTransaction(
      [
        {
          type: 'unshielded',
          outputs: [
            {
              amount: tokenValue(1n),
              receiverAddress: await receiver.unshielded.getAddress(),
              type: ledger.unshieldedToken().raw,
            },
          ],
        },
      ],
      { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );
    const finalized = await sender.finalizeRecipe(
      await sender.signRecipe(recipe, unshieldedSenderKeystore.signDataAsync),
    );
    await sender.submitTransaction(finalized);
    const transferHash = carried<ledger.FinalizedTransaction>(finalized).transactionHash().toString();

    const applied = await rx.firstValueFrom(
      receiver.state().pipe(
        rx.filter((state) => state.unshielded.progress.appliedId > appliedBefore),
        rx.timeout({
          first: 120_000,
          with: () => rx.throwError(() => new Error(`transfer ${transferHash} never reached the receiver`)),
        }),
      ),
    );

    const synced = await rx.firstValueFrom(
      receiver.state().pipe(
        rx.filter((state) => state.isSynced),
        rx.timeout({
          first: SYNCED_WITHIN_MS,
          with: () =>
            rx.throwError(
              () =>
                new Error(
                  `receiver still unsynchronized ${SYNCED_WITHIN_MS} ms after applying ${transferHash}: ${describeProgress(applied)}`,
                ),
            ),
        }),
      ),
    );

    expect(synced.isSynced).toBe(true);
    expect(synced.unshielded.availableCoins.some((coin) => coin.utxo.value === tokenValue(1n))).toBe(true);
  });
});
