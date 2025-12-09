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
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed, getDustSeed, tokenValue, waitForFullySynced } from './utils.js';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import {
  createKeystore,
  UnshieldedWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { CombinedTokenTransfer, WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { ArrayOps } from '@midnight-ntwrk/wallet-sdk-utilities';

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
  .withWaitStrategy(`indexer_${environmentId}`, Wait.forListeningPorts())
  .withEnvironment(environmentVars)
  .withStartupTimeout(100_000);

/**
 * We need the dust wallet to transact
 */
describe('Dust Registration', () => {
  const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000002';
  const RECEIVER_SEED = '0000000000000000000000000000000000000000000000000000000000001111';

  const shieldedSenderSeed = getShieldedSeed(SENDER_SEED);
  const shieldedReceiverSeed = getShieldedSeed(RECEIVER_SEED);

  const unshieldedSenderSeed = getUnshieldedSeed(SENDER_SEED);
  const unshieldedReceiverSeed = getUnshieldedSeed(RECEIVER_SEED);

  const dustSenderSeed = getDustSeed(SENDER_SEED);
  const dustReceiverSeed = getDustSeed(RECEIVER_SEED);

  const unshieldedSenderKeystore = createKeystore(unshieldedSenderSeed, NetworkId.NetworkId.Undeployed);
  const unshieldedReceiverKeystore = createKeystore(unshieldedReceiverSeed, NetworkId.NetworkId.Undeployed);

  const unshieldedTxHistoryStorage = new InMemoryTransactionHistoryStorage();

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

  let senderFacade: WalletFacade;
  let receiverFacade: WalletFacade;

  beforeEach(async () => {
    const Shielded = ShieldedWallet(configuration);
    const shieldedSender = Shielded.startWithShieldedSeed(shieldedSenderSeed);
    const shieldedReceiver = Shielded.startWithShieldedSeed(shieldedReceiverSeed);

    const Dust = DustWallet({
      ...configuration,
      costParameters: {
        additionalFeeOverhead: 300_000_000_000_000n,
        feeBlocksMargin: 5,
      },
    });
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;
    const dustSender = Dust.startWithSeed(dustSenderSeed, dustParameters);
    const dustReceiver = Dust.startWithSeed(dustReceiverSeed, dustParameters);

    const unshieldedSender = UnshieldedWallet({
      ...configuration,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedSenderKeystore));

    const unshieldedReceiver = UnshieldedWallet({
      ...configuration,
      txHistoryStorage: unshieldedTxHistoryStorage,
    }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedReceiverKeystore));

    senderFacade = new WalletFacade(shieldedSender, unshieldedSender, dustSender);
    receiverFacade = new WalletFacade(shieldedReceiver, unshieldedReceiver, dustReceiver);

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

  it('registers dust generation after receiving unshielded tokens', async () => {
    await Promise.all([waitForFullySynced(senderFacade), waitForFullySynced(receiverFacade)]);

    const unshieldedReceiverState = await rx.firstValueFrom(receiverFacade.unshielded.state);

    const tokenTransfer: CombinedTokenTransfer[] = [
      {
        type: 'unshielded',
        outputs: [
          {
            amount: tokenValue(150000n),
            receiverAddress: UnshieldedAddress.codec
              .encode(configuration.networkId, unshieldedReceiverState.address)
              .asString(),
            type: ledger.unshieldedToken().raw,
          },
        ],
      },
    ];

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const transferRecipe = await senderFacade.transferTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      tokenTransfer,
      ttl,
    );

    const signedTransferTx = await senderFacade.signTransaction(transferRecipe.transaction, (payload) =>
      unshieldedSenderKeystore.signData(payload),
    );

    const finalizedTransferTx = await senderFacade.finalizeTransaction({
      ...transferRecipe,
      transaction: signedTransferTx,
    });

    const transferTxHash = await senderFacade.submitTransaction(finalizedTransferTx);
    expect(transferTxHash).toBeTypeOf('string');

    const receiverStateWithNight = await rx.firstValueFrom(
      receiverFacade
        .state()
        .pipe(
          rx.filter(
            (s) =>
              s.unshielded.availableCoins.length > 0 &&
              s.unshielded.availableCoins.some((coin) => coin.meta.registeredForDustGeneration === false),
          ),
        ),
    );

    const nightBalanceBeforeRegistration = receiverStateWithNight.unshielded.balances[ledger.nativeToken().raw];

    const nightUtxos = receiverStateWithNight.unshielded.availableCoins.filter(
      (coin) => coin.meta.registeredForDustGeneration === false && coin.utxo.type === ledger.nativeToken().raw,
    );

    expect(ArrayOps.sumBigInt(nightUtxos.map(({ utxo }) => utxo.value))).toEqual(nightBalanceBeforeRegistration);

    const dustRegistrationRecipe = await receiverFacade.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedReceiverKeystore.getPublicKey(),
      (payload) => unshieldedReceiverKeystore.signData(payload),
    );

    const finalizedDustTx = await receiverFacade.finalizeTransaction(dustRegistrationRecipe);

    const dustRegistrationTxHash = await receiverFacade.submitTransaction(finalizedDustTx);

    expect(dustRegistrationTxHash).toBeTypeOf('string');

    const receiverStateAfterRegistration = await rx.firstValueFrom(
      receiverFacade.state().pipe(
        rx.mergeMap(async (state) => {
          const txInHistory = await state.unshielded.transactionHistory.get(finalizedDustTx.transactionHash());

          return {
            state,
            txFound: txInHistory !== undefined,
          };
        }),
        rx.filter(({ state, txFound }) => txFound && state.isSynced && state.dust.availableCoins.length > 0),
        rx.map(({ state }) => state),
      ),
    );

    expect(receiverStateAfterRegistration.dust.walletBalance(new Date())).toBeGreaterThan(0n);

    const nightBalanceAfterRegistration = receiverStateAfterRegistration.unshielded.balances[ledger.nativeToken().raw];

    expect(nightBalanceAfterRegistration).toEqual(nightBalanceBeforeRegistration);
  });
});
