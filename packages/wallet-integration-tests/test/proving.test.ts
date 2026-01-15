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
import { HttpProverClient, ProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { Proving, ProvingRecipe, WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Effect, Either, Layer, pipe, Schedule, Duration } from 'effect';
import { GenericContainer, Wait } from 'testcontainers';
import { describe, expect, it, vi } from 'vitest';
import { getNonDustImbalance } from './utils.js';

const PROOF_SERVER_IMAGE: string = 'ghcr.io/midnight-ntwrk/proof-server:7.0.0-rc.1';
const PROOF_SERVER_PORT: number = 6300;

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const shieldedTokenType = (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw;

const makeTransaction = () => {
  const seed = Buffer.alloc(32, 0);
  const recipient = ledger.ZswapSecretKeys.fromSeed(seed);
  const amount = 42n;
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType, amount);
  const output = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenType, amount);
  return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer);
};

const proofServerContainerResource = Effect.acquireRelease(
  Effect.tryPromise({
    try: async () => {
      return await new GenericContainer(PROOF_SERVER_IMAGE)
        .withExposedPorts(PROOF_SERVER_PORT)
        .withWaitStrategy(Wait.forListeningPorts())
        .withStartupTimeout(120_000)
        .withReuse()
        .start();
    },
    catch: (error) => Effect.fail(error),
  }),
  (container) => Effect.promise(async () => await container.stop()),
).pipe(
  Effect.map((proofServerContainer) => {
    const proofServerPort = proofServerContainer.getMappedPort(PROOF_SERVER_PORT);
    return new URL(`http://localhost:${proofServerPort}`);
  }),
  Effect.retry(Schedule.spaced(Duration.millis(10))),
);

describe('Default Proving Service', () => {
  const adHocProve = (tx: ledger.UnprovenTransaction): Effect.Effect<ledger.FinalizedTransaction> =>
    pipe(
      ProverClient.ProverClient,
      Effect.flatMap((client) => client.proveTransaction(tx, ledger.CostModel.initialCostModel())),
      Effect.map((tx) => tx.bind()),
      Effect.provide(
        proofServerContainerResource.pipe(
          Effect.map((url) =>
            HttpProverClient.layer({
              url,
            }),
          ),
          Layer.unwrapEffect,
        ),
      ),
      Effect.scoped,
      Effect.orDie,
    );

  const testProvenTxEffect = pipe(makeTransaction(), adHocProve, Effect.cached, Effect.flatten);
  const testUnprovenTx = makeTransaction();

  const recipes: ReadonlyArray<{
    recipe: Effect.Effect<ProvingRecipe.ProvingRecipe<ledger.FinalizedTransaction>>;
    expectedImbalance: bigint;
  }> = [
    {
      recipe: pipe(
        testProvenTxEffect,
        Effect.map((testProvenTx) => ({ type: ProvingRecipe.NOTHING_TO_PROVE, transaction: testProvenTx })),
      ),
      expectedImbalance: -42n,
    },
    {
      recipe: pipe(
        testProvenTxEffect,
        Effect.map((testProvenTx) => ({
          type: ProvingRecipe.BALANCE_TRANSACTION_TO_PROVE,
          transactionToBalance: testProvenTx,
          transactionToProve: testUnprovenTx,
        })),
      ),
      expectedImbalance: -84n,
    },
    {
      recipe: Effect.succeed({ type: ProvingRecipe.TRANSACTION_TO_PROVE, transaction: testUnprovenTx }),
      expectedImbalance: -42n,
    },
  ] as const;
  it.each(recipes)(
    'does transform proving recipe into final, proven transaction',
    async ({ recipe, expectedImbalance }) => {
      const finalTx = await Effect.gen(function* () {
        const readyRecipe = yield* recipe;
        const proofServerUrl = yield* proofServerContainerResource;
        const service = Proving.makeDefaultProvingService({
          provingServerUrl: proofServerUrl,
        });

        return yield* service.prove(readyRecipe);
      }).pipe(Effect.scoped, Effect.runPromise);

      expect(finalTx).toBeInstanceOf(ledger.Transaction);
      expect(getNonDustImbalance(finalTx.imbalances(0), shieldedTokenType)).toEqual(expectedImbalance);
    },
  );

  it('does fail with wallet error instance when proving fails (e.g. due to misconfiguration)', async () => {
    const recipe = { type: ProvingRecipe.TRANSACTION_TO_PROVE, transaction: testUnprovenTx } as const;
    const result = await Effect.gen(function* () {
      const misconfiguredService = Proving.makeDefaultProvingService({
        provingServerUrl: new URL('http://localhost:12345'), // Invalid URL to simulate misconfiguration
      });
      return yield* misconfiguredService.prove(recipe);
    }).pipe(Effect.scoped, Effect.either, Effect.runPromise);

    Either.match(result, {
      onRight: (result) => {
        throw new Error(`Unexpected success: ${result.toString()}`);
      },
      onLeft: (error) => {
        expect(error).toBeInstanceOf(WalletError.ProvingError);
      },
    });
  });

  it('does fail with wallet error instance when proving fails (e.g. due to connection error)', async () => {
    const recipe = { type: ProvingRecipe.TRANSACTION_TO_PROVE, transaction: testUnprovenTx } as const;
    const result = await Effect.gen(function* () {
      const proofServerUrl = yield* proofServerContainerResource.pipe(Effect.scoped); //This makes the container stop immediately
      const misconfiguredService = Proving.makeDefaultProvingService({
        provingServerUrl: proofServerUrl,
      });
      return yield* misconfiguredService.prove(recipe);
    }).pipe(Effect.either, Effect.runPromise);

    Either.match(result, {
      onRight: (result) => {
        throw new Error(`Unexpected success: ${result.toString()}`);
      },
      onLeft: (error) => {
        expect(error).toBeInstanceOf(WalletError.ProvingError);
      },
    });
  });
});
