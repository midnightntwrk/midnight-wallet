// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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
import { Effect } from 'effect';
import { type Mock, describe, expect, it, vi } from 'vitest';
import { HttpQueryClient } from '../../../effect/index.js';
import { type BlockHashQuery, type BlockHashQueryVariables } from '../../generated/graphql.js';
import { BlockHash } from '../BlockHash.js';

describe('BlockHash query', () => {
  it('should support query function injection', async () => {
    const block = { block: { height: 1_000, hash: 'SOME_HASH', ledgerParameters: '0x0', timestamp: 1 } };
    const blockExpectation = expect.objectContaining({
      block: expect.objectContaining({
        height: block.block.height,
        hash: block.block.hash,
        ledgerParameters: block.block.ledgerParameters,
        timestamp: block.block.timestamp,
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
