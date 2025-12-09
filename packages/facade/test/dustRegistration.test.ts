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
import {
  getShieldedSeed,
  getUnshieldedSeed,
  getDustSeed,
  tokenValue,
  waitForFullySynced,
  waitForDustGenerated,
} from './utils.js';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { WalletBuilder, PublicKey, createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { CombinedTokenTransfer, WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ArrayOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { InMemoryTransactionHistoryStorage } from '../../unshielded-wallet/dist/tx-history-storage/InMemoryTransactionHistoryStorage.js';

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

describe('Dust Registration', () => {
  const shieldedSenderSeed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
  const shieldedReceiverSeed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000001111');

  const unshieldedSenderSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
  const unshieldedReceiverSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000001111');

  const dustSenderSeed = getDustSeed('0000000000000000000000000000000000000000000000000000000000000002');
  const dustReceiverSeed = getDustSeed('0000000000000000000000000000000000000000000000000000000000001111');

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

    const unshieldedSender = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedSenderKeystore),
      networkId: NetworkId.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
    });

    const unshieldedReceiver = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedReceiverKeystore),
      networkId: NetworkId.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
      txHistoryStorage: unshieldedTxHistoryStorage,
    });

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

    const unshieldedReceiverState = await rx.firstValueFrom(receiverFacade.unshielded.state());

    const tokenTransfer: CombinedTokenTransfer[] = [
      {
        type: 'unshielded',
        outputs: [
          {
            amount: tokenValue(150_000_000n),
            receiverAddress: unshieldedReceiverState.address,
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
              s.unshielded.availableCoins.some((coin) => coin.registeredForDustGeneration === false),
          ),
        ),
    );
    const nightBalanceBeforeRegistration = receiverStateWithNight.unshielded.balances.get(ledger.nativeToken().raw);

    const nightUtxos = receiverStateWithNight.unshielded.availableCoins
      .filter((coin) => coin.registeredForDustGeneration === false)
      .filter((coin) => coin.type === ledger.nativeToken().raw);

    expect(ArrayOps.sumBigInt(nightUtxos.map((coin) => coin.value))).toEqual(nightBalanceBeforeRegistration);

    await waitForDustGenerated();

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
        rx.filter((state) => {
          // @TODO after the unshielded runtime rewrite, we'll be able to access the tx history storage from the state
          const txFound =
            receiverFacade.unshielded.transactionHistory?.get(finalizedDustTx.transactionHash()) !== undefined;

          return state.isSynced && state.dust.availableCoins.length > 0 && txFound;
        }),
      ),
    );

    expect(receiverStateAfterRegistration.dust.walletBalance(new Date())).toBeGreaterThan(0n);

    const nightBalanceAfterRegistration = receiverStateAfterRegistration.unshielded.balances.get(
      ledger.nativeToken().raw,
    );
    expect(nightBalanceAfterRegistration).toEqual(nightBalanceBeforeRegistration);
  });
});
