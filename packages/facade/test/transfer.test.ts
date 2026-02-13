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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { V1Builder, Proving } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { CustomShieldedWallet, type ShieldedTransactionHistoryEntry } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  PublicKey,
  type UnshieldedTransactionHistoryEntry,
  UnshieldedWallet,
  createKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { pipe } from 'effect';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CombinedTokenTransfer, type DefaultConfiguration, WalletFacade } from '../src/index.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed, tokenValue, waitForFullySynced } from './utils/index.js';

vi.setConfig({ testTimeout: 800_000, hookTimeout: 800_000 });

// TODO IAN - Keep containers running after tests (for debugging - point GraphQL client at indexer)
// process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';

const environmentId = randomUUID();

// const tt = new InMemoryTransactionHistoryStorage<ShieldedTransactionHistoryEntry>();

// tt.blabla();

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
  let configuration: DefaultConfiguration & Proving.WasmProvingConfiguration;

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
      costParameters: {
        additionalFeeOverhead: 400_000_000_000_000n,
        feeBlocksMargin: 5,
      },
      shieldedTxHistoryStorage: new InMemoryTransactionHistoryStorage<ShieldedTransactionHistoryEntry>(),
      unshieldedTxHistoryStorage: new InMemoryTransactionHistoryStorage<UnshieldedTransactionHistoryEntry>(),
    };

    console.log('configuration', configuration);
  });

  afterAll(async () => {
    // console.log('disabled the brinign down of the enviroment');
    // await startedEnvironment?.down({ timeout: 10_000 });
  });

  let senderFacade: WalletFacade;
  let receiverFacade: WalletFacade;

  beforeEach(async () => {
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;
    senderFacade = await WalletFacade.init({
      configuration,
      shielded: (config) =>
        CustomShieldedWallet(
          config,
          new V1Builder().withDefaults().withProving(Proving.makeWasmProvingService),
        ).startWithSeed(shieldedSenderSeed),
      unshielded: (config) =>
        UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedSenderKeystore)),
      dust: (config) => DustWallet(config).startWithSeed(dustSenderSeed, dustParameters),
    });
    receiverFacade = await WalletFacade.init({
      configuration,
      shielded: (config) =>
        CustomShieldedWallet(
          config,
          new V1Builder().withDefaults().withProving(Proving.makeWasmProvingService),
        ).startWithSeed(shieldedReceiverSeed),
      unshielded: (config) =>
        UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedReceiverKeystore)),
      dust: (config) => DustWallet(config).startWithSeed(dustReceiverSeed, dustParameters),
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
    const tt = new InMemoryTransactionHistoryStorage<ShieldedTransactionHistoryEntry>();

    tt.blablax();

    await Promise.all([
      pipe(
        senderFacade.state(),
        rx.filter((s) => s.isSynced),
        rx.first((s) => s.unshielded.availableCoins.length > 0 && s.dust.availableCoins.length > 0),
        rx.firstValueFrom,
      ),
      waitForFullySynced(receiverFacade),
    ]);

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
    const erasedProofs = finalizedTx.eraseProofs();
    const finalizedTxHashTest = erasedProofs.transactionHash().toString();
    const submittedTxIdentifier = await senderFacade.submitTransaction(finalizedTx);

    console.log('finalizedTxHash', finalizedTxHash);
    console.log('submittedTxIdentifier', submittedTxIdentifier);

    console.log('I am waiting for receiver to be synced!!');
    await waitForFullySynced(receiverFacade);

    console.log('finished waiting for receiver to be synced!!');

    console.log('I am waiting!!');

    await new Promise<void>((resolve) =>
      setTimeout(() => {
        // console.debug('finalizedTx', finalizedTx.identifiers());
        console.log('timeout finished!!');
        resolve();
      }, 15_000),
    );

    const finalizedTxHashx = finalizedTx.transactionHash().toString();

    console.log('finalizedTxHashx', finalizedTxHashx);

    console.log('I am done waiting!!');

    expect(submittedTxIdentifier).toBeTypeOf('string');

    // Check that transaction history contains the submitted transaction hash
    const shieldedState = await rx.firstValueFrom(senderFacade.shielded.state);
    const txHistory = shieldedState.transactionHistory;

    const allTxHistory = txHistory.getAll();

    const allTxHistoryArray: unknown[] = [];
    for await (const tx of allTxHistory) {
      allTxHistoryArray.push(tx);
    }

    console.log('allTxHistory', allTxHistoryArray);

    // remove this key from allTxHistory 93ac2debc35ca3d3eb1a85051e3a6a1cab8e57b1caf4efd67665c8af34f6686b
    // forEach does not seem to work with AsyncIterableIterator
    // for await (const tx of allTxHistory) {
    //   if (tx.hash === finalizedTx.transactionHash().toString()) {
    //     allTxHistory.delete(tx.hash);
    //     break;
    //   }
    // }

    console.debug('Final variables logging to check against indexer...');
    console.debug('finalizedTxHash', finalizedTxHash);
    console.debug('finalizedTxHashTest', finalizedTxHashTest);
    console.debug('submittedTxIdentifier', submittedTxIdentifier);

    // const txInHistory = await txHistory.get(finalizedTx.transactionHash().toString());
    // const txInHistory = txHistory.find((tx) => tx.identifiers().includes(submittedTxHash));
    // expect(txInHistory).toBeDefined();
    // expect(txInHistory?.hash).toBe(submittedTxHash);
    // expect(txInHistory?.identifiers().includes(submittedTxHash)).toBe(true);

    const isValid = await rx.firstValueFrom(
      receiverFacade
        .state()
        .pipe(rx.filter((s) => s.shielded.availableCoins.some((c) => c.coin.value === tokenValue(1n)))),
    );

    expect(isValid).toBeTruthy();
  });

  it('allows to transfer unshielded tokens', async () => {
    await Promise.all([
      pipe(
        senderFacade.state(),
        rx.filter((s) => s.isSynced),
        rx.first((s) => s.unshielded.availableCoins.length > 0 && s.dust.availableCoins.length > 0),
        rx.firstValueFrom,
      ),
      waitForFullySynced(receiverFacade),
    ]);

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

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxHash).toBeTruthy();

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
});
