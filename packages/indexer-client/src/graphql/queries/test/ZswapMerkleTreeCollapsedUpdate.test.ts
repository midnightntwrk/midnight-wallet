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
import { Effect, Layer, Ref } from 'effect';
import { print } from 'graphql';
import { describe, expect, it } from 'vitest';
import { QueryClient } from '../../../effect/index.js';
import type { Query } from '../../../effect/Query.js';
import type {
  ZswapMerkleTreeCollapsedUpdateQuery,
  ZswapMerkleTreeCollapsedUpdateQueryVariables,
} from '../../generated/graphql.js';
import { ZswapMerkleTreeCollapsedUpdate } from '../ZswapMerkleTreeCollapsedUpdate.js';

type RecordedRequest = Readonly<{ document: string; variables: unknown }>;

/** The canned answer this suite's stubs hand back, shaped by the generated query type. */
const collapsedUpdate: ZswapMerkleTreeCollapsedUpdateQuery = {
  zswapMerkleTreeCollapsedUpdate: {
    startIndex: 0,
    endIndex: 41,
    update: '0xdeadbeef',
    protocolVersion: 2_000_000,
  },
};

/**
 * The exact operation the wallet must put on the wire. Anchoring a shielded wallet across the fork needs all four
 * fields: the index bounds to place the update, the hex payload to deserialize, and the protocol version to decide
 * which ledger deserializes it.
 */
const expectedDocument = `query ZswapMerkleTreeCollapsedUpdate($startIndex: Int!, $endIndex: Int!) {
  zswapMerkleTreeCollapsedUpdate(startIndex: $startIndex, endIndex: $endIndex) {
    startIndex
    endIndex
    update
    protocolVersion
  }
}`;

/** A `QueryClient` stub that records every document it is asked to execute. */
const recordingQueryClient = (requests: Ref.Ref<readonly RecordedRequest[]>): Layer.Layer<QueryClient> => {
  const service: QueryClient.Service = {
    query: <R, V, T extends Query.Document<R, V> = Query.Document<R, V>>(document: T, variables: V) =>
      Ref.update(requests, (recorded) => [...recorded, { document: print(document), variables }]).pipe(
        // Type cast required because: `query` is generic over the document type, so `Query.Result<T>`
        // cannot be narrowed from inside the implementation. This stub answers every document with
        // the single canned result the suite drives through it.
        Effect.as(collapsedUpdate as Query.Result<T>),
      ),
  };

  return Layer.succeed(QueryClient, service);
};

describe('ZswapMerkleTreeCollapsedUpdate query', () => {
  it('should execute the zswapMerkleTreeCollapsedUpdate operation with the index range as variables', async () => {
    const variables: ZswapMerkleTreeCollapsedUpdateQueryVariables = { startIndex: 0, endIndex: 41 };

    const { recorded, result } = await Effect.gen(function* () {
      const requests = yield* Ref.make<readonly RecordedRequest[]>([]);
      const result = yield* ZswapMerkleTreeCollapsedUpdate.run(variables).pipe(
        Effect.provide(recordingQueryClient(requests)),
      );

      return { recorded: yield* Ref.get(requests), result };
    }).pipe(
      Effect.mapError((err) => `Encountered unexpected error: ${err.message}`),
      Effect.runPromise,
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0].document.trim()).toEqual(expectedDocument);
    expect(recorded[0].variables).toEqual({ startIndex: 0, endIndex: 41 });
    expect(result).toEqual(collapsedUpdate);
  });

  it('should support query function injection', async () => {
    const variables: ZswapMerkleTreeCollapsedUpdateQueryVariables = { startIndex: 7, endIndex: 7 };
    const seen = Effect.runSync(Ref.make<readonly ZswapMerkleTreeCollapsedUpdateQueryVariables[]>([]));
    const requests = Effect.runSync(Ref.make<readonly RecordedRequest[]>([]));
    const injected = (received: ZswapMerkleTreeCollapsedUpdateQueryVariables) =>
      Ref.update(seen, (all) => [...all, received]).pipe(Effect.as(collapsedUpdate));

    await Effect.gen(function* () {
      const query = yield* ZswapMerkleTreeCollapsedUpdate;

      expect(yield* query(variables)).toEqual(collapsedUpdate);
      expect(yield* ZswapMerkleTreeCollapsedUpdate.run(variables)).toEqual(collapsedUpdate);
      expect(yield* Ref.get(seen)).toEqual([variables, variables]);
      // The injected function short-circuits the client: nothing reaches the wire.
      expect(yield* Ref.get(requests)).toEqual([]);
    }).pipe(
      Effect.provideService(ZswapMerkleTreeCollapsedUpdate.tag, injected),
      Effect.provide(recordingQueryClient(requests)),
      Effect.mapError((err) => `Encountered unexpected error: ${err.message}`),
      Effect.runPromise,
    );
  });
});
