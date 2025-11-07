import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as path from 'node:path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed, getDustSeed, tokenValue, waitForFullySynced } from './utils.js';
import { WalletBuilder, PublicKey, createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { CombinedTokenTransfer, WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 120_000 });

/**
 * We need the dust wallet to transact
 */
describe('Dust Registration', () => {
  const environmentId = randomUUID();

  const shieldedSenderSeed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
  const shieldedReceiverSeed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000001111');

  const unshieldedSenderSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
  const unshieldedReceiverSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000001111');

  const dustSenderSeed = getDustSeed('0000000000000000000000000000000000000000000000000000000000000002');
  const dustReceiverSeed = getDustSeed('0000000000000000000000000000000000000000000000000000000000001111');

  const unshieldedSenderKeystore = createKeystore(unshieldedSenderSeed, NetworkId.NetworkId.Undeployed);
  const unshieldedReceiverKeystore = createKeystore(unshieldedReceiverSeed, NetworkId.NetworkId.Undeployed);

  let environment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeAll(async () => {
    environment = await new DockerComposeEnvironment(
      path.dirname(new URL(import.meta.url).pathname),
      'docker-compose-dynamic.yml',
    )
      .withEnvironment({
        TESTCONTAINERS_UID: environmentId,
        RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
      })
      .withWaitStrategy(
        `proof-server_${environmentId}`,
        Wait.forLogMessage('Actix runtime found; starting in Actix runtime'),
      )
      .withWaitStrategy(`node_${environmentId}`, Wait.forListeningPorts())
      .withWaitStrategy(`indexer_${environmentId}`, Wait.forListeningPorts())
      .withStartupTimeout(100_000)
      .up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${environment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql`,
        indexerWsUrl: `ws://localhost:${environment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql/ws`,
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
    const dustSender = Dust.startWithSeed(dustSenderSeed, dustParameters, NetworkId.NetworkId.Undeployed);
    const dustReceiver = Dust.startWithSeed(dustReceiverSeed, dustParameters, NetworkId.NetworkId.Undeployed);

    const unshieldedSender = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedSenderKeystore),
      networkId: NetworkId.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
    });

    const unshieldedReceiver = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedReceiverKeystore),
      networkId: NetworkId.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
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
            amount: tokenValue(150000n),
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

    const nightUtxos = receiverStateWithNight.unshielded.availableCoins.filter(
      (coin) => coin.registeredForDustGeneration === false,
    );

    expect(nightUtxos.length).toBeGreaterThan(0);

    const dustRegistrationRecipe = await receiverFacade.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedReceiverKeystore.getPublicKey(),
      (payload) => unshieldedReceiverKeystore.signData(payload),
    );

    const finalizedDustTx = await receiverFacade.finalizeTransaction(dustRegistrationRecipe);
    const dustRegistrationTxHash = await receiverFacade.submitTransaction(finalizedDustTx);

    expect(dustRegistrationTxHash).toBeTypeOf('string');

    const receiverDustBalance = await rx.firstValueFrom(
      receiverFacade.state().pipe(
        rx.filter((s) => s.dust.walletBalance(new Date()) > 0n),
        rx.map((s) => s.dust.walletBalance(new Date())),
      ),
    );

    expect(receiverDustBalance).toBeGreaterThan(0n);
  });
});
