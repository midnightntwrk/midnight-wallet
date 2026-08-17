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
import { BlockHash } from '@midnightntwrk/wallet-sdk-indexer-client';
import { HttpQueryClient } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import {
  type NodeClient,
  type NodeClientError,
  PolkadotNodeClient,
} from '@midnightntwrk/wallet-sdk-node-client/effect';
import { Duration, Effect, Option, Scope, SynchronizedRef } from 'effect';
import { type LivenessReads, LivenessReadError } from './livenessService.js';

/**
 * How long to spend trying to reach the node before giving up on a poll.
 *
 * @remarks
 *   `PolkadotNodeClient` defaults to `Duration.infinity`, which suits transaction submission — a caller waiting to submit
 *   wants to keep trying. It is wrong here: a liveness check that waits forever on an unreachable node never publishes
 *   the {@link IndexerLiveness.Unavailable} verdict that exists to report exactly that condition, and its poll fibre
 *   hangs instead. This bound must stay well under the poll interval so a failing read cannot outlive the tick that
 *   started it.
 */
const NODE_CONNECTION_TIMEOUT = Duration.seconds(10);

/**
 * Flattens a chain of wrapped errors into one line.
 *
 * @remarks
 *   Both sources wrap their failures — the node client reports "Failed to retrieve the finalized block" over whatever the
 *   RPC actually said. Only the outermost message would otherwise reach `Unavailable.lastError`, which names the
 *   operation that failed but not the reason, and so cannot be acted on.
 */
const describeCause = (error: unknown): string =>
  error instanceof Error
    ? error.cause === undefined || error.cause === null
      ? error.message
      : `${error.message}: ${describeCause(error.cause)}`
    : String(error);

/**
 * Parses a block height reported by the indexer.
 *
 * @remarks
 *   `BigInt` throws a `RangeError` on a non-integral number, and the indexer's payload is not validated against a schema
 *   anywhere on this path. A misbehaving indexer answering `1.5` would therefore raise a defect inside the poll and
 *   stop it permanently — letting the very party this check exists to catch switch it off. Parsing here keeps that a
 *   typed failure, which becomes an `Unavailable` verdict like any other unreadable answer.
 * @param height - The value the indexer reported.
 * @returns The height, or `Option.none` when it is not a whole non-negative number.
 */
export const parseIndexerHeight = (height: unknown): Option.Option<bigint> =>
  typeof height === 'number' && Number.isSafeInteger(height) && height >= 0
    ? Option.some(BigInt(height))
    : Option.none();

/**
 * Parses a node endpoint.
 *
 * @remarks
 *   `new URL` throws on a malformed string — omitting the scheme, for instance — and a throw while constructing a read
 *   escapes before any Effect can catch it.
 * @param nodeURL - The configured endpoint.
 * @returns The parsed URL, or `Option.none` when it cannot be parsed.
 */
const parseNodeURL = (nodeURL: string): Option.Option<URL> => {
  try {
    return Option.some(new URL(nodeURL));
  } catch {
    return Option.none();
  }
};

/** Describes a failure in a way that is useful when it surfaces as `Unavailable.lastError`. */
const readError = (what: string, cause: unknown) =>
  new LivenessReadError({
    message: cause === undefined ? what : `${what}: ${describeCause(cause)}`,
    cause,
  });

export type LivenessReadsConfiguration = {
  readonly indexerClientConnection: { readonly indexerHttpUrl: string };
  readonly nodeClientConnection: { readonly nodeURL: string };
};

/**
 * The two calls the liveness check makes on a node client.
 *
 * @remarks
 *   Narrowed to what the check uses so that a test double answers those methods rather than the whole of
 *   `NodeClient.Service`, and so that this module depends on no more of the node client's surface than it reads.
 */
export type LivenessNodeReader = Pick<NodeClient.Service, 'getFinalizedBlock' | 'getGenesisHash'>;

/** Builds a client for the liveness check's node reads, scoped so the connection is released with its caller. */
export type NodeClientFactory = (
  nodeURL: URL,
) => Effect.Effect<LivenessNodeReader, NodeClientError.NodeClientError, Scope.Scope>;

