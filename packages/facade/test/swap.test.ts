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
import { CombinedSwapInputs, CombinedSwapOutputs, WalletFacade } from '../src/index.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 120_000 });

describe('Swaps', () => {
  const environmentId = randomUUID();

  const walletASeed = '0000000000000000000000000000000000000000000000000000000000000002';
  const walletBSeed = '0000000000000000000000000000000000000000000000000000000000000001';

  const shieldedWalletASeed = getShieldedSeed(walletASeed);
  const shieldedWalletBSeed = getShieldedSeed(walletBSeed);

  const unshieldedWalletASeed = getUnshieldedSeed(walletASeed);
  const unshieldedWalletBSeed = getUnshieldedSeed(walletBSeed);

  const dustWalletASeed = getDustSeed(walletASeed);
  const dustWalletBSeed = getDustSeed(walletBSeed);

  const unshieldedWalletAKeystore = createKeystore(unshieldedWalletASeed, NetworkId.NetworkId.Undeployed);
  const unshieldedWalletBKeystore = createKeystore(unshieldedWalletBSeed, NetworkId.NetworkId.Undeployed);

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

  let walletAFacade: WalletFacade;
  let walletBFacade: WalletFacade;

  beforeEach(async () => {
    const Shielded = ShieldedWallet(configuration);
    const shieldedWalletA = Shielded.startWithShieldedSeed(shieldedWalletASeed);
    const shieldedWalletB = Shielded.startWithShieldedSeed(shieldedWalletBSeed);

    const Dust = DustWallet({
      ...configuration,
      costParameters: {
        additionalFeeOverhead: 900_000_000_000_000n,
        feeBlocksMargin: 5,
      },
    });
    const dustParameters = ledger.LedgerParameters.initialParameters().dust;
    const dustWalletA = Dust.startWithSeed(dustWalletASeed, dustParameters, NetworkId.NetworkId.Undeployed);
    const dustWalletB = Dust.startWithSeed(dustWalletBSeed, dustParameters, NetworkId.NetworkId.Undeployed);

    const unshieldedWalletA = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedWalletAKeystore),
      networkId: NetworkId.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
    });

    const unshieldedWalletB = await WalletBuilder.build({
      publicKey: PublicKey.fromKeyStore(unshieldedWalletBKeystore),
      networkId: NetworkId.NetworkId.Undeployed,
      indexerUrl: configuration.indexerClientConnection.indexerWsUrl!,
    });

    walletAFacade = new WalletFacade(shieldedWalletA, unshieldedWalletA, dustWalletA);
    walletBFacade = new WalletFacade(shieldedWalletB, unshieldedWalletB, dustWalletB);

    await Promise.all([
      walletAFacade.start(
        ledger.ZswapSecretKeys.fromSeed(shieldedWalletASeed),
        ledger.DustSecretKey.fromSeed(dustWalletASeed),
      ),
      walletBFacade.start(
        ledger.ZswapSecretKeys.fromSeed(shieldedWalletBSeed),
        ledger.DustSecretKey.fromSeed(dustWalletBSeed),
      ),
    ]);
  });

  afterEach(async () => {
    await Promise.all([walletAFacade.stop(), walletBFacade.stop()]);
  });

  it('can perform a shielded swap', async () => {
    await Promise.all([waitForFullySynced(walletAFacade), waitForFullySynced(walletBFacade)]);

    const { shielded: walletAShieldedStateBefore } = await rx.firstValueFrom(walletAFacade.state());
    const { shielded: walletBShieldedStateBefore } = await rx.firstValueFrom(walletBFacade.state());

    const nativeShieldedTokenType = '0000000000000000000000000000000000000000000000000000000000000002';
    const nativeShieldedTokenAmount = tokenValue(10n);

    const shieldedTokenType = ledger.shieldedToken().raw;
    const shieldedTokenAmount = tokenValue(10n);

    const ttl = new Date(Date.now() + 60 * 60 * 1000);

    const shieldedWalletAAddress = ShieldedAddress.codec
      .encode(NetworkId.NetworkId.Undeployed, await walletAFacade.shielded.getAddress())
      .asString();

    const desiredInputs: CombinedSwapInputs = {
      shielded: {
        [shieldedTokenType]: shieldedTokenAmount,
      },
    };

    const desiredOutputs: CombinedSwapOutputs[] = [
      {
        type: 'shielded',
        outputs: [
          {
            type: nativeShieldedTokenType,
            amount: nativeShieldedTokenAmount,
            receiverAddress: shieldedWalletAAddress,
          },
        ],
      },
    ];

    const swapTx = await walletAFacade.initSwap(
      ledger.ZswapSecretKeys.fromSeed(shieldedWalletASeed),
      desiredInputs,
      desiredOutputs,
      ttl,
    );

    const finalizedSwapTx = await walletAFacade.finalizeTransaction({
      type: 'TransactionToProve',
      transaction: swapTx,
    });

    // assuming the tx is submitted to a dex pool and another wallet (wallet B) picks it up

    const walletBBalancedTx = await walletBFacade.balanceTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedWalletBSeed),
      ledger.DustSecretKey.fromSeed(dustWalletBSeed),
      finalizedSwapTx,
      new Date(Date.now() + 60 * 60 * 1000),
    );

    const finalizedTx = await walletBFacade.finalizeTransaction(walletBBalancedTx);

    const txHash = await walletBFacade.submitTransaction(finalizedTx);

    expect(txHash).toBeTypeOf('string');

    await Promise.all([
      rx.firstValueFrom(walletAFacade.state().pipe(rx.filter(({ shielded }) => shielded.pendingCoins.length === 0))),
      rx.firstValueFrom(walletBFacade.state().pipe(rx.filter(({ shielded }) => shielded.pendingCoins.length === 0))),
    ]);

    const { shielded: walletAShieldedStateAfter } = await rx.firstValueFrom(walletAFacade.state());
    const { shielded: walletBShieldedStateAfter } = await rx.firstValueFrom(walletBFacade.state());

    expect(walletAShieldedStateAfter.balances[shieldedTokenType]).toBe(
      walletAShieldedStateBefore.balances[shieldedTokenType] - shieldedTokenAmount,
    );
    expect(walletAShieldedStateAfter.balances[nativeShieldedTokenType]).toBe(
      walletAShieldedStateBefore.balances[nativeShieldedTokenType] + nativeShieldedTokenAmount,
    );

    expect(walletBShieldedStateAfter.balances[shieldedTokenType]).toBe(
      walletBShieldedStateBefore.balances[shieldedTokenType] + shieldedTokenAmount,
    );
    expect(walletBShieldedStateAfter.balances[nativeShieldedTokenType]).toBe(
      walletBShieldedStateBefore.balances[nativeShieldedTokenType] - nativeShieldedTokenAmount,
    );
  });

  /**
   * Disabled due to error validating Transaction: FeeCalculation(OutsideTimeToDismiss { time_to_dismiss: 15.494ms, allowed_time_to_dismiss: 15.000ms, size: 4601 })
   * We'll likely need to allow user to set payments in the fallible section of the transaction in order to avoid the issue above
   */
  it.skip('can perform an unshielded swap', async () => {
    await Promise.all([waitForFullySynced(walletAFacade), waitForFullySynced(walletBFacade)]);

    const ttl = new Date(Date.now() + 60 * 60 * 1000);

    const { unshielded: walletAUnshieldedStateBefore } = await rx.firstValueFrom(walletAFacade.state());
    const { unshielded: walletBUnshieldedStateBefore } = await rx.firstValueFrom(walletBFacade.state());

    const unshieldedTokenType = ledger.unshieldedToken().raw;
    const swapAmount = 1n;
    const swapForAmount = 2n;

    const desiredInputs: CombinedSwapInputs = {
      unshielded: {
        [unshieldedTokenType]: swapAmount,
      },
    };

    const desiredOutputs: CombinedSwapOutputs[] = [
      {
        type: 'unshielded',
        outputs: [
          {
            type: unshieldedTokenType,
            amount: swapForAmount,
            receiverAddress: walletAUnshieldedStateBefore.address,
          },
        ],
      },
    ];

    const swapTx = await walletAFacade.initSwap(
      ledger.ZswapSecretKeys.fromSeed(shieldedWalletASeed),
      desiredInputs,
      desiredOutputs,
      ttl,
    );

    const signedSwapTx = await walletAFacade.signTransaction(swapTx, (payload) => {
      return unshieldedWalletAKeystore.signData(payload);
    });

    // assuming the tx is added to a pool and wallet B picks it up

    const walletBBalancedTx = await walletBFacade.balanceTransaction(
      ledger.ZswapSecretKeys.fromSeed(shieldedWalletBSeed),
      ledger.DustSecretKey.fromSeed(dustWalletBSeed),
      signedSwapTx,
      ttl,
    );

    if (walletBBalancedTx.type !== 'TransactionToProve') {
      throw new Error('Expected TransactionToProve');
    }

    const walletBSignedTx = await walletBFacade.signTransaction(walletBBalancedTx.transaction, (payload) => {
      return unshieldedWalletBKeystore.signData(payload);
    });

    const finalizedTx = await walletBFacade.finalizeTransaction({
      ...walletBBalancedTx,
      transaction: walletBSignedTx,
    });

    const txHash = await walletAFacade.submitTransaction(finalizedTx);

    expect(txHash).toBeTypeOf('string');

    await Promise.all([
      rx.firstValueFrom(
        walletAFacade.state().pipe(rx.filter(({ unshielded }) => unshielded.pendingCoins.length === 0)),
      ),
      rx.firstValueFrom(
        walletBFacade.state().pipe(rx.filter(({ unshielded }) => unshielded.pendingCoins.length === 0)),
      ),
    ]);

    const { unshielded: walletAUnshieldedStateAfter } = await rx.firstValueFrom(walletAFacade.state());
    const { unshielded: walletBUnshieldedStateAfter } = await rx.firstValueFrom(walletBFacade.state());

    expect(walletAUnshieldedStateAfter.balances.get(unshieldedTokenType)).toBe(
      walletAUnshieldedStateBefore.balances.get(unshieldedTokenType)! - swapAmount + swapForAmount,
    );

    expect(walletBUnshieldedStateAfter.balances.get(unshieldedTokenType)).toBe(
      walletBUnshieldedStateBefore.balances.get(unshieldedTokenType)! + swapAmount - swapForAmount,
    );
  });

  it.skip('can perform a combined shielded and unshielded swap', () => {
    throw new Error('Not supported yet. Will be implemented in future PR.');
  });
});
