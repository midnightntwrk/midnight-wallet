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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { Array as Arr, Order, pipe } from 'effect';
import { Observable } from 'rxjs';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getShieldedSeed,
  getUnshieldedSeed,
  getDustSeed,
  tokenValue,
  waitForFullySynced,
  waitForDustGenerated,
} from './utils/helpers.js';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import {
  createKeystore,
  UnshieldedWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { CombinedTokenTransfer, FacadeState, WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { ArrayOps, DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';

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
  const SENDER_SEED = '0000000000000000000000000000000000000000000000000000000000000002';
  const shieldedSenderSeed = getShieldedSeed(SENDER_SEED);
  const unshieldedSenderSeed = getUnshieldedSeed(SENDER_SEED);
  const dustSenderSeed = getDustSeed(SENDER_SEED);
  const unshieldedSenderKeystore = createKeystore(unshieldedSenderSeed, NetworkId.NetworkId.Undeployed);
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

  let RECEIVER_SEED: string;
  let shieldedReceiverSeed: Uint8Array;
  let unshieldedReceiverSeed: Uint8Array;
  let dustReceiverSeed: Uint8Array;
  let unshieldedReceiverKeystore: UnshieldedKeystore;

  beforeEach(async () => {
    RECEIVER_SEED = crypto.randomBytes(32).toString('hex');
    shieldedReceiverSeed = getShieldedSeed(RECEIVER_SEED);
    unshieldedReceiverSeed = getUnshieldedSeed(RECEIVER_SEED);
    dustReceiverSeed = getDustSeed(RECEIVER_SEED);
    unshieldedReceiverKeystore = createKeystore(unshieldedReceiverSeed, NetworkId.NetworkId.Undeployed);

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
            amount: tokenValue(150_000_000n),
            receiverAddress: UnshieldedAddress.codec
              .encode(configuration.networkId, unshieldedReceiverState.address)
              .asString(),
            type: ledger.unshieldedToken().raw,
          },
        ],
      },
    ];

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const transferTxRecipe = await senderFacade.transferTransaction(
      tokenTransfer,
      {
        shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
        dustSecretKey: ledger.DustSecretKey.fromSeed(dustSenderSeed),
      },
      {
        ttl,
      },
    );

    const signedTransferTxRecipe = await senderFacade.signRecipe(transferTxRecipe, (payload) =>
      unshieldedSenderKeystore.signData(payload),
    );

    const finalizedTx = await senderFacade.finalizeRecipe(signedTransferTxRecipe);

    const transferTxHash = await senderFacade.submitTransaction(finalizedTx);

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

    await waitForDustGenerated();

    const dustRegistrationRecipe = await receiverFacade.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedReceiverKeystore.getPublicKey(),
      (payload) => unshieldedReceiverKeystore.signData(payload),
    );

    const provenDustRegistrationTx = await receiverFacade.finalizeRecipe(dustRegistrationRecipe);

    const dustRegistrationTxHash = await receiverFacade.submitTransaction(provenDustRegistrationTx);

    expect(dustRegistrationTxHash).toBeTypeOf('string');

    const receiverStateAfterRegistration = await rx.firstValueFrom(
      receiverFacade.state().pipe(
        rx.mergeMap(async (state) => {
          const txInHistory = await state.unshielded.transactionHistory.get(provenDustRegistrationTx.transactionHash());

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

  it('allows to transfer all Night utxos held and then use them for a registration', async () => {
    const NIGHT = ledger.nativeToken().raw;
    const senderInitialState = await rx.firstValueFrom(
      senderFacade.state().pipe(
        rx.filter((s) => s.unshielded.availableCoins.length > 0),
        rx.filter((s) => s.isSynced),
      ),
    );
    const receiverAddress = await rx.firstValueFrom(
      receiverFacade.state().pipe(
        rx.map((state) => state.unshielded.address),
        rx.map((addr) => MidnightBech32m.encode(NetworkId.NetworkId.Undeployed, addr).toString()),
      ),
    );

    const targetOutputsNo = 5;
    // In this way we ensure that we use 2 input utxos in the transfer while creating the ${targetOutputsNo} outputs
    const singleOutputAmount: bigint = pipe(
      senderInitialState.unshielded.availableCoins,
      Arr.filter((coin) => coin.utxo.type === NIGHT),
      Arr.map((nightUtxo) => nightUtxo.utxo.value),
      Arr.sortBy(Order.reverse(Order.bigint)),
      (sorted) => sorted.at(0)!,
      (maxValue) => maxValue / BigInt(targetOutputsNo - 1),
    );
    const transfersToMake: CombinedTokenTransfer = {
      type: 'unshielded',
      outputs: Arr.replicate(targetOutputsNo)({
        type: NIGHT,
        receiverAddress: receiverAddress,
        amount: singleOutputAmount,
      }),
    };

    await senderFacade
      .transferTransaction(
        [transfersToMake],
        {
          shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
          dustSecretKey: ledger.DustSecretKey.fromSeed(dustSenderSeed),
        },
        {
          ttl: DateOps.addSeconds(new Date(), 1800),
        },
      )
      .then((recipe) => senderFacade.signRecipe(recipe, (payload) => unshieldedSenderKeystore.signData(payload)))
      .then((signedTxRecipe) => senderFacade.finalizeRecipe(signedTxRecipe))
      .then((tx) => senderFacade.submitTransaction(tx));

    // Let's wait until receiver has received Night and has generated enough Dust to pay fees for the registration tx
    const receiverStateBeforeRegistration: FacadeState = await pipe(
      rx.interval(1),
      rx.switchMap(() => receiverFacade.state()),
      rx.filter((state) => state.isSynced),
      rx.filter((s) => s.unshielded.availableCoins.length == targetOutputsNo),
      rx.concatMap(async (state) => {
        const estimate = await receiverFacade.estimateRegistration(state.unshielded.availableCoins);
        return { state, estimate };
      }),
      rx.filter(({ estimate }) => {
        const expected = estimate.fee;
        const got = pipe(
          estimate.dustGenerationEstimations,
          Arr.map((utxoEstimation) => utxoEstimation.dust.generatedNow),
          ArrayOps.sumBigInt,
        );

        return got >= expected;
      }),
      rx.map((s) => s.state),
      (s$: Observable<FacadeState>) => rx.firstValueFrom(s$),
    );

    await receiverFacade
      .registerNightUtxosForDustGeneration(
        receiverStateBeforeRegistration.unshielded.availableCoins,
        unshieldedReceiverKeystore.getPublicKey(),
        (payload) => unshieldedReceiverKeystore.signData(payload),
      )
      .then((recipe) => receiverFacade.finalizeRecipe(recipe))
      .then((tx) => receiverFacade.submitTransaction(tx));

    const finalReceiverState = await rx.firstValueFrom(
      receiverFacade.state().pipe(
        rx.filter((s) => s.isSynced),
        rx.filter((s) => s.dust.availableCoins.length > 0),
      ),
    );

    expect(receiverStateBeforeRegistration.dust.availableCoins.length).toEqual(0);
    for (const coin of receiverStateBeforeRegistration.unshielded.availableCoins) {
      expect(coin.meta.registeredForDustGeneration).toBe(false);
    }
    for (const coin of finalReceiverState.unshielded.availableCoins) {
      expect(coin.meta.registeredForDustGeneration).toBe(true);
    }
  });
});
