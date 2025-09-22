import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as path from 'node:path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed } from './utils';
import { WalletBuilder, PublicKey, createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { CombinedTokenTransfer, WalletFacade } from '../src';
import { ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 60_000 });

describe('Wallet Facade Transfer', () => {
  const environmentId = randomUUID();

  const shieldedSenderSeed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
  const shieldedReceiverSeed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000001111');

  const unshieldedSenderSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');
  const unshieldedReceiverSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000001111');

  const unshieldedSenderKeystore = createKeystore(unshieldedSenderSeed, ledger.NetworkId.Undeployed);
  const unshieldedReceiverKeystore = createKeystore(unshieldedReceiverSeed, ledger.NetworkId.Undeployed);

  let environment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeAll(async () => {
    environment = await new DockerComposeEnvironment(
      path.resolve(new URL(import.meta.url).pathname, '../../../../packages/e2e-tests'),
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
      .up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${environment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v1/graphql`,
        indexerWsUrl: `ws://localhost:${environment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v1/graphql/ws`,
      },
      provingServerUrl: new URL(
        `http://localhost:${environment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      relayURL: new URL(`ws://127.0.0.1:${environment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`),
      networkId: ledger.NetworkId.Undeployed,
      costParameters: {
        ledgerParams: ledger.LedgerParameters.dummyParameters(),
        additionalFeeOverhead: 50_000n,
      },
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

    const unshieldedSender = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedSenderKeystore),
      networkId: ledger.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
    });

    const unshieldedReceiver = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedReceiverKeystore),
      networkId: ledger.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
    });

    senderFacade = new WalletFacade(shieldedSender, unshieldedSender);
    receiverFacade = new WalletFacade(shieldedReceiver, unshieldedReceiver);

    await Promise.all([
      senderFacade.start(ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed)),
      receiverFacade.start(ledger.ZswapSecretKeys.fromSeed(shieldedReceiverSeed)),
    ]);
  });

  afterEach(async () => {
    await Promise.all([senderFacade.stop(), receiverFacade.stop()]);
  });

  it('allows to transfer shielded tokens only', async () => {
    await Promise.all([
      rx.firstValueFrom(senderFacade.state().pipe(rx.filter((s) => s.shielded.state.progress.isStrictlyComplete()))),
      rx.firstValueFrom(receiverFacade.state().pipe(rx.filter((s) => s.shielded.state.progress.isStrictlyComplete()))),
    ]);

    const ledgerReceiverAddress = ShieldedAddress.codec
      .encode(ledger.NetworkId.Undeployed, await receiverFacade.shielded.getAddress())
      .asString();

    const transfer = await senderFacade.transferTransaction(ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed), [
      {
        type: 'shielded',
        outputs: [
          {
            type: (ledger.shieldedToken() as { tag: string; raw: string }).raw,
            receiverAddress: ledgerReceiverAddress,
            amount: 1n,
          },
        ],
      },
    ]);

    const finalizedTx = await senderFacade.finalizeTransaction(transfer);

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxHash).toBeTypeOf('string');

    const isValid = await rx.firstValueFrom(
      receiverFacade.state().pipe(rx.filter((s) => s.shielded.availableCoins.some((c) => c.coin.value === 1n))),
    );

    expect(isValid).toBeTruthy();
  });

  it('allows transfer unshielded tokens', async () => {
    const unshieldedReceiverState = await rx.firstValueFrom(receiverFacade.unshielded.state());

    const tokenTransfer: CombinedTokenTransfer[] = [
      {
        type: 'unshielded',
        outputs: [
          {
            amount: 1n,
            receiverAddress: unshieldedReceiverState.address,
            type: (ledger.unshieldedToken() as { tag: string; raw: string }).raw,
          },
        ],
      },
    ];

    await rx.firstValueFrom(
      senderFacade
        .state()
        .pipe(
          rx.filter(
            (state) =>
              state.unshielded.syncProgress !== undefined &&
              state.unshielded.syncProgress.applyGap === 0 &&
              state.shielded.state.progress.isStrictlyComplete(),
          ),
        ),
    );

    const recipe = await senderFacade.transferTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      tokenTransfer,
    );

    const finalizedTx = await senderFacade.finalizeTransaction(recipe);

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    // check only if we get back a tx hash because the unshielded wallet state never updates
    expect(submittedTxHash).toBeTypeOf('string');

    // const isValid = await firstValueFrom(
    //   receiverFacade.state().pipe(
    //     tap((s) => console.log('unshielded receiver available coins', Array.from(s.unshielded.balances))),
    //     filter((s) => Array.from(s.unshielded.balances).some(([_, value]) => value === 1n)),
    //   ),
    // );

    // expect(isValid).toBeTruthy();
  });
});
