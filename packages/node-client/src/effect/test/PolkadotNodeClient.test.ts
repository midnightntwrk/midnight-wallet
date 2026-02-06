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
import { describe, it, vi, expect, beforeEach, afterEach } from 'vitest';
import { PolkadotNodeClient } from '../PolkadotNodeClient.js';
import * as NodeClient from '../NodeClient.js';
import * as SubmissionEvent from '../SubmissionEvent.js';
import { type StartedTestContainer, Wait } from 'testcontainers';
import { Array as EArray, Chunk, Effect, Either, Exit, Order, pipe, Random, Scope, Stream } from 'effect';
import { TestTransactions } from '../../testing/index.js';
import { TestContainers } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { NodeContext } from '@effect/platform-node';
import { SerializedTransaction } from '@midnight-ntwrk/wallet-sdk-abstractions';

const clientLayer = (nodePort: number) =>
  PolkadotNodeClient.layer({
    nodeURL: new URL(`ws://127.0.0.1:${nodePort}`),
  });

// It takes some time to pass through enough rounds of consensus, even in tests
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// There are issues with replaying transactions after node restart
describe.skip('PolkadotNodeClient', () => {
  let scope: Scope.CloseableScope | undefined = undefined;
  let node: StartedTestContainer | undefined = undefined;

  beforeEach(async () => {
    return Effect.gen(function* () {
      node = yield* TestContainers.runNodeContainer((c) =>
        c.withNetworkAliases('midnight-node').withWaitStrategy(Wait.forLogMessage('Imported #1')),
      );
    }).pipe(
      Effect.provide(NodeContext.layer),
      Effect.provideServiceEffect(
        Scope.Scope,
        Scope.make().pipe(
          Effect.tap((builtScope) =>
            Effect.sync(() => {
              scope = builtScope;
            }),
          ),
        ),
      ),
      Effect.runPromise,
    );
  });

  afterEach(async () => {
    if (scope) {
      await pipe(Scope.close(scope, Exit.void), Effect.runPromise);
    }
  });

  it('does report an error if transaction fails well-formedness check upon submission', async () => {
    const result = await pipe(
      Effect.gen(function* () {
        const transactions = yield* TestTransactions.load(TestTransactions.defaultPaths.fullPath);
        return yield* NodeClient.sendMidnightTransactionAndWait(
          SerializedTransaction.from(transactions.unbalanced_tx),
          'Submitted',
        );
      }),
      Effect.either,
      Effect.provide(clientLayer(node!.getMappedPort(9944))),
      Effect.provide(NodeContext.layer),
      Effect.scoped,
      Effect.runPromiseExit,
    );

    Exit.match(result, {
      onFailure: (cause) => {
        //We don't want here any error
        expect(cause).toBe(null);
      },
      onSuccess: (result) => {
        expect(Either.isLeft(result)).toBe(true);
      },
    });
  });

  it('does report an error if node cannot deserialize transaction', async () => {
    const modifyTx = (txBytes: Uint8Array) => {
      return Effect.gen(function* () {
        const pickNumber = Random.nextIntBetween(0, txBytes.length - 1);
        const indexA = yield* pickNumber;
        const indexB = yield* pickNumber.pipe(
          Effect.repeat({
            until: (value) => value != indexA,
          }),
        );
        const [startIndex, endIndex] = pipe([indexA, indexB], EArray.sort(Order.number));
        return Buffer.from(txBytes).subarray(startIndex, endIndex);
      });
    };

    const allSubmissions = TestTransactions.load(TestTransactions.defaultPaths.fullPath).pipe(
      Stream.fromEffect,
      Stream.flatMap(TestTransactions.streamAllValid),
      Stream.mapEffect((tx) => modifyTx(tx.serialize())),
      Stream.mapEffect((serializedTx) =>
        NodeClient.sendMidnightTransactionAndWait(SerializedTransaction.of(serializedTx), 'Submitted'),
      ),
      Stream.either,
      Stream.runCollect,
    );

    const result = await pipe(
      allSubmissions,
      Effect.provide(clientLayer(node!.getMappedPort(9944))),
      Effect.provide(NodeContext.layer),
      Effect.scoped,
      Effect.runPromiseExit,
    );

    Exit.match(result, {
      onFailure: (cause) => {
        //We don't want here any error
        expect(cause).toBe(null);
      },
      onSuccess: Chunk.forEach((item) => {
        expect(Either.isLeft(item)).toBe(true);
      }),
    });
  });

  it('does submit a transaction', async () => {
    const submitAllTransactions = TestTransactions.load(TestTransactions.defaultPaths.fullPath).pipe(
      Stream.fromEffect,
      Stream.flatMap(TestTransactions.streamAllValid),
      Stream.mapEffect((tx) => NodeClient.sendMidnightTransactionAndWait(SerializedTransaction.from(tx), 'InBlock')),
      Stream.runDrain,
    );

    const result = await pipe(
      submitAllTransactions,
      Effect.provide(clientLayer(node!.getMappedPort(9944))),
      Effect.provide(NodeContext.layer),
      Effect.scoped,
      Effect.runPromiseExit,
    );

    expect(Exit.isSuccess(result)).toBe(true);
  });

  it.concurrent('does emit subsequent events', async () => {
    const submitAndCollectEvents = TestTransactions.load(TestTransactions.defaultPaths.fullPath).pipe(
      Stream.fromEffect,
      Stream.flatMap(TestTransactions.streamAllValid),
      Stream.take(1),
      Stream.flatMap((tx) => NodeClient.sendMidnightTransaction(SerializedTransaction.from(tx))),
      Stream.runCollect,
      Effect.map(Chunk.toArray),
    );

    const [submitted, inBlock, finalized] = await pipe(
      submitAndCollectEvents,
      Effect.provide(clientLayer(node!.getMappedPort(9944))),
      Effect.provide(NodeContext.layer),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(SubmissionEvent.is('Submitted')(submitted)).toBe(true);
    expect(SubmissionEvent.is('InBlock')(inBlock)).toBe(true);
    expect(SubmissionEvent.is('Finalized')(finalized)).toBe(true);
    // expect((inBlock as SubmissionEvent.Cases.InBlock).blockHeight).toBeLessThanOrEqual(
    //   (finalized as SubmissionEvent.Cases.Finalized).blockHeight,
    // );
    // expect((inBlock as SubmissionEvent.Cases.InBlock).blockHash).toEqual(
    //   (finalized as SubmissionEvent.Cases.Finalized).blockHash,
    // );
  });

  it("is able to submit transaction after node's unavailability", async () => {
    const first2Transactions = TestTransactions.load(TestTransactions.defaultPaths.fullPath).pipe(
      Stream.fromEffect,
      Stream.flatMap(TestTransactions.streamAllValid),
      Stream.take(2),
      Stream.runCollect,
      Effect.map(Chunk.toArray),
    );

    const program = (node: StartedTestContainer) =>
      Effect.gen(function* () {
        const [tx1, tx2] = yield* first2Transactions;
        yield* NodeClient.sendMidnightTransactionAndWait(SerializedTransaction.from(tx1), 'InBlock');
        yield* Effect.promise(() =>
          node.restart({
            timeout: 10_000,
          }),
        );
        yield* NodeClient.sendMidnightTransactionAndWait(SerializedTransaction.from(tx2), 'InBlock');
      });

    const result = await pipe(
      TestContainers.findAvailablePort,
      Effect.flatMap((port) =>
        TestContainers.runNodeContainer((desc) =>
          desc.withExposedPorts({
            container: 9944,
            host: port,
          }),
        ),
      ),
      Effect.flatMap((container) =>
        pipe(program(container), Effect.provide(clientLayer(container.getMappedPort(9944)))),
      ),
      Effect.provide(NodeContext.layer),
      Effect.scoped,
      Effect.runPromiseExit,
    );

    Exit.match(result, {
      onFailure: (failure) => expect(failure).toBe(null),
      onSuccess: () => expect(true).toBe(true),
    });
  });
});
