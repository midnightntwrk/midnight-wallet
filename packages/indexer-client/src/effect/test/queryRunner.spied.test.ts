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
import { describe, expect, it, vi } from 'vitest';
import { BlockHash } from '../../graphql/queries/BlockHash.js';
import type { BlockHashQuery } from '../../graphql/generated/graphql.js';

vi.mock('graphql-http', () => ({
  createClient: vi.fn(),
}));

describe('QueryRunner', () => {
  describe('runPromise', () => {
    it('should resolve with query result', async () => {
      const graphqlHTTP = await import('graphql-http');
      const SpiedQueryRunner = await import('../QueryRunner.js');

      const block: BlockHashQuery = {
        block: { height: 1_000, hash: 'SOME_HASH', ledgerParameters: '0x0', timestamp: 1 },
      };

      const dispose = vi.fn();
      const spiedCreateClient = vi
        .spyOn(graphqlHTTP, 'createClient')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        .mockImplementationOnce(() => ({ subscribe, dispose }) as any);

      function subscribe(_params: unknown, sink: { next: (data: unknown) => void; complete: () => void }) {
        sink.next({ data: block });
        sink.complete();
        return vi.fn();
      }

      const result = await SpiedQueryRunner.runPromise(
        BlockHash,
        { offset: null },
        { url: 'http://localhost:8088/api/v4/graphql' },
      );

      expect(result).toEqual(block);
      expect(spiedCreateClient).toHaveBeenCalled();
      expect(dispose).toHaveBeenCalled();
    });

    it('should reject for invalid URL scheme', async () => {
      const SpiedQueryRunner = await import('../QueryRunner.js');

      await expect(
        SpiedQueryRunner.runPromise(BlockHash, { offset: null }, { url: 'ftp://localhost:8088/api/v4/graphql' }),
      ).rejects.toThrow();
    });
  });
});
