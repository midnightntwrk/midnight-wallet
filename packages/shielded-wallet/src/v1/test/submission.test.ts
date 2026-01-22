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
import { describe, vi, it, expect, afterAll, beforeAll } from 'vitest';
import { TestTransactions } from '@midnight-ntwrk/wallet-sdk-node-client/testing';
import { TestContainers } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { Chunk, Effect, Option, pipe, Stream, Console, Exit, Scope } from 'effect';
import { makeDefaultSubmissionService } from '../Submission.js';
import { PolkadotNodeClient } from '@midnight-ntwrk/wallet-sdk-node-client/effect';
import { NodeContext } from '@effect/platform-node';
import { generateTxs, getTestTxsPath } from '../../test/genTxs.js';
import { type StartedTestContainer } from 'testcontainers';
import { randomUUID } from 'crypto';

vi.setConfig({ testTimeout: 200_000, hookTimeout: 100_000 });

const getExtrinsicHashes = (client: PolkadotNodeClient, blockHash: string): Effect.Effect<string[]> => {
  return Effect.promise(() => client.api.rpc.chain.getBlock(blockHash)).pipe(
    Effect.map((block) => block.block.extrinsics.toArray().map((extrinsic) => extrinsic.hash.toString())),
  );
};
const getFinalizedBlockHashes = (client: PolkadotNodeClient): Effect.Effect<string[]> => {
  return Effect.promise(() => client.api.rpc.chain.getFinalizedHead()).pipe(
    Effect.flatMap((lastFinalizedHash) =>
      Stream.unfoldEffect(lastFinalizedHash, (lastHash) => {
        return Effect.promise(() => client.api.rpc.chain.getBlock(lastHash)).pipe(
          Effect.map((block) => {
            if (block.block.header.number.toNumber() >= 1) {
              return Option.some([block, block.block.header.parentHash] as const);
            } else {
              return Option.none();
            }
          }),
        );
      }).pipe(
        Stream.map((block) => block.block.hash.toString()),
        Stream.runCollect,
        Effect.map((chunk) => Chunk.toArray(chunk)),
      ),
    ),
  );
};

const initEnv = (proofServerUrl: string, TxsFileName: string) =>
  Effect.gen(function* () {
    const network = yield* TestContainers.createNetwork();
    const node = yield* TestContainers.runNodeContainer((c) =>
      c.withNetwork(network).withNetworkAliases('midnight-node'),
    );
    yield* generateTxs(`ws://midnight-node:9944`, proofServerUrl, network, TxsFileName);
    const nodeURL = new URL(`ws://127.0.0.1:${node.getMappedPort(9944)}`);
    const submission = makeDefaultSubmissionService({
      relayURL: nodeURL,
    });
    yield* Effect.addFinalizer(() => submission.close().pipe(Effect.andThen(Console.log('Closed submission service'))));
    const testTx = yield* TestTransactions.load(getTestTxsPath(TxsFileName)).pipe(Effect.map((txs) => txs.initial_tx));
    return { nodeURL, submission, testTx };
  });

describe.skip('Default Submission', () => {
  let scope: Scope.CloseableScope;
  let proofServer: StartedTestContainer;

  beforeAll(async () => {
    await Effect.gen(function* () {
      scope = yield* Scope.make();

      proofServer = yield* TestContainers.runProofServerContainer().pipe(Effect.provideService(Scope.Scope, scope));

      return [proofServer, scope];
    }).pipe(Effect.provide(NodeContext.layer), Effect.scoped, Effect.runPromise);
  });

  afterAll(async () => {
    if (scope) {
      await pipe(Scope.close(scope, Exit.void), Effect.runPromise);
    }
  });

  it('submits and exits cleanly', async () => {
    const result = await pipe(
      Effect.gen(function* () {
        const { submission, testTx } = yield* initEnv(
          `http://127.0.0.1:${proofServer.getMappedPort(6300)}`,
          `${randomUUID()}.json`,
        );
        yield* submission.submitTransaction(testTx, 'Submitted');
      }),
      Effect.scoped,
      Effect.provide(NodeContext.layer),
      Effect.runPromiseExit,
    );

    expect(Exit.isSuccess(result)).toBe(true);
  });

  it.only('submits transactions waiting for submission event', async () => {
    const { submissionResult, checkResult } = await pipe(
      Effect.gen(function* () {
        const { submission, nodeURL, testTx } = yield* initEnv(
          `http://127.0.0.1:${proofServer.getMappedPort(6300)}`,
          `${randomUUID()}.json`,
        );
        const submissionResult = yield* submission.submitTransaction(testTx, 'Submitted');
        const checkResult = yield* PolkadotNodeClient.make({ nodeURL: nodeURL }).pipe(
          Effect.flatMap((client) => Effect.promise(() => client.api.rpc.author.pendingExtrinsics())),
          Effect.map((extrinsics) => extrinsics.toArray().map((extrinsic) => extrinsic.hash.toHex())),
        );

        return { submissionResult, checkResult };
      }),
      Effect.scoped,
      Effect.provide(NodeContext.layer),
      Effect.runPromise,
    );

    expect(checkResult).toContain(submissionResult.txHash);
  });

  it('submits transactions waiting for in-block event', async () => {
    const { submissionResult, checkResult } = await pipe(
      Effect.gen(function* () {
        const { submission, nodeURL, testTx } = yield* initEnv(
          `http://127.0.0.1:${proofServer.getMappedPort(6300)}`,
          `${randomUUID()}.json`,
        );
        const submissionResult = yield* submission.submitTransaction(testTx, 'InBlock');
        const checkResult = yield* PolkadotNodeClient.make({ nodeURL: nodeURL }).pipe(
          Effect.flatMap((client) => getExtrinsicHashes(client, submissionResult.blockHash)),
        );

        return { submissionResult, checkResult };
      }),
      Effect.scoped,
      Effect.provide(NodeContext.layer),
      Effect.runPromise,
    );

    expect(checkResult).toContain(submissionResult.txHash);
  });

  /**
   * Leaving only this test as these have become very memory intensive
   * and also, practically this validates all of the above and below.
   */
  it('submits transactions waiting for finalized event', async () => {
    const { submissionResult, checkResult } = await pipe(
      Effect.gen(function* () {
        const { submission, nodeURL, testTx } = yield* initEnv(
          `http://127.0.0.1:${proofServer.getMappedPort(6300)}`,
          `${randomUUID()}.json`,
        );
        const submissionResult = yield* submission.submitTransaction(testTx, 'Finalized');
        const checkResult = yield* PolkadotNodeClient.make({ nodeURL: nodeURL }).pipe(
          Effect.flatMap((client) =>
            Effect.all({
              blockExtrinsicHashes: getExtrinsicHashes(client, submissionResult.blockHash),
              allFinalizedBlockHashes: getFinalizedBlockHashes(client),
            }),
          ),
        );

        return { submissionResult, checkResult };
      }),
      Effect.scoped,
      Effect.provide(NodeContext.layer),
      Effect.runPromise,
    );

    expect(checkResult.allFinalizedBlockHashes).toContain(submissionResult.blockHash);
    expect(checkResult.blockExtrinsicHashes).toContain(submissionResult.txHash);
  });

  it('exits cleanly', () => {
    return Effect.gen(function* () {
      const { submission } = yield* initEnv(
        `http://127.0.0.1:${proofServer.getMappedPort(6300)}`,
        `${randomUUID()}.json`,
      );
      yield* submission.close();
    }).pipe(Effect.scoped, Effect.provide(NodeContext.layer), Effect.runPromise);
  });
});
