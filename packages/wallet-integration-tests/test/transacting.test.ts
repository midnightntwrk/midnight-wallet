// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { NetworkId, ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';
import { Variant, WalletLike } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import {
  CoinsAndBalances,
  DefaultRunningV1,
  DefaultV1Configuration,
  DefaultV1Variant,
  Keys,
  V1Builder,
  CoreWallet,
  V1Tag,
  Transacting,
} from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Effect, pipe } from 'effect';
import * as fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import prand from 'pure-rand';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import * as rx from 'rxjs';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment } from 'testcontainers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outputsArbitrary, recipientArbitrary, swapParamsArbitrary } from '../src/arbitraries.js';
import { getShieldedSeed } from './utils.js';

type TokenTransfer = Transacting.TokenTransfer;

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

const random = new fc.Random(prand.xoroshiro128plus(Date.now() ^ (Math.random() * 0x100000000)));
const sampleValue = <T>(arbitrary: fc.Arbitrary<T>): T => {
  return arbitrary.generate(random, undefined).value;
};

const shieldedTokenType = (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw;

/**
 * These tests need to be fairly high-level to examine interfaces and observable behaviors given already built wallet.
 * For that reason - they mostly examine happy-path or well-known failure handling scenarios
 * It's the job of unit tests in various setups to perform quick and exhaustive testing
 *
 * NOTE: Shielded wallet cannot transact on its own anymore, so these tests are skipped for now
 */
describe.skip('Wallet transacting', () => {
  let startedEnvironment: StartedDockerComposeEnvironment;
  let configuration: DefaultV1Configuration;

  beforeEach(async () => {
    const environmentId = randomUUID();

    const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
      additionalVars: {
        TESTCONTAINERS_UID: environmentId,
        RAYON_NUM_THREADS: Math.min(os.availableParallelism(), 32).toString(10),
      },
    });

    const environment = new DockerComposeEnvironment(
      getComposeDirectory(),
      'docker-compose-dynamic.yml',
    ).withEnvironment(environmentVars);

    startedEnvironment = await environment.up();

    configuration = {
      indexerClientConnection: {
        indexerHttpUrl: `http://localhost:${startedEnvironment.getContainer(`indexer_${environmentId}`).getMappedPort(8088)}/api/v3/graphql`,
      },
      provingServerUrl: new URL(
        `http://localhost:${startedEnvironment.getContainer(`proof-server_${environmentId}`).getMappedPort(6300)}`,
      ),
      relayURL: new URL(
        `ws://127.0.0.1:${startedEnvironment.getContainer(`node_${environmentId}`).getMappedPort(9944)}`,
      ),
      networkId: NetworkId.NetworkId.Undeployed,
    };
  });

  afterEach(async () => {
    await startedEnvironment?.down();
  });

  let Wallet: WalletLike.BaseWalletClass<[Variant.VersionedVariant<DefaultV1Variant>], DefaultV1Configuration>;
  type Wallet = WalletLike.WalletOf<typeof Wallet>;
  let walletKeys: ledger.ZswapSecretKeys;
  let wallet2Keys: ledger.ZswapSecretKeys;
  let wallet: Wallet;
  let wallet2: Wallet;
  let coinsAndBalances: CoinsAndBalances.CoinsAndBalancesCapability<CoreWallet>;
  let keys: Keys.KeysCapability<CoreWallet>;

  const getShieldedAddress = (state: CoreWallet | ledger.ZswapSecretKeys): string => {
    const address =
      state instanceof ledger.ZswapSecretKeys
        ? new ShieldedAddress(
            ShieldedCoinPublicKey.fromHexString(state.coinPublicKey),
            ShieldedEncryptionPublicKey.fromHexString(state.encryptionPublicKey),
          )
        : keys!.getAddress(state);

    return ShieldedAddress.codec.encode(Wallet.configuration.networkId, address).asString();
  };

  const waitForSync = (wallet: Wallet): Promise<CoreWallet> => {
    return pipe(
      wallet.rawState,
      rx.map(ProtocolState.state),
      rx.skip(1),
      rx.filter((state: CoreWallet) => state.progress.isStrictlyComplete() && state.state.coins.size > 0),
      (a) => rx.firstValueFrom(a),
    );
  };

  const getCoinsAndBalances = (state: CoreWallet) => {
    return {
      coins: coinsAndBalances.getAvailableCoins(state),
      balances: coinsAndBalances.getAvailableBalances(state),
    };
  };

  const getBalanceChange = (
    before: { balances: CoinsAndBalances.Balances },
    after: { balances: CoinsAndBalances.Balances },
    tokenType: ledger.RawTokenType,
  ): bigint => {
    const balanceBefore = before.balances[tokenType] ?? 0n;
    const balanceAfter = after.balances[tokenType] ?? 0n;
    return balanceAfter - balanceBefore;
  };

  beforeEach(async () => {
    Wallet = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new V1Builder().withDefaults())
      .build(configuration);
    coinsAndBalances = Wallet.allVariantsRecord()[V1Tag].variant.coinsAndBalances;
    keys = Wallet.allVariantsRecord()[V1Tag].variant.keys;
    walletKeys = ledger.ZswapSecretKeys.fromSeed(
      getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000001'),
    );
    wallet = Wallet.startFirst(Wallet, CoreWallet.initEmpty(walletKeys, Wallet.configuration.networkId));
    wallet2Keys = ledger.ZswapSecretKeys.fromSeed(
      getShieldedSeed('0000000000000000000000000000000000000000000000000000000000000002'),
    );
    wallet2 = Wallet.startFirst(Wallet, CoreWallet.initEmpty(wallet2Keys, Wallet.configuration.networkId));

    await wallet.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground(walletKeys) }).pipe(Effect.runPromise);
    await wallet2.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground(wallet2Keys) }).pipe(Effect.runPromise);
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
    const syncedState: CoreWallet = await pipe(
      wallet.rawState,
      rx.map(ProtocolState.state),
      rx.skip(1),
      rx.filter((state: CoreWallet) => state.progress.isStrictlyComplete() && state.state.coins.size > 0),
      (a) => rx.firstValueFrom(a),
    );

    const balances: Record<string, bigint> = coinsAndBalances.getAvailableBalances(syncedState);

    const rawOutputs = sampleValue(outputsArbitrary(balances, recipientArbitrary));
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
          return v1.transferTransaction(walletKeys, transferOutputs).pipe(
            Effect.flatMap((unprovenTx) => v1.proveTransaction(unprovenTx)),
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
    expect(transaction.guaranteedOffer!.outputs.length).toBeGreaterThanOrEqual(rawOutputs.length);
    usedTokenTypes.forEach((tokenType) => {
      const delta = transaction.guaranteedOffer!.deltas.get(tokenType);
      expect(delta == undefined || delta >= 0n).toBe(true);
    });
    // rawOutputs.forEach((rawOutput) => {
    //   const appliedState = new ledger.ZswapLocalState().applyTx(rawOutput.receiverAddress, transaction, 'success');
    //   expect(Array.from(appliedState.coins)).toMatchObject([{ value: rawOutput.amount, type: rawOutput.type }]);
    // });
    expect(result.submissionResult._tag).toBe('Finalized');
  });

  it('should create and submit a transfer, which is properly received', async () => {
    await rx.firstValueFrom(
      wallet.rawState.pipe(
        rx.map(ProtocolState.state),
        rx.skip(1),
        rx.filter((state: CoreWallet) => state.state.coins.size > 0),
      ),
    );
    const receiverState = await pipe(wallet2.rawState, rx.map(ProtocolState.state), (s) => rx.firstValueFrom(s));

    await wallet.runtime
      .dispatch({
        [V1Tag]: (v1) =>
          v1
            .transferTransaction(walletKeys, [
              {
                type: (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw,
                amount: 42n,
                receiverAddress: getShieldedAddress(receiverState),
              },
            ])
            .pipe(
              Effect.flatMap((unprovenTx) => v1.proveTransaction(unprovenTx)),
              Effect.flatMap((tx) => v1.submitTransaction(tx, 'Finalized')),
            ),
      })
      .pipe(Effect.runPromise);

    const finalBalance = await pipe(
      wallet2.rawState,
      rx.skip(1),
      rx.map(ProtocolState.state),
      rx.filter((state) => state.progress.isStrictlyComplete()),
      rx.map((state) => coinsAndBalances.getAvailableBalances(state)[shieldedTokenType]),
      (a) => rx.firstValueFrom(a),
    );

    expect(finalBalance).toEqual(25000000000000000n + 42n); //initial balance + transferred 42
  });

  it('should init a swap, which could be successfully balanced with other wallet and submitted', async () => {
    const syncedState1: CoreWallet = await waitForSync(wallet);
    const syncedState2 = await waitForSync(wallet2);
    const balances = coinsAndBalances.getAvailableBalances(syncedState1);

    const swapParams = sampleValue(swapParamsArbitrary(balances, getShieldedAddress(syncedState1)));

    const finalTx = await wallet.runtime
      .dispatch({
        [V1Tag]: (v1) =>
          pipe(
            v1.initSwap(walletKeys, swapParams.inputs, swapParams.outputs),
            Effect.andThen((unprovenTx) => v1.proveTransaction(unprovenTx)),
          ),
      })
      .pipe(
        Effect.andThen((tx) => {
          return wallet2.runtime.dispatch({
            [V1Tag]: (v1) =>
              pipe(
                v1.balanceTransaction(wallet2Keys, tx),
                Effect.andThen((unprovenTx) => v1.proveTransaction(unprovenTx!)),
                Effect.tap((tx) => v1.submitTransaction(tx, 'Finalized')),
              ),
          });
        }),
        Effect.runPromise,
      );

    // This is a bit of an overestimation, but given various decisions that can be made in the balancing process,
    // it's a good enough range to test against
    // adding overhead for each output because balancing won't create a change output if it does not make sense
    const stateAfter1 = await waitForSync(wallet);
    const stateAfter2 = await waitForSync(wallet2);

    const cABefore1 = getCoinsAndBalances(syncedState1);
    const cABefore2 = getCoinsAndBalances(syncedState2);
    const cAAfter1 = getCoinsAndBalances(stateAfter1);
    const cAAfter2 = getCoinsAndBalances(stateAfter2);

    Object.entries(swapParams.inputs).forEach(([type, value]) => {
      const change1 = getBalanceChange(cABefore1, cAAfter1, type);
      const change2 = getBalanceChange(cABefore2, cAAfter2, type);

      expect(change1).toEqual(value * -1n);
      expect(change2).toEqual(value);
    });

    swapParams.outputs.forEach((output) => {
      const change1 = getBalanceChange(cABefore1, cAAfter1, output.type);
      const change2 = getBalanceChange(cABefore2, cAAfter2, output.type);

      expect(change1).toEqual(output.amount);
      expect(change2).toEqual(output.amount * -1n);
    });

    expect(finalTx.guaranteedOffer!.deltas.get(shieldedTokenType)).toBeUndefined();
  });
});
