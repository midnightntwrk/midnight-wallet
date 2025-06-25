import { afterEach, describe } from '@jest/globals';
import {
  BALANCE_TRANSACTION_TO_PROVE,
  NOTHING_TO_PROVE,
  ProvingRecipe,
  TokenTransfer,
  TRANSACTION_TO_PROVE,
} from '@midnight-ntwrk/wallet-api';
import { ShieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolState, ProtocolVersion, Variant, WalletLike } from '@midnight-ntwrk/wallet-ts/abstractions';
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
import { outputsArbitrary, recipientArbitrary, shieldedAddressArbitrary } from '../src/arbitraries';

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

      const outputs: ReadonlyArray<TokenTransfer> = outputsArbitrary(
        balances,
        configuration!.networkId,
        shieldedAddressArbitrary(recipientArbitrary).map((address) =>
          ShieldedAddress.codec.encode(configuration!.networkId, address).asString(),
        ),
      ).generate(new fc.Random(prand.xoroshiro128plus(Date.now() ^ (Math.random() * 0x100000000))), undefined).value;
      const usedTokenTypes = new Set(outputs.map((o) => o.type));

      const recipe: ProvingRecipe = await wallet.runtime
        .dispatch({
          [V1Tag]: (v1: DefaultRunningV1) => v1.transferTransaction(outputs),
        })
        .pipe(Effect.flatten, Effect.runPromise);

      switch (recipe.type) {
        case BALANCE_TRANSACTION_TO_PROVE:
        case NOTHING_TO_PROVE:
          expect(recipe.type).toEqual(TRANSACTION_TO_PROVE);
          break;
        case TRANSACTION_TO_PROVE:
          expect(recipe.transaction.guaranteedCoins!.outputs.length).toBeGreaterThanOrEqual(outputs.length);
          usedTokenTypes.forEach((tokenType) => {
            const delta = recipe.transaction.guaranteedCoins!.deltas.get(tokenType);
            expect(delta == undefined || delta >= 0n).toBe(true);
          });
          break;
      }
      expect.hasAssertions();
    },
    timeout,
  );
});
