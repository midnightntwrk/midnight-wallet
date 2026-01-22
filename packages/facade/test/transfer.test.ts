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
import { ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  createKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { pipe } from 'effect';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CombinedTokenTransfer, type DefaultConfiguration, WalletFacade } from '../src/index.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed, tokenValue, waitForFullySynced } from './utils/index.js';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 200_000 });

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
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    };
  });

  afterAll(async () => {
    await startedEnvironment?.down({ timeout: 10_000 });
  });

  let senderFacade: WalletFacade;
  let receiverFacade: WalletFacade;

  beforeEach(async () => {
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;
    senderFacade = WalletFacade.init({
      configuration,
      shielded: (config) => ShieldedWallet(config).startWithShieldedSeed(shieldedSenderSeed),
      unshielded: (config) =>
        UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedSenderKeystore)),
      dust: (config) => DustWallet(config).startWithSeed(dustSenderSeed, dustParameters),
    });
    receiverFacade = WalletFacade.init({
      configuration: { ...configuration, txHistoryStorage: new InMemoryTransactionHistoryStorage() },
      shielded: (config) => ShieldedWallet(config).startWithShieldedSeed(shieldedReceiverSeed),
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
    await Promise.all([
      pipe(
        senderFacade.state(),
        rx.filter((s) => s.isSynced),
        rx.first((s) => s.unshielded.availableCoins.length > 0 && s.dust.availableCoins.length > 0),
        rx.firstValueFrom,
      ),
      waitForFullySynced(receiverFacade),
    ]);

    const ledgerReceiverAddress = ShieldedAddress.codec
      .encode(configuration.networkId, await receiverFacade.shielded.getAddress())
      .asString();

    const ttl = new Date(Date.now() + 60 * 60 * 1000);
    const unprovenTxRecipe = await senderFacade.transferTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      [
        {
          type: 'shielded',
          outputs: [
            {
              type: ledger.shieldedToken().raw,
              receiverAddress: ledgerReceiverAddress,
              amount: tokenValue(1n),
            },
          ],
        },
      ],
      ttl,
    );

    const finalizedTx = await senderFacade.finalizeRecipe(unprovenTxRecipe);

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxHash).toBeTypeOf('string');

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

    const unshieldedReceiverState = await rx.firstValueFrom(receiverFacade.unshielded.state);

    const tokenTransfer: CombinedTokenTransfer[] = [
      {
        type: 'unshielded',
        outputs: [
          {
            amount: tokenValue(1n),
            receiverAddress: UnshieldedAddress.codec
              .encode(configuration.networkId, unshieldedReceiverState.address)
              .asString(),
            type: ledger.unshieldedToken().raw,
          },
        ],
      },
    ];

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const transactionRecipe = await senderFacade.transferTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      tokenTransfer,
      ttl,
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
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      arbitraryTx,
      new Date(Date.now() + 30 * 60 * 1000),
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
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      arbitraryTx,
      new Date(Date.now() + 30 * 60 * 1000),
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
