import { describe, vi, it, expect } from 'vitest';
import { TestContainers, TestTransactions } from '@midnight-ntwrk/wallet-node-client-ts/testing';
import { Chunk, Effect, Option, pipe, Stream, Console, Exit } from 'effect';
import { makeDefaultSubmissionService } from '../Submission';
import * as zswap from '@midnight-ntwrk/zswap';
import { PolkadotNodeClient } from '@midnight-ntwrk/wallet-node-client-ts/effect';
import { NodeContext } from '@effect/platform-node';

vi.setConfig({ testTimeout: 30_000 });

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

const initEnv = Effect.gen(function* () {
  const node = yield* TestContainers.runNodeContainer();
  const nodeURL = new URL(`ws://127.0.0.1:${node.getMappedPort(9944)}`);
  const submission = makeDefaultSubmissionService({
    networkId: zswap.NetworkId.Undeployed,
    relayURL: nodeURL,
  });
  yield* Effect.addFinalizer(() => submission.close().pipe(Effect.andThen(Console.log('Closed submission service'))));
  const testTx = yield* TestTransactions.load.pipe(Effect.map((txs) => txs.initial_tx));
  return { nodeURL, submission, testTx };
});

describe('Default Submission', () => {
  it.concurrent('submits and exits cleanly', async () => {
    const result = await pipe(
      Effect.gen(function* () {
        const { submission, testTx } = yield* initEnv;
        yield* submission.submitTransaction(testTx, 'Submitted');
      }),
      Effect.scoped,
      Effect.provide(NodeContext.layer),
      Effect.runPromiseExit,
    );

    expect(Exit.isSuccess(result)).toBe(true);
  });

  it.concurrent('submits transactions waiting for submission event', async () => {
    const { submissionResult, checkResult } = await pipe(
      Effect.gen(function* () {
        const { submission, nodeURL, testTx } = yield* initEnv;
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

  it.concurrent('submits transactions waiting for in-block event', async () => {
    const { submissionResult, checkResult } = await pipe(
      Effect.gen(function* () {
        const { submission, nodeURL, testTx } = yield* initEnv;
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

  it.concurrent('submits transactions waiting for finalized event', async () => {
    const { submissionResult, checkResult } = await pipe(
      Effect.gen(function* () {
        const { submission, nodeURL, testTx } = yield* initEnv;
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

  it.concurrent('exits cleanly', () => {
    return Effect.gen(function* () {
      const { submission } = yield* initEnv;
      yield* submission.close();
    }).pipe(Effect.scoped, Effect.provide(NodeContext.layer), Effect.runPromise);
  });
});
