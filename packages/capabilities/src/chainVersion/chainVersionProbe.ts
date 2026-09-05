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
 * Asking the chain which protocol version its timeline starts under.
 *
 * @remarks
 *   A wallet that registers a variant either side of a protocol boundary learns the chain's version from the events it
 *   observes, which is too late for one decision: which variant to start on. Until an event arrives its only guess is
 *   the bottom of the timeline, so it starts on V1 — and on a chain that is entirely past the boundary that costs a
 *   hand-over per start, or, on a chain that has produced no event this wallet can see, is simply wrong for as long as
 *   the wallet runs.
 *
 *   This is the question that removes the guess, and it is asked about the **first** block rather than the latest. A
 *   fresh wallet reads a timeline from its start, so what decides where it begins is which ledger version can
 *   deserialize the first event it will fetch — a fact about the bottom of the timeline. On a chain that forked with
 *   history behind it the tip's version answers a different question and answers this one wrongly: it starts the wallet
 *   on a ledger version that cannot read a byte of the history it is about to be served. A chain whose genesis is
 *   already past the boundary has no such history, so it still starts a fresh wallet on V2 directly; a chain that
 *   forked over its own past routes it to V1, where its coins are readable, and the hand-over carries them across.
 *
 *   The answer is read from the same block query validation already reads, so nothing new is asked of the indexer, and it
 *   is best-effort by design: a chain that will not answer leaves the wallet exactly where it was.
 */

import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { BlockHash } from '@midnightntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Data, Effect, Option, pipe } from 'effect';

/**
 * Asks the chain which protocol version its timeline starts under.
 *
 * @remarks
 *   The version of the chain's **first** block, not its latest one. A wallet uses the answer to pick the variant it will
 *   start reading history on, so what it needs to know is which ledger version wrote the beginning of that history —
 *   the tip's version is a different fact, and on a chain that forked over existing history it is the wrong one. An
 *   application supplying its own probe answers that question or the wallet starts on a ledger version that cannot read
 *   what it is served.
 *
 *   Promise-shaped rather than `Effect`-shaped because it is a wallet-configuration field, and an application supplying
 *   its own — pointing at a cache, a node RPC, or a value it already holds — should not have to speak `Effect` to do
 *   it. Every caller treats it as best-effort: a rejection, including a timeout, means "the chain did not say", never
 *   "the wallet cannot start".
 */
export type ChainVersionProbe = () => Promise<ProtocolVersion.ProtocolVersion>;

/** The indexer's answer about one block, cut down to the one field a version probe reads. */
export type BlockVersionAnswer = Readonly<{ block: Readonly<{ protocolVersion: number }> | null }>;

/** Raised when the chain named no version, because it has produced no block for one to be reported under. */
export class ChainVersionUnavailableError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/chainVersion/chainVersionProbe/ChainVersionUnavailableError',
)<{
  readonly message: string;
}> {}

/**
 * Reads the protocol version out of the indexer's answer about a block.
 *
 * @remarks
 *   Absent rather than zero when there is no block. A chain that has produced nothing has not said which side of any
 *   boundary it is on, and the bottom of the timeline is precisely the wrong guess — it is the one the probe exists to
 *   replace.
 * @param answer The indexer's answer about the block that was asked for.
 * @returns The version that block was reported under, or nothing when there is no block.
 */
export const chainVersionOf = (answer: BlockVersionAnswer): Option.Option<ProtocolVersion.ProtocolVersion> =>
  pipe(
    Option.fromNullable(answer.block),
    Option.map((block) => ProtocolVersion.ProtocolVersion(BigInt(block.protocolVersion))),
  );

/**
 * The protocol version the chain's timeline starts under, read through whichever query client is provided.
 *
 * @remarks
 *   The same `BlockHash` query the default block-data fetcher runs, so nothing new is asked of the indexer — pointed at
 *   height zero, the first block the chain ever produced, rather than at the absent offset that means "whatever the tip
 *   is". That block is the one whose ledger version has to be able to read the first event a fresh wallet fetches,
 *   which is the only thing this answer decides.
 */
export const timelineStartChainVersion = Effect.gen(function* () {
  const query = yield* BlockHash;
  return chainVersionOf(yield* query({ offset: { height: 0 } }));
});

/** What building the default {@link ChainVersionProbe} needs: somewhere to ask. */
export type DefaultChainVersionProbeConfiguration = {
  indexerClientConnection: {
    indexerHttpUrl: string;
  };
};

/**
 * Builds a {@link ChainVersionProbe} that asks the indexer over HTTP for the version its first block was reported under.
 *
 * @remarks
 *   Each call opens a short-lived query client and closes it again, as the default block-data fetcher does. It carries no
 *   timeout of its own: the caller that blocks on it owns how long it is prepared to wait, and the wallet that starts
 *   with one applies its own bound.
 *
 *   A chain that reports no block at all is not an answer: the failure below is what every caller reads as "the chain did
 *   not say", and leaves the wallet starting ledger-v8 exactly as a wallet with no probe does.
 * @param config Where to ask.
 * @returns The probe.
 */
export const makeIndexerChainVersionProbe =
  (config: DefaultChainVersionProbeConfiguration): ChainVersionProbe =>
  () =>
    pipe(
      timelineStartChainVersion,
      Effect.provide(HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl })),
      Effect.scoped,
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ChainVersionUnavailableError({
                message: 'The indexer reports no block, so the chain has named no protocol version.',
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.runPromise,
    );
