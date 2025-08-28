import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/abstractions';
import { TokenTransfer } from '@midnight-ntwrk/wallet-api';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletBuilder } from '@midnight-ntwrk/wallet-ts';
import { Variant, WalletLike } from '@midnight-ntwrk/wallet-ts/abstractions';
import {
  CoinsAndBalances,
  DefaultRunningV1,
  DefaultV1Configuration,
  DefaultV1Variant,
  Keys,
  V1Builder,
  V1State,
  V1Tag,
} from '@midnight-ntwrk/wallet-ts/v1';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, pipe } from 'effect';
import * as fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import prand from 'pure-rand';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { outputsArbitrary, recipientArbitrary, swapParamsArbitrary } from '../src/arbitraries';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 30_000 });

const random = new fc.Random(prand.xoroshiro128plus(Date.now() ^ (Math.random() * 0x100000000)));
const sampleValue = <T>(arbitrary: fc.Arbitrary<T>): T => {
  return arbitrary.generate(random, undefined).value;
};

const assertCloseTo = (actual: bigint, expected: bigint, delta: bigint, message: string = ''): void => {
  assert.isTrue(actual >= expected - delta, `Expected ${actual} to be within ${delta} from ${expected}: ${message}`);
  assert.isTrue(actual <= expected + delta, `Expected ${actual} to be within ${delta} from ${expected}: ${message}`);
};

/**
 * These tests need to be fairly high-level to examine interfaces and observable behaviors given already built wallet.
 * For that reason - they mostly examine happy-path or well-known failure handling scenarios
 * It's the job of unit tests in various setups to perform quick and exhaustive testing
 */
