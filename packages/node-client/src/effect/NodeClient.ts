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
import { Context, Effect, Option, Stream } from 'effect';
import * as SubmissionEvent from './SubmissionEvent.js';
import * as NodeClientError from './NodeClientError.js';
import { type SerializedTransaction } from '@midnightntwrk/wallet-sdk-abstractions';

export type Genesis = { readonly transactions: readonly SerializedTransaction.SerializedTransaction[] };

/**
 * The node's highest block that GRANDPA has finalized.
 *
 * @remarks
 *   This is the reference a wallet compares an indexer's self-reported position against. It comes from consensus rather
 *   than from the indexer, which is what makes the comparison meaningful.
 */
export type FinalizedBlock = {
  /** The hash of the finalized block, hex-encoded. */
  readonly hash: string;
  /** The height of the finalized block. */
  readonly height: bigint;
};

export interface Service {
  sendMidnightTransaction(
    serializedTransaction: SerializedTransaction.SerializedTransaction,
  ): Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError>;
  getGenesis(): Effect.Effect<Genesis, NodeClientError.NodeClientError>;

  /**
   * Reads the node's highest finalized block.
   *
   * @remarks
   *   Finalized, not best: the wallet's liveness check compares an indexer's self-reported position against this value,
   *   and the indexer ingests finalized blocks only. An implementation that answered with the best (latest, possibly
   *   reverted) head would report a healthy indexer as behind by the finality gap on every poll. The default
   *   implementation reads the finalized head's hash and then the header at that hash, so the two fields describe the
   *   same block.
   *
   *   Must be safe to call while a `sendMidnightTransaction` is in flight on the same instance: the liveness check polls
   *   on a timer and takes no lock. The default implementation reference-counts its shared connection and disconnects
   *   only when the last in-flight call finishes, so a read completing never drops a submission's status subscription.
   *
   *   An unreachable node must surface as a typed `NodeClientError`, not a defect: the liveness check turns that failure
   *   into an `Unavailable` verdict, and a defect would kill its poll instead.
   * @example
   *   ```ts
   *   const { hash, height } = yield* client.getFinalizedBlock();
   *   ```;
   *
   * @returns An effect yielding the hex-encoded hash and the height of the highest block GRANDPA has finalized.
   */
  getFinalizedBlock(): Effect.Effect<FinalizedBlock, NodeClientError.NodeClientError>;

  /**
   * Reads the hash of the node's genesis block.
   *
   * @remarks
   *   Identifies the chain the node is on. The wallet compares it, once, against the indexer's block at height zero, and
   *   pins a `WrongNetwork` verdict when they differ — so this must be the hash of block zero, not of any later
   *   checkpoint. The comparison is by bytes, tolerant of a `0x` prefix and of case, but the convention on this
   *   interface is a lowercase, `0x`-prefixed hex string, which is what the default implementation returns.
   *
   *   Should not require a live connection. The default implementation answers from state the api captured when it was
   *   created, so the check can establish the chain identity even while the node is temporarily unreachable.
   * @example
   *   ```ts
   *   const genesisHash = yield* client.getGenesisHash();
   *   // '0x1234…' — compare with IndexerLiveness.sameGenesis(indexerHash, genesisHash)
   *   ```;
   *
   * @returns An effect yielding the genesis-block hash as a `0x`-prefixed hex string.
   */
  getGenesisHash(): Effect.Effect<string, NodeClientError.NodeClientError>;
}

export class NodeClient extends Context.Tag('@midnight-ntwrk/wallet-node-client#NodeClient')<NodeClient, Service>() {}

export const getGenesisTransactions = (): Effect.Effect<Genesis, NodeClientError.NodeClientError, NodeClient> =>
  NodeClient.pipe(Effect.flatMap((client) => client.getGenesis()));

/**
 * Reads the node's highest finalized block.
 *
 * @remarks
 *   Safe to interleave with other calls on the same service instance: the default implementation reference-counts its
 *   shared connection and disconnects only when the last in-flight call finishes, so a read completing never drops an
 *   in-flight `sendMidnightTransaction`'s status subscription.
 * @example
 *   ```ts
 *   const finalized = yield* NodeClient.getFinalizedBlock();
 *   ```;
 *
 * @returns An effect yielding the hash and height of the highest block GRANDPA has finalized.
 */
export const getFinalizedBlock = (): Effect.Effect<FinalizedBlock, NodeClientError.NodeClientError, NodeClient> =>
  NodeClient.pipe(Effect.flatMap((client) => client.getFinalizedBlock()));

/**
 * Reads the hash of the node's genesis block.
 *
 * @remarks
 *   Identifies the chain the node is on: two endpoints reporting different genesis hashes are on different networks. The
 *   default implementation answers from state the client already holds, without opening a connection.
 * @example
 *   ```ts
 *   const genesisHash = yield* NodeClient.getGenesisHash();
 *   ```;
 *
 * @returns An effect yielding the genesis-block hash as a `0x`-prefixed hex string.
 */
export const getGenesisHash = (): Effect.Effect<string, NodeClientError.NodeClientError, NodeClient> =>
  NodeClient.pipe(Effect.flatMap((client) => client.getGenesisHash()));

export const sendMidnightTransaction = (
  serializedTransaction: SerializedTransaction.SerializedTransaction,
): Stream.Stream<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError, NodeClient> =>
  NodeClient.pipe(
    Stream.fromEffect,
    Stream.flatMap((client) => client.sendMidnightTransaction(serializedTransaction)),
  );

export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedTransaction.SerializedTransaction,
  waitFor: SubmissionEvent.Cases.Submitted['_tag'],
): Effect.Effect<SubmissionEvent.Cases.Submitted, NodeClientError.NodeClientError, NodeClient>;
export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedTransaction.SerializedTransaction,
  waitFor: SubmissionEvent.Cases.InBlock['_tag'],
): Effect.Effect<SubmissionEvent.Cases.InBlock, NodeClientError.NodeClientError, NodeClient>;
export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedTransaction.SerializedTransaction,
  waitFor: SubmissionEvent.Cases.Finalized['_tag'],
): Effect.Effect<SubmissionEvent.Cases.Finalized, NodeClientError.NodeClientError, NodeClient>;
export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedTransaction.SerializedTransaction,
  waitFor: SubmissionEvent.SubmissionEvent['_tag'],
): Effect.Effect<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError, NodeClient>;
export function sendMidnightTransactionAndWait(
  serializedTransaction: SerializedTransaction.SerializedTransaction,
  waitFor: SubmissionEvent.SubmissionEvent['_tag'],
): Effect.Effect<SubmissionEvent.SubmissionEvent, NodeClientError.NodeClientError, NodeClient> {
  return sendMidnightTransaction(serializedTransaction).pipe(
    Stream.find(SubmissionEvent.is(waitFor)),
    Stream.runHead,
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new NodeClientError.TransactionProgressError({
              message: 'Transaction did not reach desired stage and no other error was reported',
              txData: serializedTransaction,
              desiredStage: waitFor,
            }),
          ),
        onSome: (event) => Effect.succeed(event),
      }),
    ),
  );
}
