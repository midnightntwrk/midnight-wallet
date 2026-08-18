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
import { NodeClientError } from '@midnightntwrk/wallet-sdk-node-client/effect';
import { Cause, Duration, Effect, Exit, Option, Ref } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  type LivenessNodeReader,
  makeDefaultLivenessReads,
  type NodeClientFactory,
  parseIndexerHeight,
} from '../livenessReads.js';

const failureTagOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? Option.map(Cause.failureOption(exit.cause), (error) => (error as { _tag?: string })._tag)
    : Option.none();

const reachableNode = {
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  nodeClientConnection: { nodeURL: 'ws://localhost:9944' },
};

/** A node client that answers the one call the liveness check makes, and nothing else. */
const stubReader: LivenessNodeReader = {
  getFinalizedBlock: () => Effect.succeed({ hash: '0xfinalized', height: 1_000n }),
  getGenesisHash: () => Effect.succeed(`0x${'ab'.repeat(32)}`),
};

describe('makeDefaultLivenessReads', () => {
  describe('reusing the node client across polls', () => {
    it('should build the client once and reuse it for every later read', async () => {
      // A client was built per read, repeating the full `ApiPromise` handshake — including the runtime metadata
      // download — every poll, to fetch two numbers. polkadot-js skips the metadata fetch on reconnect when the api is
      // already ready (`_loadMeta`), so one client reused across polls pays that cost once per wallet instead of once
      // every thirty seconds.
      const program = Effect.gen(function* () {
        const built = yield* Ref.make(0);
        const factory: NodeClientFactory = () => Ref.update(built, (n) => n + 1).pipe(Effect.as(stubReader));

        const reads = yield* makeDefaultLivenessReads(reachableNode, factory);
        const heights = yield* Effect.all([reads.finalizedHeight(), reads.finalizedHeight(), reads.finalizedHeight()]);

        return { built: yield* Ref.get(built), heights };
      });

      const result = await Effect.runPromise(Effect.scoped(program));

      expect(result).toStrictEqual({ built: 1, heights: [1_000n, 1_000n, 1_000n] });
    });

    it('should not build a client until the first read', async () => {
      // Building it where the sync stream is assembled would put a connection failure in that stream's acquire, so an
      // unreachable node at start-up would stop the wallet syncing instead of producing an `Unavailable` verdict — the
      // one thing this check must never do.
      const program = Effect.gen(function* () {
        const built = yield* Ref.make(0);
        const factory: NodeClientFactory = () => Ref.update(built, (n) => n + 1).pipe(Effect.as(stubReader));

        yield* makeDefaultLivenessReads(reachableNode, factory);

        return yield* Ref.get(built);
      });

      expect(await Effect.runPromise(Effect.scoped(program))).toBe(0);
    });

    it('should try again on a later read when building the client failed', async () => {
      // A node that is down when the first poll runs must not switch the check off for the rest of the session. Caching
      // the failure would do exactly that: every later poll would report `Unavailable` from a decision taken once,
      // never noticing the node come back.
      const program = Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const factory: NodeClientFactory = () =>
          Ref.updateAndGet(attempts, (n) => n + 1).pipe(
            Effect.flatMap((attempt) =>
              attempt === 1
                ? Effect.fail(new NodeClientError.ConnectionError({ message: 'node down' }))
                : Effect.succeed(stubReader),
            ),
          );

        const reads = yield* makeDefaultLivenessReads(reachableNode, factory);
        const first = yield* Effect.exit(reads.finalizedHeight());
        const second = yield* Effect.exit(reads.finalizedHeight());

        return { attempts: yield* Ref.get(attempts), firstFailed: Exit.isFailure(first), second };
      });

      const result = await Effect.runPromise(Effect.scoped(program));

      expect(result.attempts).toBe(2);
      expect(result.firstFailed).toBe(true);
      expect(result.second).toStrictEqual(Exit.succeed(1_000n));
    });

    it('should keep a client whose build outlived an abandoned poll, rather than stranding it and rebuilding', async () => {
      // The poll fails fast: when the indexer read fails, the in-flight node read is interrupted. A client build is
      // uninterruptible once its acquire has started, so the interrupt lands *between* the acquire completing and the
      // cache write — leaving the built client stranded (its release parked on the sync-lifetime scope, the cache
      // still empty) and the next poll building another. During an indexer outage that is one full handshake and one
      // stranded client per poll, without bound.
      const program = Effect.gen(function* () {
        const builds = yield* Ref.make(0);
        const factory: NodeClientFactory = () =>
          Effect.acquireRelease(
            // The sleep sits inside the acquire, which `acquireRelease` runs uninterruptibly — the same shape as the
            // real client's bounded connect. The interrupt below therefore arrives once the build is already done.
            Ref.update(builds, (n) => n + 1).pipe(
              Effect.zipRight(Effect.sleep(Duration.millis(50))),
              Effect.as(stubReader),
            ),
            () => Effect.void,
          );

        const reads = yield* makeDefaultLivenessReads(reachableNode, factory);

        // Interrupt the read mid-build, as the poll's fail-fast does when the indexer read errors first.
        yield* reads.finalizedHeight().pipe(Effect.timeout(Duration.millis(10)), Effect.ignore);
        yield* reads.finalizedHeight();

        return yield* Ref.get(builds);
      });

      expect(await Effect.runPromise(Effect.scoped(program))).toBe(1);
    });

    it('should release the client when the scope closes, rather than holding a socket open for the process', async () => {
      // The client now outlives a single read, so the scope it is created in is what bounds its life. Without a
      // finalizer the WebSocket would stay open after sync stopped.
      const program = Effect.gen(function* () {
        const released = yield* Ref.make(false);
        const factory: NodeClientFactory = () =>
          Effect.acquireRelease(Effect.succeed(stubReader), () => Ref.set(released, true));

        yield* Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* makeDefaultLivenessReads(reachableNode, factory);
            yield* reads.finalizedHeight();
          }),
        );

        return yield* Ref.get(released);
      });

      expect(await Effect.runPromise(program)).toBe(true);
    });
  });

  it('should serve the genesis hash through the same cached client as the finalized head', async () => {
    // The genesis hash is read once per wallet, on the first poll. Building a second client for it would repeat the
    // connection handshake the cache exists to avoid — both node reads must share the one client.
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const built = yield* Ref.make(0);
          const factory: NodeClientFactory = () => Ref.update(built, (n) => n + 1).pipe(Effect.as(stubReader));

          const reads = yield* makeDefaultLivenessReads(reachableNode, factory);
          yield* reads.finalizedHeight();
          const genesisHash = yield* reads.nodeGenesisHash();

          return { genesisHash, clientsBuilt: yield* Ref.get(built) };
        }),
      ),
    );

    expect(observed.genesisHash).toBe(`0x${'ab'.repeat(32)}`);
    expect(observed.clientsBuilt).toBe(1);
  });

  describe('when the node URL cannot be parsed', () => {
    it('should fail with a LivenessReadError rather than throwing, so a typo does not kill the poll loop', async () => {
      // `new URL('127.0.0.1:9944')` throws — omitting the scheme is an easy mistake. Thrown synchronously from the read,
      // it becomes a defect that stops the check permanently, which is the opposite of the visibility `Unavailable`
      // exists to provide.
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* makeDefaultLivenessReads({
              indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
              nodeClientConnection: { nodeURL: '127.0.0.1:9944' },
            });

            return yield* reads.finalizedHeight();
          }),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Option.getOrThrow(failureTagOf(exit))).toBe('LivenessReadError');
    });

    it('should not throw when the reads are merely constructed', () => {
      // Construction is once per wallet now rather than once per poll, but it is still where a `new URL` throw would
      // escape before any Effect could catch it.
      expect(() =>
        makeDefaultLivenessReads({
          indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
          nodeClientConnection: { nodeURL: 'not a url at all' },
        }),
      ).not.toThrow();
    });
  });
});

describe('parseIndexerHeight', () => {
  it('should accept a whole number', () => {
    expect(parseIndexerHeight(1_234)).toStrictEqual(Option.some(1_234n));
  });

  it('should accept zero, which is genesis and a legitimate answer', () => {
    expect(parseIndexerHeight(0)).toStrictEqual(Option.some(0n));
  });

  it('should reject a non-integral height, which BigInt would otherwise throw on', () => {
    // A hostile or broken indexer answering `1.5` would otherwise raise a RangeError inside the poll, killing it. The
    // check exists to catch a misbehaving indexer, so a misbehaving indexer must not be able to switch it off.
    expect(parseIndexerHeight(1.5)).toStrictEqual(Option.none());
  });

  it('should reject a negative height', () => {
    expect(parseIndexerHeight(-1)).toStrictEqual(Option.none());
  });

  it('should reject a value that is not a number at all', () => {
    expect(parseIndexerHeight(undefined)).toStrictEqual(Option.none());
    expect(parseIndexerHeight('12')).toStrictEqual(Option.none());
  });
});
