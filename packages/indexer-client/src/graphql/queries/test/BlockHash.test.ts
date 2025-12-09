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
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Effect, Option } from 'effect';
import { randomUUID } from 'node:crypto';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import { Mock, afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HttpQueryClient } from '../../../effect/index.js';
import { BlockHashQuery, BlockHashQueryVariables } from '../../generated/graphql.js';
import { BlockHash } from '../BlockHash.js';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: {
    TESTCONTAINERS_UID: environmentId,
  },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose.yml')
  // The test below assumes indexer is able to serve blocks, so we wait for it to index at least one block
  // Otherwise the test below would be flakey or not precise enough to be useful
  // Inspecting logs is not the best idea, but here it's the only way
  .withWaitStrategy(`indexer_${environmentId}`, Wait.forLogMessage(/block indexed/))
  .withEnvironment(environmentVars);

describe('BlockHash query', () => {
  describe('with available Indexer Server', () => {
    let startedEnvironment: StartedDockerComposeEnvironment | undefined = undefined;
    const getIndexerPort = () =>
      startedEnvironment?.getContainer(`indexer_${environmentId}`)?.getMappedPort(8088) ?? 8088;

    beforeAll(async () => {
      startedEnvironment = await environment.up();
    }, timeout_minutes(3));

    afterAll(async () => {
      await startedEnvironment?.down();
    }, timeout_minutes(1));

    it(
      'should fail with ClientError for unknown URL',
      async () => {
        await BlockHash.run({ offset: null }).pipe(
          Effect.catchSome((err) => (err._tag === 'ClientError' ? Option.some(Effect.succeed(void 0)) : Option.none())),
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
          Effect.flatMap((data) => (data ? Effect.fail('Unexpectedly received data') : Effect.succeed(void 0))),
          Effect.provide(HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/a__p__i/v3/graphql` })),
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
          Effect.provide(HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/api/v3/graphql` })),
          Effect.scoped,
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected error: ${err.message}`)),
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });

  it('should support query function injection', async () => {
    const block = { block: { height: 1_000, hash: 'SOME_HASH', ledgerParameters: '0x0' } };
    const blockExpectation = expect.objectContaining({
      block: expect.objectContaining({
        height: block.block.height,
        hash: block.block.hash,
        ledgerParameters: block.block.ledgerParameters,
      }),
    });
    const mockedQueryFn: Mock<(v: BlockHashQueryVariables) => Effect.Effect<BlockHashQuery>> = vi.fn();

    mockedQueryFn.mockReturnValue(Effect.succeed(block));

    await Effect.gen(function* () {
      const query = yield* BlockHash;
      const result = yield* query({ offset: null });

      expect(result).toEqual(blockExpectation);
    }).pipe(
      Effect.provideService(BlockHash.tag, mockedQueryFn),
      Effect.provide(HttpQueryClient.layer({ url: 'http://127.0.0.1:8088/a__p__i/v3/graphql' })),
      Effect.scoped,
      Effect.catchAll((err) => Effect.fail(`Encountered unexpected error: ${err.message}`)),
      Effect.runPromise,
    );

    await Effect.gen(function* () {
      const result = yield* BlockHash.run({ offset: null });

      expect(result).toEqual(blockExpectation);
    }).pipe(
      Effect.provideService(BlockHash.tag, mockedQueryFn),
      Effect.provide(HttpQueryClient.layer({ url: 'http://127.0.0.1:8088/a__p__i/v3/graphql' })),
      Effect.scoped,
      Effect.catchAll((err) => Effect.fail(`Encountered unexpected error: ${err.message}`)),
      Effect.runPromise,
    );
  });
});
