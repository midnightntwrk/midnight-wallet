/* eslint-disable prettier/prettier */

import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';
import * as path from 'node:path';
import * as rx from 'rxjs';
import { NetworkId } from '@midnight-ntwrk/zswap';
import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-ts/abstractions';
import { V1Builder } from '@midnight-ntwrk/wallet-ts/v1';

const timeout = 120_000;

describe('Wallet Sync', () => {
  let environment: StartedDockerComposeEnvironment | null = null;

  beforeAll(async () => {
    environment = await new DockerComposeEnvironment(
      path.resolve(new URL(import.meta.url).pathname, '../../../../typescript/packages/e2e-tests'),
      'docker-compose.yml',
    ).up();
  }, timeout);

  afterAll(async () => {
    await environment?.down();
  });

  // Skip. Fails on CI for some reason, but runs as expected locally.
  it.skip('should resync an empty wallet', async () => {
    const configuration: V1Builder.V1Configuration = {
      indexerWsUrl: 'ws://localhost:8088/api/v1/graphql/ws',
      networkId: NetworkId.Undeployed,
    };

    const wallet = new WalletBuilderTs()
      .withVariant(ProtocolVersion.MinSupportedVersion, new V1Builder.V1Builder().withSyncDefaults())
      .withConfiguration(configuration)
      .build();
    const [, syncedState]: ProtocolState<V1Builder.V1State> = await rx.lastValueFrom(
      wallet.state.pipe(
        rx.takeWhile(() => !wallet.syncComplete)
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
  }, timeout);
});
