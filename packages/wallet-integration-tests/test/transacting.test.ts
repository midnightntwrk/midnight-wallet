import { afterEach, describe } from '@jest/globals';
import { TokenTransfer } from '@midnight-ntwrk/wallet-api';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/abstractions';
import { Variant, WalletLike } from '@midnight-ntwrk/wallet-ts/abstractions';
import {
  DefaultRunningV1,
  DefaultV1Configuration,
  DefaultV1Variant,
  V1Builder,
  V1State,
  V1Tag,
} from '@midnight-ntwrk/wallet-ts/v1';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect } from 'effect';
import * as fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import prand from 'pure-rand';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';
import { outputsArbitrary, recipientArbitrary } from '../src/arbitraries';

const timeout = 120_000;

/**
 * These tests need to be fairly high-level to examine interfaces and observable behaviors given already built wallet.
 * For that reason - they mostly examine happy-path or well-known failure handling scenarios
 * It's the job of unit tests in various setups to perform quick and exhaustive testing
 */
describe('Wallet transacting', () => {
  const environmentId = randomUUID();
  let environment: StartedDockerComposeEnvironment | null = null;
  let configuration: DefaultV1Configuration | null = null;

  beforeAll(async () => {
    environment = await new DockerComposeEnvironment(
      path.resolve(new URL(import.meta.url).pathname, '../../../../typescript/packages/e2e-tests'),
      'docker-compose-dynamic.yml',
    )
      .withEnvironment({
        TESTCONTAINERS_UID: environmentId,
      })
      .up();

    configuration = {
      indexerWsUrl: `ws://localhost:${environment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v1/graphql/ws`,
      provingServerUrl: new URL(
        `http://localhost:${environment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      networkId: zswap.NetworkId.Undeployed,
    };
  }, timeout);

  afterAll(async () => {
    await environment?.down();
  });

  let Wallet: WalletLike.BaseWalletClass<[Variant.VersionedVariant<DefaultV1Variant>]>;
  let wallet: WalletLike.WalletLike<[Variant.VersionedVariant<DefaultV1Variant>]>;
  beforeEach(() => {
    Wallet = WalletBuilderTs.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new V1Builder().withDefaults())
      .build(configuration!);
    wallet = Wallet.startEmpty(Wallet);
  });

  afterEach(async () => {
    if (wallet != null) {
      await wallet.stop();
    }
  });

  it(
    'should create a successful transfer transaction',
    async () => {
      const syncedState: V1State = await rx.lastValueFrom(
        wallet.state.pipe(
          rx.map(ProtocolState.state),
          rx.skip(1),
          rx.takeWhile((state: V1State) => !state.progress.isComplete && state.state.coins.size > 0, true),
        ),
      );

      const balances: Record<string, bigint> = [...syncedState.state.coins].reduce(
        (acc: Record<string, bigint>, coin) => {
          return {
            ...acc,
            [coin.type]: acc[coin.type] === undefined ? coin.value : acc[coin.type] + coin.value,
          };
        },
        {},
      );

      const rawOutputs = outputsArbitrary(balances, configuration!.networkId, recipientArbitrary).generate(
        new fc.Random(prand.xoroshiro128plus(Date.now() ^ (Math.random() * 0x100000000))),
        undefined,
      ).value;
      const usedTokenTypes = new Set(rawOutputs.map((o) => o.type));

      const transaction: zswap.Transaction = await wallet.runtime
        .dispatch({
          [V1Tag]: (v1: DefaultRunningV1) => {
            const transferOutputs = rawOutputs.map(({ amount, type, receiverAddress }): TokenTransfer => {
              const address = new ShieldedAddress(
                new ShieldedCoinPublicKey(Buffer.from(receiverAddress.coinPublicKey, 'hex')),
                new ShieldedEncryptionPublicKey(Buffer.from(receiverAddress.encryptionPublicKey, 'hex')),
              );
              return {
                amount,
                type,
                receiverAddress: ShieldedAddress.codec.encode(configuration!.networkId, address).asString(),
              };
            });
            return v1
              .transferTransaction(transferOutputs)
              .pipe(Effect.flatMap((recipe) => v1.finalizeTransaction(recipe)));
          },
        })
        .pipe(Effect.flatten, Effect.runPromise);

      expect(transaction.guaranteedCoins!.outputs.length).toBeGreaterThanOrEqual(rawOutputs.length);
      usedTokenTypes.forEach((tokenType) => {
        const delta = transaction.guaranteedCoins!.deltas.get(tokenType);
        expect(delta == undefined || delta >= 0n).toBe(true);
      });
      rawOutputs.forEach((rawOutput) => {
        const appliedState = new zswap.LocalState().applyTx(rawOutput.receiverAddress, transaction, 'success');
        expect(Array.from(appliedState.coins)).toMatchObject([{ value: rawOutput.amount, type: rawOutput.type }]);
      });
    },
    timeout,
  );
});