/**
 * Connects to the node with a bounded initial connection.
 *
 * @remarks
 *   Separated from {@link makeDefaultLivenessReads} so the caching around it can be tested without a node.
 */
const connectToNode: NodeClientFactory = (nodeURL) =>
  PolkadotNodeClient.make({ nodeURL, reconnectionTimeout: NODE_CONNECTION_TIMEOUT });

/**
 * Builds the pair of block-height reads a liveness check compares.
 *
 * @remarks
 *   This is the only place the two sources meet, and it exists in `capabilities` rather than in a wallet package so that
 *   no wallet has to depend on `node-client` directly.
 *
 *   The node client is built once, on the first read that needs it, and then reused. Building one per read repeated the
 *   full `ApiPromise` handshake — including the runtime metadata download — on every poll, against a node the wallet
 *   does not own, to fetch two numbers. polkadot-js re-fetches metadata only when the api is not already ready
 *   (`_loadMeta`), so a reused client pays that cost once per wallet rather than once per poll. The socket itself is
 *   still closed between reads by `getFinalizedBlock`, so nothing is held open on the node's behalf.
 *
 *   Creation is deferred to the first read rather than done here, because a connection failure at construction must
 *   become an {@link IndexerLiveness.Unavailable} verdict. Connecting while the sync stream is being assembled would put
 *   that failure in the stream's acquire instead, so an unreachable node would stop the wallet syncing — the one
 *   outcome this check must never cause.
 *
 *   A failed read leaves the cached client in place. It recovers by itself: `getFinalizedBlock` reconnects through
 *   `ensureConnection`, and polkadot-js retries the metadata load on the next connect whenever an earlier one did not
 *   complete. Only construction failing leaves nothing cached, and the next read then starts over — so a node that is
 *   down when the first poll runs does not switch the check off for the rest of the session.
 *
 *   Both failures are flattened into {@link LivenessReadError} so the service is coupled to neither the indexer's GraphQL
 *   errors nor the node client's error type.
 * @example
 *   ```ts
 *   const reads = yield* makeDefaultLivenessReads({
 *     indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v1/graphql' },
 *     nodeClientConnection: { nodeURL: 'ws://localhost:9944' },
 *   });
 *   ```;
 *
 * @param config - Where to reach the indexer and the node.
 * @param makeNodeClient - How to build the node client. Defaults to a real connection; supplying this is how a test
 *   exercises the caching without a node.
 * @returns An effect yielding reads suitable for {@link LivenessServiceImpl.make}. Scoped, because the client they share
 *   is released when that scope closes.
 */
