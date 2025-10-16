import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as path from 'node:path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed, getDustSeed } from './utils.js';
import { WalletBuilder, PublicKey, createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { CombinedTokenTransfer, WalletFacade } from '../src/index.js';
import { ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 60_000 });

/**
 * We need the dust wallet to transact
 */
describe('Wallet Facade Transfer', () => {
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

  it('allows to transfer shielded tokens only', async () => {
    await Promise.all([
      rx.firstValueFrom(
        senderFacade
          .state()
          .pipe(
            rx.filter(
              (s) =>
                s.shielded.state.progress.isStrictlyComplete() &&
                s.dust.state.progress.isStrictlyComplete() &&
                s.unshielded.syncProgress?.synced === true,
            ),
          ),
      ),
      rx.firstValueFrom(
        receiverFacade
          .state()
          .pipe(
            rx.filter(
              (s) =>
                s.shielded.state.progress.isStrictlyComplete() &&
                s.dust.state.progress.isStrictlyComplete() &&
                s.unshielded.syncProgress?.synced === true,
            ),
          ),
      ),
    ]);

    const ledgerReceiverAddress = ShieldedAddress.codec
      .encode(NetworkId.NetworkId.Undeployed, await receiverFacade.shielded.getAddress())
      .asString();

    const ttl = new Date();
    const transfer = await senderFacade.transferTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      [
        {
          type: 'shielded',
          outputs: [
            {
              type: ledger.shieldedToken().raw,
              receiverAddress: ledgerReceiverAddress,
              amount: 1n,
            },
          ],
        },
      ],
      ttl,
    );

    const finalizedTx = await senderFacade.finalizeTransaction(transfer);

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxHash).toBeTypeOf('string');

    const isValid = await rx.firstValueFrom(
      receiverFacade.state().pipe(rx.filter((s) => s.shielded.availableCoins.some((c) => c.coin.value === 1n))),
    );

    expect(isValid).toBeTruthy();
  });

  it('allows to transfer unshielded tokens', async () => {
    await Promise.all([
      rx.firstValueFrom(
        senderFacade
          .state()
          .pipe(
            rx.filter(
              (s) =>
                s.shielded.state.progress.isStrictlyComplete() &&
                s.dust.state.progress.isStrictlyComplete() &&
                s.unshielded.syncProgress?.synced === true,
            ),
          ),
      ),
      rx.firstValueFrom(
        receiverFacade
          .state()
          .pipe(
            rx.filter(
              (s) =>
                s.shielded.state.progress.isStrictlyComplete() &&
                s.dust.state.progress.isStrictlyComplete() &&
                s.unshielded.syncProgress?.synced === true,
            ),
          ),
      ),
    ]);

    const unshieldedReceiverState = await rx.firstValueFrom(receiverFacade.unshielded.state());

    const tokenTransfer: CombinedTokenTransfer[] = [
      {
        type: 'unshielded',
        outputs: [
          {
            amount: 1n,
            receiverAddress: unshieldedReceiverState.address,
            type: ledger.unshieldedToken().raw,
          },
        ],
      },
    ];

    const ttl = new Date(Date.now() + 30 * 60 * 1000);
    const recipe = await senderFacade.transferTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      tokenTransfer,
      ttl,
    );

    const signedTx = await senderFacade.signTransaction(
      recipe.transaction,
      async (payload) => await Promise.resolve(unshieldedSenderKeystore.signData(payload)),
    );

    const finalizedTx = await senderFacade.finalizeTransaction({
      ...recipe,
      transaction: signedTx,
    });

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxHash).toBeTruthy();

    const isValid = await rx.firstValueFrom(
      receiverFacade
        .state()
        .pipe(rx.filter((s) => Array.from(s.unshielded.balances).some(([_, value]) => value === 1n))),
    );

    expect(isValid).toBeTruthy();
  });

  it('allows to balance and submit an arbitrary shielded transaction', async () => {
    await Promise.all([
      rx.firstValueFrom(
        senderFacade
          .state()
          .pipe(
            rx.filter(
              (s) =>
                s.shielded.state.progress.isStrictlyComplete() &&
                s.dust.state.progress.isStrictlyComplete() &&
                s.unshielded.syncProgress?.synced === true,
            ),
          ),
      ),
    ]);

    const shieldedReceiverState = await rx.firstValueFrom(receiverFacade.shielded.state);

    const transfer = {
      type: ledger.shieldedToken().raw,
      amount: 1n,
    };

    const coin = ledger.createShieldedCoinInfo(transfer.type, transfer.amount);

    const output = ledger.ZswapOutput.new(
      coin,
      0,
      shieldedReceiverState.address.coinPublicKey.toHexString(),
      shieldedReceiverState.address.encryptionPublicKey.toHexString(),
    );

    const outputOffer = ledger.ZswapOffer.fromOutput(output, transfer.type, transfer.amount);

    const arbitraryTx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, outputOffer);

    const provenArbitrayTx = await senderFacade.shielded.finalizeTransaction({
      type: 'TransactionToProve',
      transaction: arbitraryTx,
    });

    const balancedTx = await senderFacade.balanceTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      provenArbitrayTx,
      new Date(Date.now() + 30 * 60 * 1000),
    );

    const finalizedTx = await senderFacade.finalizeTransaction(balancedTx);

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxHash).toBeTypeOf('string');

    const isValid = await rx.firstValueFrom(
      receiverFacade.state().pipe(rx.filter((s) => s.shielded.availableCoins.some((c) => c.coin.value === 1n))),
    );

    expect(isValid).toBeTruthy();
  });

  it('allows to balance and submit an arbitrary unshielded transaction', async () => {
    await Promise.all([
      rx.firstValueFrom(
        senderFacade
          .state()
          .pipe(
            rx.filter(
              (s) =>
                s.shielded.state.progress.isStrictlyComplete() &&
                s.dust.state.progress.isStrictlyComplete() &&
                s.unshielded.syncProgress?.synced === true,
            ),
          ),
      ),
    ]);

    const outputs = [
      {
        type: ledger.unshieldedToken().raw,
        value: 1n,
        owner: unshieldedReceiverKeystore.getAddress(),
      },
    ];

    const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], outputs, []);

    const arbitraryTx = ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, undefined, undefined, intent);

    const recipe = await senderFacade.balanceTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedSenderSeed),
      ledger.DustSecretKey.fromSeed(dustSenderSeed),
      arbitraryTx,
      new Date(Date.now() + 30 * 60 * 1000),
    );

    if (recipe.type !== 'TransactionToProve') {
      throw new Error('Expected a transaction to prove');
    }

    const signedTx = await senderFacade.signTransaction(
      recipe.transaction,
      async (payload) => await Promise.resolve(unshieldedSenderKeystore.signData(payload)),
    );

    const finalizedTx = await senderFacade.finalizeTransaction({
      ...recipe,
      transaction: signedTx,
    });

    const submittedTxHash = await senderFacade.submitTransaction(finalizedTx);

    expect(submittedTxHash).toBeTypeOf('string');

    const isValid = await rx.firstValueFrom(
      receiverFacade
        .state()
        .pipe(rx.filter((s) => Array.from(s.unshielded.balances).some(([_, value]) => value === 1n))),
    );

    expect(isValid).toBeTruthy();
  });
});
