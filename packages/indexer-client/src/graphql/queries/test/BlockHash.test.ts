/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Effect, Option } from 'effect';
import * as path from 'node:path';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { BlockHash } from '../BlockHash';
import { BlockHashQuery, BlockHashQueryVariables } from '../../generated/graphql';
import { HttpQueryClient } from '../../../effect';

const COMPOSE_PATH = path.resolve(
  new URL(import.meta.url).pathname,
  '../../../../../../../typescript/packages/e2e-tests',
);

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

describe('BlockHash query', () => {
  describe('with available Indexer Server', () => {
    const environmentId = randomUUID();
    let environment: StartedDockerComposeEnvironment | undefined = undefined;
    const getIndexerPort = () => environment?.getContainer(`indexer_${environmentId}`).getMappedPort(8088) ?? 8088;

    beforeAll(async () => {
      environment = await new DockerComposeEnvironment(COMPOSE_PATH, 'docker-compose-dynamic.yml')
        .withEnvironment({
          TESTCONTAINERS_UID: environmentId,
        })
        .up();
    }, timeout_minutes(3));

    afterAll(async () => {
      await environment?.down();
    }, timeout_minutes(1));

    it(
      'should fail with ClientError for unknown URL',
      async () => {
        await BlockHash.run({ offset: null }).pipe(
          Effect.catchSome((err) => (err._tag === 'ClientError' ? Option.some(Effect.succeed(void 0)) : Option.none())),
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
          Effect.flatMap((data) => (data ? Effect.fail('Unexpectedly received data') : Effect.succeed(void 0))),
          Effect.provide(HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/a__p__i/v1/graphql` })),
          Effect.scoped,
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );

    it(
      'should invoke GraphQL query',
      async () => {
        // Expect a result containing a block with any height and hash value.
        const blockExpectation = expect.objectContaining({
          block: expect.objectContaining({
            height: expect.any(Number),
            hash: expect.any(String),
          }),
        });

        await Effect.gen(function* () {
          const query = yield* BlockHash;
          const result = yield* query({ offset: null });

          expect(result).toEqual(blockExpectation);
        }).pipe(
          Effect.provide(HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/api/v1/graphql` })),
          Effect.scoped,
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected error: ${err.message}`)),
          Effect.runPromise,
        );

        await Effect.gen(function* () {
          const result = yield* BlockHash.run({ offset: null });

          expect(result).toEqual(blockExpectation);
        }).pipe(
          Effect.provide(HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/api/v1/graphql` })),
          Effect.scoped,
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected error: ${err.message}`)),
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });

  it('should support query function injection', async () => {
    const block = { block: { height: 1_000, hash: 'SOME_HASH' } };
    const blockExpectation = expect.objectContaining({
      block: expect.objectContaining({
        height: block.block.height,
        hash: block.block.hash,
      }),
    });
    const mockedQueryFn: jest.Mock<(v: BlockHashQueryVariables) => Effect.Effect<BlockHashQuery>> = jest.fn();

    mockedQueryFn.mockReturnValue(Effect.succeed(block));

    await Effect.gen(function* () {
      const query = yield* BlockHash;
      const result = yield* query({ offset: null });

      expect(result).toEqual(blockExpectation);
    }).pipe(
      Effect.provideService(BlockHash.tag, mockedQueryFn),
      // TODO: Rather than providing a 'broken' HTTP query client, provide a test layer instead.
      Effect.provide(HttpQueryClient.layer({ url: 'http://127.0.0.1:8088/a__p__i/v1/graphql' })),
      Effect.scoped,
      Effect.catchAll((err) => Effect.fail(`Encountered unexpected error: ${err.message}`)),
      Effect.runPromise,
    );

    await Effect.gen(function* () {
      const result = yield* BlockHash.run({ offset: null });

      expect(result).toEqual(blockExpectation);
    }).pipe(
      Effect.provideService(BlockHash.tag, mockedQueryFn),
      // TODO: Rather than providing a 'broken' HTTP query client, provide a test layer instead.
      Effect.provide(HttpQueryClient.layer({ url: 'http://127.0.0.1:8088/a__p__i/v1/graphql' })),
      Effect.scoped,
      Effect.catchAll((err) => Effect.fail(`Encountered unexpected error: ${err.message}`)),
      Effect.runPromise,
    );
  });
});