export const makeDefaultLivenessReads = (
  config: LivenessReadsConfiguration,
  makeNodeClient: NodeClientFactory = connectToNode,
): Effect.Effect<LivenessReads, never, Scope.Scope> =>
  Effect.gen(function* () {
    // The scope the reads are built in, so the shared client is released when sync stops rather than when a read ends.
    const scope = yield* Effect.scope;

    // `SynchronizedRef`, not `Ref`: filling the cache is itself an effect, and two concurrent first reads must not race
    // into building two clients — the second would replace the first, whose socket nothing would then close until the
    // scope did.
    const cachedClient = yield* SynchronizedRef.make(Option.none<LivenessNodeReader>());

    /**
     * Yields the shared client, connecting on the first call.
     *
     * @remarks
     *   A failure to build leaves the cache empty, so the next read tries again rather than inheriting a verdict taken
     *   once.
     *
     *   Uninterruptible, because the poll fails fast: when the sibling indexer read fails, the in-flight node read is
     *   interrupted. The client's acquire is uninterruptible on its own, so without this the interrupt would land
     *   between the acquire completing and the cache write — stranding a fully-built client on the sync-lifetime scope
     *   with the cache still empty, once per poll for as long as the indexer stays down. Deferring the interrupt past
     *   the write costs at most the build's own ten-second connection bound.
     */
    const client = (nodeURL: URL): Effect.Effect<LivenessNodeReader, NodeClientError.NodeClientError> =>
      Effect.uninterruptible(
        SynchronizedRef.modifyEffect(cachedClient, (current) =>
          Option.match(current, {
            onSome: (existing) => Effect.succeed([existing, current] as const),
            onNone: () =>
              makeNodeClient(nodeURL).pipe(
                // Extended into the outer scope, not the read's: the client has to outlive the read that built it.
                Scope.extend(scope),
                Effect.map((built) => [built, Option.some(built)] as const),
              ),
          }),
        ),
      );

    /** Resolves the shared client from the configured endpoint — the step both node reads start with. */
    const nodeReader = (): Effect.Effect<LivenessNodeReader, LivenessReadError | NodeClientError.NodeClientError> =>
      Option.match(parseNodeURL(config.nodeClientConnection.nodeURL), {
        onNone: (): Effect.Effect<URL, LivenessReadError> =>
          Effect.fail(readError(`Node endpoint is not a valid URL: ${config.nodeClientConnection.nodeURL}`, undefined)),
        onSome: Effect.succeed,
      }).pipe(Effect.flatMap((nodeURL) => client(nodeURL)));

    return {
      indexerHeight: () =>
        Effect.gen(function* () {
          const query = yield* BlockHash;
          const { block } = yield* query({ offset: null });

          // A freshly started indexer has ingested nothing, so there is no block to compare against.
          if (block === null || block === undefined) {
            return yield* new LivenessReadError({ message: 'Indexer reported no latest block' });
          }

          return yield* Option.match(parseIndexerHeight(block.height), {
            onNone: () =>
              Effect.fail(
                new LivenessReadError({
                  message: `Indexer reported an unusable block height: ${String(block.height)}`,
                }),
              ),
            onSome: Effect.succeed,
          });
        }).pipe(
          Effect.provide(HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl })),
          Effect.scoped,
          Effect.catchAll((cause) =>
            cause instanceof LivenessReadError
              ? Effect.fail(cause)
              : Effect.fail(readError('Failed to read the indexer’s latest block', cause)),
          ),
        ),

      finalizedHeight: () =>
        nodeReader().pipe(
          Effect.flatMap((reader) => reader.getFinalizedBlock()),
          Effect.map(({ height }) => height),
          // A bound on the whole read, not just the connection: a node that accepts a socket and then never answers would
          // otherwise stall the poll just as effectively as one that refuses it.
          Effect.timeoutFail({
            duration: NODE_CONNECTION_TIMEOUT,
            onTimeout: () => readError('Timed out reading the node’s finalized head', undefined),
          }),
          Effect.catchAll((cause) =>
            cause instanceof LivenessReadError
              ? Effect.fail(cause)
              : Effect.fail(readError('Failed to read the node’s finalized head', cause)),
          ),
        ),

      indexerGenesisHash: () =>
        Effect.gen(function* () {
          const query = yield* BlockHash;
          const { block } = yield* query({ offset: { height: 0 } });

          // An indexer that has ingested nothing has no genesis block to name — which chain it is on is not yet known.
          if (block === null || block === undefined) {
            return yield* new LivenessReadError({ message: 'Indexer reported no genesis block' });
          }

          return block.hash;
        }).pipe(
          Effect.provide(HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl })),
          Effect.scoped,
          Effect.catchAll((cause) =>
            cause instanceof LivenessReadError
              ? Effect.fail(cause)
              : Effect.fail(readError('Failed to read the indexer’s genesis block', cause)),
          ),
        ),

      nodeGenesisHash: () =>
        nodeReader().pipe(
          Effect.flatMap((reader) => reader.getGenesisHash()),
          // The hash itself is served from client state, but the first call builds the client — a connection that
          // must stay bounded like every other node read.
          Effect.timeoutFail({
            duration: NODE_CONNECTION_TIMEOUT,
            onTimeout: () => readError('Timed out reading the node’s genesis hash', undefined),
          }),
          Effect.catchAll((cause) =>
            cause instanceof LivenessReadError
              ? Effect.fail(cause)
              : Effect.fail(readError('Failed to read the node’s genesis hash', cause)),
          ),
        ),
    };
  });
