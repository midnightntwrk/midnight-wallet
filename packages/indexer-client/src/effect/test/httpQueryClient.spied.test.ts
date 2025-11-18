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
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import * as QueryClient from '../QueryClient.js';

vi.mock('graphql-http', () => ({
  createClient: vi.fn(),
}));

describe('HttpQueryClient', () => {
  describe('layer', () => {
    it('disposes of underlying scoped client', async () => {
      const graphqlHTTP = await import('graphql-http');
      const SpiedHttpQueryClient = await import('../HttpQueryClient.js');

      const dispose = vi.fn();
      const spiedCreateClient = vi
        .spyOn(graphqlHTTP, 'createClient')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        .mockImplementationOnce(() => ({ dispose }) as any);

      await Effect.gen(function* () {
        const client = yield* QueryClient.QueryClient;

        expect(client).toBeDefined();
      }).pipe(
        Effect.provide(SpiedHttpQueryClient.layer({ url: 'http://localhost.com' })),
        Effect.scoped,
        Effect.runPromise,
      );

      expect(spiedCreateClient).toHaveBeenCalled();
      expect(dispose).toHaveBeenCalled();
    });
  });
});
