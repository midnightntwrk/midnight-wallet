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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { PublicKey, UnshieldedWallet, createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { pipe } from 'effect';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CombinedTokenTransfer,
  type DefaultConfiguration,
  WalletEntrySchema,
  WalletFacade,
  isPendingWalletEntry,
  mergeWalletEntries,
} from '../src/index.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed, tokenValue } from './utils/index.js';
import { makeWasmProvingService } from '@midnight-ntwrk/wallet-sdk-capabilities';

vi.setConfig({ testTimeout: 800_000, hookTimeout: 800_000 });

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

describe('Wallet Facade Transfer', () => {
  const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
  const RECEIVER_SEED = '0000000000000000000000000000000000000000000000000000000000001111';

  const shieldedSenderSeed = getShieldedSeed(SENDER_SEED);
  const shieldedReceiverSeed = getShieldedSeed(RECEIVER_SEED);

  const unshieldedSenderSeed = getUnshieldedSeed(SENDER_SEED);
  const unshieldedReceiverSeed = getUnshieldedSeed(RECEIVER_SEED);

  const dustSenderSeed = getDustSeed(SENDER_SEED);
  const dustReceiverSeed = getDustSeed(RECEIVER_SEED);

  const unshieldedSenderKeystore = createKeystore(unshieldedSenderSeed, NetworkId.NetworkId.Undeployed);
  const unshieldedReceiverKeystore = createKeystore(unshieldedReceiverSeed, NetworkId.NetworkId.Undeployed);

  let startedEnvironment: StartedDockerComposeEnvironment;
  let configuration: DefaultConfiguration;

  beforeAll(async () => {
    startedEnvironment = await environment.up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v4/graphql`,
        indexerWsUrl: `ws://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v4/graphql/ws`,
      },
      relayURL: new URL(
        `ws://127.0.0.1:${startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`,
      ),
      networkId: NetworkId.NetworkId.Undeployed,
      costParameters: {
        feeBlocksMargin: 5,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };
  });

  afterAll(async () => {
    await startedEnvironment?.down({ timeout: 10_000 });
  });

  let senderFacade: WalletFacade;
  let receiverFacade: WalletFacade;

  beforeEach(async () => {
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;
    senderFacade = await WalletFacade.init({
      configuration,
      shielded: (config) => ShieldedWallet(config).startWithSeed(shieldedSenderSeed),
      unshielded: (config) =>
        UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedSenderKeystore)),
      dust: (config) => DustWallet(config).startWithSeed(dustSenderSeed, dustParameters),
      provingService: () => makeWasmProvingService(),
    });
    receiverFacade = await WalletFacade.init({
      configuration: {
        ...configuration,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
      },
      shielded: (config) => ShieldedWallet(config).startWithSeed(shieldedReceiverSeed),
      unshielded: (config) =>
        UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedReceiverKeystore)),
      dust: (config) => DustWallet(config).startWithSeed(dustReceiverSeed, dustParameters),
      provingService: () => makeWasmProvingService(),
    });

    await Promise.all([
      senderFacade.start(
        ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
        ledger.DustSecretKey.fromSeed(dustSenderSeed),
      ),
      receiverFacade.start(
        ledger.ZswapSecretKeys.fromSeed(shieldedReceiverSeed),
        ledger.DustSecretKey.fromSeed(dustReceiverSeed),
      ),
    ]);
  });

  afterEach(async () => {
    await Promise.all([senderFacade.stop(), receiverFacade.stop()]);
  });

  it('allows to transfer shielded tokens only', async () => {
    await Promise.all([senderFacade.waitForSyncedState(), receiverFacade.waitForSyncedState()]);

    const receiverAddress = await receiverFacade.shielded.getAddress();

    const ttl = new Date(Date.now() + 60 * 60 * 1000);
    const unprovenTxRecipe = await senderFacade.transferTransaction(
      [
        {
          type: 'shielded',
          outputs: [
            {
              type: ledger.shieldedToken().raw,
              receiverAddress,
              amount: tokenValue(1n),
            },
          ],
        },
      ],
      {
        shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
        dustSecretKey: ledger.DustSecretKey.fromSeed(dustSenderSeed),
      },
      {
        ttl,
      },
    );

    const finalizedTx = await senderFacade.finalizeRecipe(unprovenTxRecipe);
    const finalizedTxHash = finalizedTx.transactionHash().toString();
    const submittedTxIdentifier = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxIdentifier).toBeTypeOf('string');

    // Wait for the transaction to appear in sender's transaction history
    const txHistoryEntry = await rx.firstValueFrom(
      senderFacade.state().pipe(
        rx.concatMap(() => senderFacade.queryTxHistoryByHash(finalizedTxHash)),
        rx.filter((entry) => entry !== undefined),
        rx.timeout(30_000),
      ),
    );

    expect(txHistoryEntry.hash).toBe(finalizedTxHash);

    const isValid = await rx.firstValueFrom(
      receiverFacade
        .state()
        .pipe(rx.filter((s) => s.shielded.availableCoins.some((c) => c.coin.value === tokenValue(1n)))),
    );

    expect(isValid).toBeTruthy();
  });

  it('allows to transfer unshielded tokens', async () => {
    await Promise.all([senderFacade.waitForSyncedState(), receiverFacade.waitForSyncedState()]);

    const receiverAddress = await receiverFacade.unshielded.getAddress();

    const tokenTransfer: CombinedTokenTransfer[] = [
      {
        type: 'unshielded',
        outputs: [
          {
            amount: tokenValue(1n),
            receiverAddress,
            type: ledger.unshieldedToken().raw,
          },
        ],
      },
    ];

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const transactionRecipe = await senderFacade.transferTransaction(
      tokenTransfer,
      {
        shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
        dustSecretKey: ledger.DustSecretKey.fromSeed(dustSenderSeed),
      },
      {
        ttl,
      },
    );

    const signedTxRecipe = await senderFacade.signRecipe(transactionRecipe, (payload) =>
      unshieldedSenderKeystore.signData(payload),
    );

    const finalizedTx = await senderFacade.finalizeRecipe(signedTxRecipe);
    const finalizedTxHash = finalizedTx.transactionHash().toString();

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxHash).toBeTruthy();

    // Wait for the transaction to appear in sender's transaction history
    const txHistoryEntry = await rx.firstValueFrom(
      senderFacade.state().pipe(
        rx.concatMap(() => senderFacade.queryTxHistoryByHash(finalizedTxHash)),
        rx.filter((entry) => entry !== undefined),
        rx.timeout(30_000),
      ),
    );

    expect(txHistoryEntry.hash).toBe(finalizedTxHash);

    const isValid = await rx.firstValueFrom(
      receiverFacade
        .state()
        .pipe(rx.filter((s) => s.unshielded.availableCoins.some((c) => c.utxo.value === tokenValue(1n)))),
    );

    expect(isValid).toBeTruthy();
  });

  it('allows to balance and submit an arbitrary shielded transaction', async () => {
    await pipe(
      senderFacade.state(),
      rx.filter((s) => s.isSynced),
      rx.filter((s) => s.unshielded.availableCoins.length > 0 && s.dust.availableCoins.length > 0),
      rx.firstValueFrom,
    );

    const shieldedReceiverState = await rx.firstValueFrom(receiverFacade.shielded.state);

    const transfer = {
      type: ledger.shieldedToken().raw,
      amount: tokenValue(1n),
    };

    const coin = ledger.createShieldedCoinInfo(transfer.type, transfer.amount);

    const output = ledger.ZswapOutput.new(
      coin,
      0,
      shieldedReceiverState.address.coinPublicKey.toHexString(),
      shieldedReceiverState.address.encryptionPublicKey.toHexString(),
    );

    const outputOffer = ledger.ZswapOffer.fromOutput(output, transfer.type, transfer.amount);

    const arbitraryTx = ledger.Transaction.fromParts(configuration.networkId, outputOffer);

    const balancingTxRecipe = await senderFacade.balanceUnprovenTransaction(
      arbitraryTx,
      {
        shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
        dustSecretKey: ledger.DustSecretKey.fromSeed(dustSenderSeed),
      },
      {
        ttl: new Date(Date.now() + 30 * 60 * 1000),
      },
    );

    const finalizedArbitraryTx = await senderFacade.finalizeRecipe(balancingTxRecipe);

    const submittedTxHash = await senderFacade.submitTransaction(finalizedArbitraryTx);

    expect(submittedTxHash).toBeTypeOf('string');

    const isValid = await rx.firstValueFrom(
      receiverFacade
        .state()
        .pipe(rx.filter((s) => s.shielded.availableCoins.some((c) => c.coin.value === tokenValue(1n)))),
    );

    expect(isValid).toBeTruthy();
  });

  it('allows to balance and submit an arbitrary unshielded transaction', async () => {
    await pipe(
      senderFacade.state(),
      rx.filter((s) => s.isSynced),
      rx.first((s) => s.unshielded.availableCoins.length > 0 && s.dust.availableCoins.length > 0),
      rx.firstValueFrom,
    );

    const outputs = [
      {
        type: ledger.unshieldedToken().raw,
        value: tokenValue(1n),
        owner: unshieldedReceiverKeystore.getAddress(),
      },
    ];

    const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], outputs, []);

    const arbitraryTx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, undefined, undefined, intent);

    const balancingTxRecipe = await senderFacade.balanceUnprovenTransaction(
      arbitraryTx,
      {
        shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
        dustSecretKey: ledger.DustSecretKey.fromSeed(dustSenderSeed),
      },
      {
        ttl: new Date(Date.now() + 30 * 60 * 1000),
      },
    );

    // Sign the balancing transaction before finalizing
    const signedBalancingTxRecipe = await senderFacade.signRecipe(balancingTxRecipe, (payload) =>
      unshieldedSenderKeystore.signData(payload),
    );

    const finalizedArbitraryTx = await senderFacade.finalizeRecipe(signedBalancingTxRecipe);

    const submittedTxHash = await senderFacade.submitTransaction(finalizedArbitraryTx);

    expect(submittedTxHash).toBeTypeOf('string');

    const isValid = await rx.firstValueFrom(
      receiverFacade
        .state()
        .pipe(rx.filter((s) => s.unshielded.availableCoins.some((c) => c.utxo.value === tokenValue(1n)))),
    );

    expect(isValid).toBeTruthy();
  });

  // NOTE: This test runs last because the combined (shielded + unshielded) transfer leaves
  // sender-side state that causes the earlier arbitrary-unshielded test to fail submission
  // with MalformedError::FeeCalculation (node error code 168). Keeping this test last
  // avoids the cross-test interference until the underlying fee-calc divergence is fixed.
  it('records shielded, unshielded, and dust sections in tx history for a combined transfer matches expected structure', async () => {
    const transferAmount = tokenValue(1n);

    const [, receiverPreState] = await Promise.all([
      senderFacade.waitForSyncedState(),
      receiverFacade.waitForSyncedState(),
    ]);

    // Snapshot the receiver's pre-existing coins.
    const receiverPreShieldedNonces = new Set(receiverPreState.shielded.availableCoins.map((c) => c.coin.nonce));
    const receiverPreUnshieldedKeys = new Set(
      receiverPreState.unshielded.availableCoins.map((c) => `${c.utxo.intentHash}#${c.utxo.outputNo}`),
    );

    // Snapshot the sender's available coins.
    const senderPreState = await rx.firstValueFrom(
      senderFacade
        .state()
        .pipe(
          rx.filter(
            (s) =>
              s.shielded.availableCoins.some((c) => c.coin.type === ledger.shieldedToken().raw) &&
              s.unshielded.availableCoins.some((c) => c.utxo.type === ledger.unshieldedToken().raw) &&
              s.dust.availableCoins.length > 0,
          ),
        ),
    );

    // Snapshot every sender-owned coin/UTXO.
    const senderShieldedNonces = new Set(senderPreState.shielded.availableCoins.map((c) => c.coin.nonce));
    const senderUnshieldedKeys = new Set(
      senderPreState.unshielded.availableCoins.map((c) => `${c.utxo.intentHash}#${c.utxo.outputNo}`),
    );
    const senderDustNonces = new Set(senderPreState.dust.availableCoins.map((c) => c.token.nonce));

    const shieldedReceiverAddress = await receiverFacade.shielded.getAddress();
    const unshieldedReceiverAddress = await receiverFacade.unshielded.getAddress();

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const tokenTransfer: CombinedTokenTransfer[] = [
      {
        type: 'shielded',
        outputs: [
          {
            amount: transferAmount,
            receiverAddress: shieldedReceiverAddress,
            type: ledger.shieldedToken().raw,
          },
        ],
      },
      {
        type: 'unshielded',
        outputs: [
          {
            amount: transferAmount,
            receiverAddress: unshieldedReceiverAddress,
            type: ledger.unshieldedToken().raw,
          },
        ],
      },
    ];

    const transactionRecipe = await senderFacade.transferTransaction(
      tokenTransfer,
      {
        shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
        dustSecretKey: ledger.DustSecretKey.fromSeed(dustSenderSeed),
      },
      { ttl },
    );

    const signedTxRecipe = await senderFacade.signRecipe(transactionRecipe, (payload) =>
      unshieldedSenderKeystore.signData(payload),
    );
    const finalizedTx = await senderFacade.finalizeRecipe(signedTxRecipe);
    const finalizedTxHash = finalizedTx.transactionHash().toString();
    const submittedTxIdentifier = await senderFacade.submitTransaction(finalizedTx);

    // Wait for the tx to land in sender history as a SUCCESS with all three sections present.
    const txHistoryEntry = await rx.firstValueFrom(
      senderFacade.state().pipe(
        rx.concatMap(() => senderFacade.queryTxHistoryByHash(finalizedTxHash)),
        rx.filter((entry) => entry !== undefined),
        rx.filter(
          (entry) =>
            entry.status === 'SUCCESS' &&
            entry.shielded !== undefined &&
            entry.unshielded !== undefined &&
            entry.dust !== undefined,
        ),
        rx.timeout(60_000),
      ),
    );

    expect(txHistoryEntry.hash).toBe(finalizedTxHash);
    expect(txHistoryEntry.identifiers).toContain(submittedTxIdentifier);
    expect(txHistoryEntry.fees).toBeDefined();

    expect(txHistoryEntry.shielded!.spentCoins.length).toBeGreaterThan(0);
    expect(txHistoryEntry.shielded!.spentCoins.every((c) => senderShieldedNonces.has(c.nonce))).toBe(true);

    expect(txHistoryEntry.unshielded!.spentUtxos.length).toBeGreaterThan(0);
    expect(
      txHistoryEntry.unshielded!.spentUtxos.every((u) => senderUnshieldedKeys.has(`${u.intentHash}#${u.outputIndex}`)),
    ).toBe(true);

    expect(txHistoryEntry.dust!.spentUtxos.some((u) => senderDustNonces.has(u.nonce))).toBe(true);

    // TODO Ian — temp for testing the new pending-tx-history flow.
    // cleared by the per-wallet sync-handler promotion (clearPendingMatching).
    const senderHistory = await senderFacade.getAllFromTxHistory();
    const stillPending = senderHistory.filter(isPendingWalletEntry);
    expect(stillPending).toEqual([]);
    // TODO Ian — end temp for testing.

    // Once the tx is present in the receiver's history, the state update has already
    // been applied — no extra state-filter wait needed; the expects below suffice.
    await rx.firstValueFrom(
      receiverFacade.state().pipe(
        rx.concatMap(() => receiverFacade.queryTxHistoryByHash(finalizedTxHash)),
        rx.filter((entry) => entry !== undefined),
        rx.timeout(60_000),
      ),
    );

    const receiverState = await rx.firstValueFrom(receiverFacade.state());

    const newShieldedCoin = receiverState.shielded.availableCoins.find(
      (c) =>
        c.coin.type === ledger.shieldedToken().raw &&
        c.coin.value === transferAmount &&
        !receiverPreShieldedNonces.has(c.coin.nonce),
    );
    const newUnshieldedUtxo = receiverState.unshielded.availableCoins.find(
      (u) =>
        u.utxo.type === ledger.unshieldedToken().raw &&
        u.utxo.value === transferAmount &&
        !receiverPreUnshieldedKeys.has(`${u.utxo.intentHash}#${u.utxo.outputNo}`),
    );

    expect(newShieldedCoin).toBeDefined();
    expect(newUnshieldedUtxo).toBeDefined();
  });
});
