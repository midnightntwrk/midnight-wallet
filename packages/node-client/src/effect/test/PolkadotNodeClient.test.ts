import { describe, it, vi, expect, beforeAll, afterAll } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger';
import { PolkadotNodeClient } from '../PolkadotNodeClient';
import * as NodeClient from '../NodeClient';
import * as SubmissionEvent from '../SubmissionEvent';
import { StartedTestContainer } from 'testcontainers';
import { Array as EArray, Chunk, Effect, Either, Exit, Layer, Order, pipe, Random, Scope, Stream } from 'effect';
import { TestTransactions, TestContainers } from '../../testing/index';
import { NodeContext } from '@effect/platform-node';

const clientLayer = (node: StartedTestContainer) =>
  PolkadotNodeClient.layer({
    nodeURL: new URL(`ws://127.0.0.1:${node.getMappedPort(9944)}`),
  });

// It takes some time to pass through enough rounds of consensus, even in tests
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe('PolkadotNodeClient', () => {
  describe('error cases', () => {
    //This `describe` block is mostly introduced to scope the shared containers environment so that error cases can run quicker
    let scope: Scope.CloseableScope | undefined = undefined;
    let node: StartedTestContainer | undefined = undefined;
    beforeAll(async () => {
      const scopeAndContainers = await Effect.gen(function* () {
        const scope = yield* Scope.make();
        const node = yield* TestContainers.runNodeContainer().pipe(Effect.provideService(Scope.Scope, scope));

        return { scope, node };
      }).pipe(Effect.runPromise);
      scope = scopeAndContainers.scope;
      node = scopeAndContainers.node;
    });
    afterAll(async () => {
      if (scope) {
        await pipe(Scope.close(scope, Exit.void), Effect.runPromise);
      }
    });

    it('does report an error if transaction fails well-formedness check upon submission', async () => {
      const result = await pipe(
        Effect.gen(function* () {
          const transactions = yield* TestTransactions.load;
          return yield* NodeClient.sendMidnightTransactionAndWait(
            transactions.unbalanced_tx.serialize(ledger.NetworkId.Undeployed),
            'Submitted',
          );
        }),
        Effect.either,
        Effect.provide(clientLayer(node!)),
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

      const allSubmissions = TestTransactions.load.pipe(
        Stream.fromEffect,
        Stream.flatMap(TestTransactions.streamAllValid),
        Stream.mapEffect((tx) => modifyTx(tx.serialize(ledger.NetworkId.Undeployed))),
        Stream.mapEffect((serializedTx) => NodeClient.sendMidnightTransactionAndWait(serializedTx, 'Submitted')),
        Stream.either,
        Stream.runCollect,
      );

      const result = await pipe(
        allSubmissions,
        Effect.provide(clientLayer(node!)),
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
  });

  it.concurrent('does submit a transaction', async () => {
    const submitAllTransactions = TestTransactions.load.pipe(
      Stream.fromEffect,
      Stream.flatMap(TestTransactions.streamAllValid),
      Stream.mapEffect((tx) =>
        NodeClient.sendMidnightTransactionAndWait(tx.serialize(ledger.NetworkId.Undeployed), 'InBlock'),
      ),
      Stream.runDrain,
    );

    const result = await pipe(
      submitAllTransactions,
      Effect.provide(TestContainers.runNodeContainer().pipe(Effect.map(clientLayer), Layer.unwrapEffect)),
      Effect.provide(NodeContext.layer),
      Effect.scoped,
      Effect.runPromiseExit,
    );

    expect(Exit.isSuccess(result)).toBe(true);
  });

  it.concurrent('does emit subsequent events', async () => {
    const submitAndCollectEvents = TestTransactions.load.pipe(
      Stream.fromEffect,
      Stream.flatMap(TestTransactions.streamAllValid),
      Stream.take(1),
      Stream.flatMap((tx) => NodeClient.sendMidnightTransaction(tx.serialize(ledger.NetworkId.Undeployed))),
      Stream.runCollect,
      Effect.map(Chunk.toArray),
    );

    const [submitted, inBlock, finalized] = await pipe(
      submitAndCollectEvents,
      Effect.provide(TestContainers.runNodeContainer().pipe(Effect.map(clientLayer), Layer.unwrapEffect)),
      Effect.provide(NodeContext.layer),
      Effect.scoped,
      Effect.runPromise,
    );

    expect(SubmissionEvent.is('Submitted')(submitted)).toBe(true);
    expect(SubmissionEvent.is('InBlock')(inBlock)).toBe(true);
    expect(SubmissionEvent.is('Finalized')(finalized)).toBe(true);
    expect((inBlock as SubmissionEvent.Cases.InBlock).blockHeight).toEqual(
      (finalized as SubmissionEvent.Cases.Finalized).blockHeight,
    );
    expect((inBlock as SubmissionEvent.Cases.InBlock).blockHash).toEqual(
      (finalized as SubmissionEvent.Cases.Finalized).blockHash,
    );
  });

  it.concurrent("is able to submit transaction after node's unavailability", async () => {
    const first2Transactions = TestTransactions.load.pipe(
      Stream.fromEffect,
      Stream.flatMap(TestTransactions.streamAllValid),
      Stream.take(2),
      Stream.runCollect,
      Effect.map(Chunk.toArray),
    );

    const program = (node: StartedTestContainer) =>
      Effect.gen(function* () {
        const [tx1, tx2] = yield* first2Transactions;
        yield* NodeClient.sendMidnightTransactionAndWait(tx1.serialize(ledger.NetworkId.Undeployed), 'InBlock');
        yield* Effect.promise(() =>
          node.restart({
            timeout: 10_000,
          }),
        );
        yield* NodeClient.sendMidnightTransactionAndWait(tx2.serialize(ledger.NetworkId.Undeployed), 'InBlock');
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
      Effect.flatMap((container) => pipe(program(container), Effect.provide(clientLayer(container)))),
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