describe('Wallet transacting', () => {
  let environment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeEach(async () => {
    const environmentId = randomUUID();
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
      networkId: zswap.NetworkId.Undeployed,
      costParameters: {
        ledgerParams: zswap.LedgerParameters.dummyParameters(),
        additionalFeeOverhead: 50_000n,
      },
    };
  });

  afterEach(async () => {
    await environment?.down();
  });

  let Wallet: WalletLike.BaseWalletClass<[Variant.VersionedVariant<DefaultV1Variant>], DefaultV1Configuration>;
  type Wallet = WalletLike.WalletOf<typeof Wallet>;
  let wallet: Wallet;
  let wallet2: Wallet;
  let coinsAndBalances: CoinsAndBalances.CoinsAndBalancesCapability<V1State>;
  let keys: Keys.KeysCapability<V1State>;

  const getShieldedAddress = (state: V1State | zswap.SecretKeys): string => {
    const address =
      state instanceof zswap.SecretKeys
        ? new ShieldedAddress(
            ShieldedCoinPublicKey.fromHexString(state.coinPublicKey),
            ShieldedEncryptionPublicKey.fromHexString(state.encryptionPublicKey),
          )
        : keys!.getAddress(state);

    return ShieldedAddress.codec.encode(Wallet.configuration.networkId, address).asString();
  };

  const waitForSync = (wallet: Wallet): Promise<V1State> => {
    return pipe(
      wallet.rawState,
      rx.map(ProtocolState.state),
      rx.skip(1),
      rx.filter((state: V1State) => state.progress.isStrictlyComplete() && state.state.coins.size > 0),
      (a) => rx.firstValueFrom(a),
    );
  };

  const getCoinsAndBalances = (state: V1State) => {
    return {
      coins: coinsAndBalances.getAvailableCoins(state),
      balances: coinsAndBalances.getAvailableBalances(state),
    };
  };

  const getBalanceChange = (
    before: { balances: CoinsAndBalances.Balances },
    after: { balances: CoinsAndBalances.Balances },
    tokenType: zswap.TokenType,
  ): bigint => {
    const balanceBefore = before.balances[tokenType] ?? 0n;
    const balanceAfter = after.balances[tokenType] ?? 0n;
    return balanceAfter - balanceBefore;
  };

  beforeEach(() => {
    Wallet = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new V1Builder().withDefaults())
      .build(configuration);
    coinsAndBalances = Wallet.allVariantsRecord()[V1Tag].variant.coinsAndBalances;
    keys = Wallet.allVariantsRecord()[V1Tag].variant.keys;
    wallet = Wallet.startEmpty(Wallet);
    wallet2 = Wallet.startFirst(
      Wallet,
      V1State.initEmpty(
        zswap.SecretKeys.fromSeed(
          Buffer.from('0000000000000000000000000000000000000000000000000000000000000002', 'hex'),
        ),
        Wallet.configuration.networkId,
      ),
    );
  });

  afterEach(async () => {
    if (wallet != null) {
      await wallet.stop();
    }

    if (wallet2 != null) {
      await wallet2.stop();
    }
  });

  it('should create & submit successful transfers transactions', async () => {
    const syncedState: V1State = await pipe(
      wallet.rawState,
      rx.map(ProtocolState.state),
      rx.skip(1),
      rx.filter((state: V1State) => state.progress.isStrictlyComplete() && state.state.coins.size > 0),
      (a) => rx.firstValueFrom(a),
    );

    const balances: Record<string, bigint> = coinsAndBalances.getAvailableBalances(syncedState);

    const rawOutputs = sampleValue(outputsArbitrary(balances, configuration!.networkId, recipientArbitrary));
    const usedTokenTypes = new Set(rawOutputs.map((o) => o.type));

    const result = await wallet.runtime
      .dispatch({
        [V1Tag]: (v1: DefaultRunningV1) => {
          const transferOutputs = rawOutputs.map(({ amount, type, receiverAddress }): TokenTransfer => {
            return {
              amount,
              type,
              receiverAddress: getShieldedAddress(receiverAddress),
            };
          });
          return v1.transferTransaction(transferOutputs).pipe(
            Effect.flatMap((recipe) => v1.finalizeTransaction(recipe)),
            Effect.flatMap((tx) =>
              Effect.all({
                transaction: Effect.succeed(tx),
                submissionResult: v1.submitTransaction(tx, 'Finalized'),
              }),
            ),
          );
        },
      })
      .pipe(Effect.runPromise);

    const transaction = result.transaction;
    expect(transaction.guaranteedCoins!.outputs.length).toBeGreaterThanOrEqual(rawOutputs.length);
    usedTokenTypes.forEach((tokenType) => {
      const delta = transaction.guaranteedCoins!.deltas.get(tokenType);
      expect(delta == undefined || delta >= 0n).toBe(true);
    });
    rawOutputs.forEach((rawOutput) => {
      const appliedState = new zswap.LocalState().applyTx(rawOutput.receiverAddress, transaction, 'success');
      expect(Array.from(appliedState.coins)).toMatchObject([{ value: rawOutput.amount, type: rawOutput.type }]);
    });
    expect(result.submissionResult._tag).toBe('Finalized');
  });

  it('should create and submit a transfer, which is properly received', async () => {
    await rx.firstValueFrom(
      wallet.rawState.pipe(
        rx.map(ProtocolState.state),
        rx.skip(1),
        rx.filter((state: V1State) => state.state.coins.size > 0),
      ),
    );
    const receiverState = await pipe(wallet2.rawState, rx.map(ProtocolState.state), (s) => rx.firstValueFrom(s));

    await wallet.runtime
      .dispatch({
        [V1Tag]: (v1) =>
          v1
            .transferTransaction([
              {
                type: zswap.nativeToken(),
                amount: 42n,
                receiverAddress: getShieldedAddress(receiverState),
              },
            ])
            .pipe(
              Effect.flatMap((recipe) => v1.finalizeTransaction(recipe)),
              Effect.flatMap((tx) => v1.submitTransaction(tx, 'Finalized')),
            ),
      })
      .pipe(Effect.runPromise);

    const finalBalance = await pipe(
      wallet2.rawState,
      rx.skip(1),
      rx.map(ProtocolState.state),
      rx.filter((state) => state.progress.isStrictlyComplete()),
      rx.map((state) => coinsAndBalances.getAvailableBalances(state)[zswap.nativeToken()]),
      (a) => rx.firstValueFrom(a),
    );

    expect(finalBalance).toEqual(25000000000000000n + 42n); //initial balance + transferred 42
  });

  it('should init a swap, which could be successfully balanced with other wallet and submitted', async () => {
    const syncedState1: V1State = await waitForSync(wallet);
    const syncedState2 = await waitForSync(wallet2);
    const balances = coinsAndBalances.getAvailableBalances(syncedState1);

    const swapParams = sampleValue(swapParamsArbitrary(balances, getShieldedAddress(syncedState1)));

    const finalTx = await wallet.runtime
      .dispatch({
        [V1Tag]: (v1) =>
          pipe(
            v1.initSwap(swapParams.inputs, swapParams.outputs),
            Effect.andThen((recipe) => v1.finalizeTransaction(recipe)),
          ),
      })
      .pipe(
        Effect.andThen((tx) => {
          return wallet2.runtime.dispatch({
            [V1Tag]: (v1) =>
              pipe(
                v1.balanceTransaction(tx, []),
                Effect.andThen((recipe) => v1.finalizeTransaction(recipe)),
                Effect.tap((tx) => v1.submitTransaction(tx, 'Finalized')),
              ),
          });
        }),
        Effect.runPromise,
      );

    // This is a bit of an overestimation, but given various decisions that can be made in the balancing process,
    // it's a good enough range to test against
    // adding overhead for each output because balancing won't create a change output if it does not make sense
    const dustReserve =
      finalTx.fees(Wallet.configuration.costParameters.ledgerParams) +
      BigInt(finalTx.guaranteedCoins!.inputs.length) *
        (Wallet.configuration.costParameters.additionalFeeOverhead +
          Wallet.configuration.costParameters.ledgerParams.transactionCostModel.inputFeeOverhead) +
      BigInt(
        finalTx.guaranteedCoins!.outputs.length +
          (swapParams.outputs.length + Object.keys(swapParams.inputs).length) * 2,
      ) *
        (Wallet.configuration.costParameters.additionalFeeOverhead +
          Wallet.configuration.costParameters.ledgerParams.transactionCostModel.outputFeeOverhead);
    const stateAfter1 = await waitForSync(wallet);
    const stateAfter2 = await waitForSync(wallet2);

    const cABefore1 = getCoinsAndBalances(syncedState1);
    const cABefore2 = getCoinsAndBalances(syncedState2);
    const cAAfter1 = getCoinsAndBalances(stateAfter1);
    const cAAfter2 = getCoinsAndBalances(stateAfter2);

    Object.entries(swapParams.inputs).forEach(([type, value]) => {
      const change1 = getBalanceChange(cABefore1, cAAfter1, type);
      const change2 = getBalanceChange(cABefore2, cAAfter2, type);

      const acceptedDelta = type == zswap.nativeToken() ? dustReserve : 0n;

      assertCloseTo(change1, value * -1n, acceptedDelta, `Expected wallet 1 to provide ${value}`);
      assertCloseTo(change2, value, acceptedDelta, `Expected wallet 2 to receive ${value}`);
    });

    swapParams.outputs.forEach((output) => {
      const change1 = getBalanceChange(cABefore1, cAAfter1, output.type);
      const change2 = getBalanceChange(cABefore2, cAAfter2, output.type);

      const acceptedDelta = output.type == zswap.nativeToken() ? dustReserve : 0n;

      assertCloseTo(change1, output.amount, acceptedDelta, `Expected wallet 1 to receive ${output.amount}`);
      assertCloseTo(change2, output.amount * -1n, acceptedDelta, `Expected wallet 2 to provide ${output.amount}`);
    });

    expect(finalTx.guaranteedCoins!.deltas.get(zswap.nativeToken())).toBeGreaterThanOrEqual(
      finalTx.fees(Wallet.configuration.costParameters.ledgerParams),
    );
    expect(finalTx.guaranteedCoins!.deltas.get(zswap.nativeToken())).toBeLessThanOrEqual(dustReserve);
  });
});
