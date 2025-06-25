import { afterEach, beforeEach, describe, it } from '@jest/globals';
import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolState, ProtocolVersion, Variant, WalletLike } from '@midnight-ntwrk/wallet-ts/abstractions';
import { DefaultV1Configuration, DefaultV1Variant, V1Builder, V1State } from '@midnight-ntwrk/wallet-ts/v1';
import { NetworkId } from '@midnight-ntwrk/zswap';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';

const timeout = 120_000;

describe('Wallet Sync', () => {
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
      networkId: NetworkId.Undeployed,
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
    'should resync an empty wallet',
    async () => {
      const syncedState: V1State = await rx.lastValueFrom(
        wallet.state.pipe(
          rx.map(ProtocolState.state),
          rx.takeWhile(() => !wallet.syncComplete, true),
        ),
      );
      const balances = [...syncedState.state.coins].reduce((acc: Record<string, bigint>, coin) => {
        return {
          ...acc,
          [coin.type]: acc[coin.type] === undefined ? coin.value : acc[coin.type] + coin.value,
        };
      }, {});

      expect(balances).toStrictEqual({
        '02000000000000000000000000000000000000000000000000000000000000000000': 25000000000000000n,
        '02000000000000000000000000000000000000000000000000000000000000000001': 5000000000000000n,
        '02000000000000000000000000000000000000000000000000000000000000000002': 5000000000000000n,
      });
    },
    timeout,
  );
});
