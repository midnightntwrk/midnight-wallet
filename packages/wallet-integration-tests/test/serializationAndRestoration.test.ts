import { afterEach, beforeEach, describe, it } from '@jest/globals';
import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolState, ProtocolVersion, Variant, WalletLike } from '@midnight-ntwrk/wallet-ts/abstractions';
import { V1Builder, V1Configuration, V1State, V1Tag, V1Variant } from '@midnight-ntwrk/wallet-ts/v1';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Either } from 'effect';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';

const timeout = 120_000;

describe('Wallet serialization and restoration', () => {
  const environmentId = randomUUID();
  let environment: StartedDockerComposeEnvironment | null = null;
  let configuration: V1Configuration | null = null;

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
      networkId: zswap.NetworkId.Undeployed,
    };
  }, timeout);

  afterAll(async () => {
    await environment?.down();
  });

  let Wallet: WalletLike.BaseWalletClass<[Variant.VersionedVariant<V1Variant<string>>]>;
  let wallet: WalletLike.WalletLike<[Variant.VersionedVariant<V1Variant<string>>]>;
  beforeEach(() => {
    Wallet = WalletBuilderTs.init()
      .withVariant(
        ProtocolVersion.MinSupportedVersion,
        new V1Builder().withSyncDefaults().withTransactingDefaults().withSerializationDefaults(),
      )
      .build(configuration!);
    wallet = Wallet.startEmpty(Wallet);
  });

  afterEach(async () => {
    if (wallet != null) {
      await wallet.stop();
    }
  });

  const getBalances = (state: V1State): Record<zswap.TokenType, bigint> => {
    return [...state.state.coins].reduce((acc: Record<zswap.TokenType, bigint>, coin) => {
      return {
        ...acc,
        [coin.type]: acc[coin.type] === undefined ? coin.value : acc[coin.type] + coin.value,
      };
    }, {});
  };

  it(
    'allows to restart wallet from the serialized state',
    async () => {
      const syncedState: V1State = await rx.lastValueFrom(
        wallet.state.pipe(
          rx.map(ProtocolState.state),
          rx.takeWhile(() => !wallet.syncComplete, true),
        ),
      );
      const keys = syncedState.secretKeys;
      const originalBalances = getBalances(syncedState);
      const serializedState = await wallet.runtime
        .dispatch({
          [V1Tag]: (runningV1) => {
            return runningV1.serializeState(syncedState);
          },
        })
        .pipe(Effect.runPromise);
      const restoredWalletState: V1State = Wallet.allVariantsRecord()
        [V1Tag].variant.deserializeState(keys, serializedState)
        .pipe(Either.getOrThrow);
      const restoredBalances = await Effect.acquireRelease(
        Effect.sync(() => Wallet.start(Wallet, V1Tag, restoredWalletState)),
        (wallet) => Effect.promise(() => wallet.stop()),
      ).pipe(
        Effect.flatMap((wallet) => Effect.promise(() => rx.firstValueFrom(wallet.state))),
        Effect.map(ProtocolState.state),
        Effect.map(getBalances),
        Effect.scoped,
        Effect.runPromise,
      );

      expect(restoredBalances).toEqual(originalBalances);
    },
    timeout,
  );
});
