import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/abstractions';
import { Variant, WalletLike } from '@midnight-ntwrk/wallet-ts/abstractions';
import { DefaultV1Configuration, DefaultV1Variant, V1Builder, V1State, V1Tag } from '@midnight-ntwrk/wallet-ts/v1';
import { NetworkId } from '@midnight-ntwrk/zswap';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';

import os from 'node:os';
import * as zswap from '@midnight-ntwrk/zswap';
import { pipe } from 'effect';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 30_000 });

describe('Wallet Sync', () => {
  const environmentId = randomUUID();
  let environment: StartedDockerComposeEnvironment | null = null;
  let configuration: DefaultV1Configuration | null = null;

  beforeAll(async () => {
    environment = await new DockerComposeEnvironment(
      path.resolve(new URL(import.meta.url).pathname, '../../../../packages/e2e-tests'),
      'docker-compose-dynamic.yml',
    )
      .withEnvironment({
        TESTCONTAINERS_UID: environmentId,
        RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
      })
      .up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${environment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v1/graphql`,
      },
      provingServerUrl: new URL(
        `http://localhost:${environment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      relayURL: new URL(`ws://127.0.0.1:${environment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`),
      networkId: NetworkId.Undeployed,
      costParameters: {
        ledgerParams: zswap.LedgerParameters.dummyParameters(),
        additionalFeeOverhead: 50_000n,
      },
    };
  });

  afterAll(async () => {
    await environment?.down({ timeout: 10_000 });
  });

  let Wallet: WalletLike.BaseWalletClass<[Variant.VersionedVariant<DefaultV1Variant>]>;
  let wallet: WalletLike.WalletLike<[Variant.VersionedVariant<DefaultV1Variant>]>;
  type Wallet = WalletLike.WalletOf<typeof Wallet>;

  const waitForSync = (wallet: Wallet): Promise<V1State> => {
    return pipe(
      wallet.rawState,
      rx.map(ProtocolState.state),
      rx.skip(1),
      rx.filter((state: V1State) => state.progress.isStrictlyComplete && state.state.coins.size > 0),
      (a) => rx.firstValueFrom(a),
    );
  };

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

  it('should resync an empty wallet', async () => {
    const syncedState = await waitForSync(wallet);

    const coinsAndBalancesCapability = Wallet.allVariantsRecord()[V1Tag].variant.coinsAndBalances;
    const balances = coinsAndBalancesCapability.getTotalBalances(syncedState);

    expect(balances).toStrictEqual({
      '02000000000000000000000000000000000000000000000000000000000000000000': 25000000000000000n,
      '02000000000000000000000000000000000000000000000000000000000000000001': 5000000000000000n,
      '02000000000000000000000000000000000000000000000000000000000000000002': 5000000000000000n,
    });
  });
});
