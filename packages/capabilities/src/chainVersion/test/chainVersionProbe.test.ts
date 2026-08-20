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

/**
 * What the chain answers when asked which protocol version it is on.
 *
 * @remarks
 *   The question exists because a wallet that spans a protocol boundary has to choose a variant before it has seen a
 *   single event, and until it asks, its only guess is the bottom of the timeline. The answer is a property of the
 *   chain, read from the same block query validation already reads.
 */

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { QueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { chainVersionOf, currentChainVersion } from '../chainVersionProbe.js';

/** A block as the indexer serves it, cut down to the one field the probe reads. */
const blockAt = (protocolVersion: number) => ({ block: { protocolVersion } });

/**
 * An indexer that answers every query with one prepared result.
 *
 * @remarks
 *   A stub rather than a spy: what is asserted is the version the probe arrives at, not that a query was issued. The
 *   real {@link currentChainVersion} document is still the one executed — only the transport is replaced — so a
 *   selection set that stopped carrying `protocolVersion` would surface here.
 */
const indexerAnswering = <T>(result: T): Layer.Layer<QueryClient> =>
  // Type cast required because: `QueryClient.query` is generic in the document it is handed, so its result type is
  // computed from that document. A stub answering with one prepared value cannot express that relation; the pairing
  // holds by construction here, since each caller hands in the shape the query it provokes asks for.
  Layer.succeed(QueryClient, { query: () => Effect.succeed(result) } as QueryClient.Service);

describe('reading the protocol version out of a block', () => {
  it('takes the version the chain reported its latest block under', () => {
    expect(chainVersionOf(blockAt(2_000_000))).toStrictEqual(Option.some(ProtocolVersion.ProtocolVersion(2_000_000n)));
  });

  it('reports nothing for a chain that has produced no block at all', () => {
    // Not version zero: a chain with no blocks has not said which side of any boundary it is on, and answering with
    // the bottom of the timeline is exactly the wrong guess the probe exists to remove.
    expect(chainVersionOf({ block: null })).toStrictEqual(Option.none());
  });
});

describe('asking the chain for its current protocol version', () => {
  it('answers with the version the indexer reports for the latest block', async () =>
    Effect.gen(function* () {
      const version = yield* currentChainVersion;

      expect(version).toStrictEqual(Option.some(ProtocolVersion.ProtocolVersion(2_000_000n)));
    }).pipe(Effect.provide(indexerAnswering(blockAt(2_000_000))), Effect.runPromise));

  it('answers with nothing when the indexer knows of no block', async () =>
    Effect.gen(function* () {
      const version = yield* currentChainVersion;

      expect(version).toStrictEqual(Option.none());
    }).pipe(Effect.provide(indexerAnswering({ block: null })), Effect.runPromise));
});
