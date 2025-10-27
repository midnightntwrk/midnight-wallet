import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DefaultV1Configuration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import * as path from 'node:path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShieldedSeed, getUnshieldedSeed, getDustSeed, waitForFullySynced } from './utils.js';
import { WalletBuilder, PublicKey, createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as rx from 'rxjs';
import { WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 60_000 });

describe('Dust Deregistration', () => {
  const environmentId = randomUUID();

  const shieldedWalletSeed = getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');

  const unshieldedWalletSeed = getUnshieldedSeed('0000000000000000000000000000000000000000000000000000000000000002');

  const dustWalletSeed = getDustSeed('0000000000000000000000000000000000000000000000000000000000000002');

  const unshieldedWalletKeystore = createKeystore(unshieldedWalletSeed, NetworkId.NetworkId.Undeployed);

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

  let walletFacade: WalletFacade;

  beforeEach(async () => {
    const Shielded = ShieldedWallet(configuration);
    const shieldedWallet = Shielded.startWithShieldedSeed(shieldedWalletSeed);

    const Dust = DustWallet({
      ...configuration,
      costParameters: {
        additionalFeeOverhead: 300_000_000_000_000n,
        feeBlocksMargin: 5,
      },
    });
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;
    const dustWallet = Dust.startWithSeed(dustWalletSeed, dustParameters, NetworkId.NetworkId.Undeployed);

    const unshieldedWallet = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedWalletKeystore),
      networkId: NetworkId.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
    });

    walletFacade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);

    await walletFacade.start(
      ledger.ZswapSecretKeys.fromSeed(shieldedWalletSeed),
      ledger.DustSecretKey.fromSeed(dustWalletSeed),
    );
  });

  afterEach(async () => {
    await walletFacade.stop();
  });

  it('deregisters from dust generation', async () => {
    // NOTE: by default our test account is already registered for Dust generation
    await waitForFullySynced(walletFacade);

    const walletStateWithNight = await rx.firstValueFrom(
      walletFacade.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0)),
    );

    const availableCoins = walletStateWithNight.dust.availableCoinsWithFullInfo(new Date());
    expect(availableCoins.every((availableCoins) => availableCoins.dtime === undefined)).toBeTruthy();

    const nightUtxos = walletStateWithNight.unshielded.availableCoins.filter(
      (coin) => coin.registeredForDustGeneration === true,
    );

    const deregisterTokens = 2;
    const dustDeregistrationRecipe = await walletFacade.deregisterFromDustGeneration(
      nightUtxos.slice(0, deregisterTokens),
      unshieldedWalletKeystore.getPublicKey(),
      (payload) => unshieldedWalletKeystore.signData(payload),
    );

    const balancedTransactionRecipe = await walletFacade.balanceTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedWalletSeed),
      ledger.DustSecretKey.fromSeed(dustWalletSeed),
      dustDeregistrationRecipe.transaction,
      new Date(Date.now() + 30 * 60 * 1000),
    );

    if (balancedTransactionRecipe.type !== 'TransactionToProve') {
      throw new Error('Expected a transaction to prove');
    }

    // NOTE: we don't sign the transaction via "walletFacade.signTransaction" as
    // the (de)registerFromDustGeneration method already adds the required signatures
    const finalizedDustTx = await walletFacade.finalizeTransaction(balancedTransactionRecipe);
    const dustDeregistrationTxHash = await walletFacade.submitTransaction(finalizedDustTx);

    expect(dustDeregistrationTxHash).toBeTypeOf('string');

    const newWalletState = await rx.firstValueFrom(
      walletFacade
        .state()
        .pipe(rx.filter((s) => s.unshielded.availableCoins.some((coin) => coin.registeredForDustGeneration === false))),
    );

    const availableCoinsWithInfo = newWalletState.dust.availableCoinsWithFullInfo(new Date());
    expect(availableCoinsWithInfo.filter((coin) => coin.dtime !== undefined).length).toBe(deregisterTokens);
  });
});
