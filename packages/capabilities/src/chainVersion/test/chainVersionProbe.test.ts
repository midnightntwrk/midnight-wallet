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
 * What the chain answers when asked which protocol version its timeline starts under.
 *
 * @remarks
 *   The question exists because a wallet that spans a protocol boundary has to choose a variant before it has seen a
 *   single event, and until it asks, its only guess is the bottom of the timeline. The answer is a property of the
 *   chain, read from the same block query validation already reads.
 *
 *   Which block is asked about is half the specification, and the half a version arithmetic test cannot see. A fresh
 *   wallet reads a timeline from its start, so the variant it must begin on is the one that can deserialize the _first_
 *   event it will fetch — not the one the chain's tip is on. On a chain with ledger-v8 history those differ, and asking
 *   about the tip hands the ledger-v8 timeline to a ledger version that cannot read a byte of it.
 */

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  BlockHash,
  type BlockHashQuery,
  type BlockHashQueryVariables,
  type BlockOffset,
} from '@midnightntwrk/wallet-sdk-indexer-client';
import { QueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Effect, Layer, Option, Ref } from 'effect';
import { describe, expect, it } from 'vitest';
import { chainVersionOf, timelineStartChainVersion } from '../chainVersionProbe.js';

/** A block as the indexer serves it, cut down to the one field the probe reads. */
const blockAt = (protocolVersion: number) => ({ block: { protocolVersion } });

/** The same block with every field the `BlockHash` selection set asks for, which is what the query itself answers with. */
const servedBlock = (protocolVersion: number): BlockHashQuery => ({
  block: {
    height: 0,
    hash: '0x00',
    protocolVersion,
    ledgerParameters: '0x00',
    timestamp: 0,
    zswapEndIndex: 0,
    dustCommitmentEndIndex: 0,
    dustGenerationEndIndex: 0,
    dustCommitmentMerkleTreeRoot: null,
    dustGenerationMerkleTreeRoot: null,
  },
});

/**
 * An indexer that answers every query with one prepared result.
 *
 * @remarks
 *   A stub rather than a spy: what is asserted is the version the probe arrives at, not that a query was issued. The real
 *   {@link timelineStartChainVersion} document is still the one executed — only the transport is replaced — so a
 *   selection set that stopped carrying `protocolVersion` would surface here.
 */
const indexerAnswering = <T>(result: T): Layer.Layer<QueryClient> =>
  // Type cast required because: `QueryClient.query` is generic in the document it is handed, so its result type is
  // computed from that document. A stub answering with one prepared value cannot express that relation; the pairing
  // holds by construction here, since each caller hands in the shape the query it provokes asks for.
  Layer.succeed(QueryClient, { query: () => Effect.succeed(result) } as QueryClient.Service);

/**
 * The `BlockHash` query itself, recording which block each caller asked about.
 *
 * @remarks
 *   Injected at the query's own tag rather than underneath it, because the claim is about the `offset` variable the probe
 *   fills in, and only here is that variable observable as the typed value it is.
 */
const blockQueryRecording =
  (asked: Ref.Ref<readonly (BlockOffset | null | undefined)[]>, answer: BlockHashQuery) =>
  (variables: BlockHashQueryVariables) =>
    Ref.update(asked, (seen) => [...seen, variables.offset]).pipe(Effect.as(answer));

/** A transport nothing may reach: the cases below inject the query above it, so a request on the wire is a broken test. */
const noTransport: Layer.Layer<QueryClient> = Layer.succeed(QueryClient, {
  query: () => Effect.die(new Error('the probe went to the wire instead of the query it was given')),
});

describe('reading the protocol version out of a block', () => {
  it('takes the version the chain reported that block under', () => {
    expect(chainVersionOf(blockAt(2_000_000))).toStrictEqual(Option.some(ProtocolVersion.ProtocolVersion(2_000_000n)));
  });

  it('reports nothing for a chain that has produced no block at all', () => {
    // Not version zero: a chain with no blocks has not said which side of any boundary it is on, and answering with
    // the bottom of the timeline is exactly the wrong guess the probe exists to remove.
    expect(chainVersionOf({ block: null })).toStrictEqual(Option.none());
  });
});

describe('asking the chain which protocol version its timeline starts under', () => {
  it('asks about the block the timeline starts at, and not the one the chain has reached', async () => {
    const asked = await Effect.gen(function* () {
      const asked = yield* Ref.make<readonly (BlockOffset | null | undefined)[]>([]);

      yield* timelineStartChainVersion.pipe(
        Effect.provideService(BlockHash.tag, blockQueryRecording(asked, servedBlock(2_000_000))),
      );

      return yield* Ref.get(asked);
    }).pipe(Effect.provide(noTransport), Effect.runPromise);

    // Height zero, named explicitly, rather than the absent offset that means "whatever the tip is". A fresh wallet
    // starts reading at the bottom of the timeline, so the version that decides which ledger reads it is the one the
    // bottom of the timeline was written under.
    expect(asked).toEqual([{ height: 0 }]);
  });

  it('answers with the version the indexer reports for that block', async () =>
    Effect.gen(function* () {
      const version = yield* timelineStartChainVersion;

      expect(version).toStrictEqual(Option.some(ProtocolVersion.ProtocolVersion(2_000_000n)));
    }).pipe(Effect.provide(indexerAnswering(blockAt(2_000_000))), Effect.runPromise));

  it('answers with nothing when the indexer knows of no block', async () =>
    Effect.gen(function* () {
      const version = yield* timelineStartChainVersion;

      expect(version).toStrictEqual(Option.none());
    }).pipe(Effect.provide(indexerAnswering({ block: null })), Effect.runPromise));
});
