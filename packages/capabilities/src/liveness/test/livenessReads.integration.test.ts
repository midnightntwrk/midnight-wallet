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
import { IndexerLiveness } from '@midnightntwrk/wallet-sdk-abstractions';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnightntwrk/wallet-sdk-utilities/testing';
import { Cause, Duration, Effect, Exit, Option, Schedule } from 'effect';
import { randomUUID } from 'node:crypto';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeDefaultLivenessReads } from '../livenessReads.js';
import { DEFAULT_LIVENESS_CONFIGURATION } from '../livenessService.js';

const timeoutMinutes = (minutes: number) => 1_000 * 60 * minutes;

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(['APP_INFRA_SECRET'], {
  additionalVars: { TESTCONTAINERS_UID: environmentId },
});

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose.yml')
  // Waiting for an indexed block matters: heights are only meaningful once the indexer has ingested something.
  .withWaitStrategy(`indexer_${environmentId}`, Wait.forLogMessage(/block indexed/))
  .withEnvironment(environmentVars);

describe('makeDefaultLivenessReads', () => {
  let startedEnvironment: StartedDockerComposeEnvironment | undefined = undefined;

  const liveReads = () => {
    const indexerPort = startedEnvironment?.getContainer(`indexer_${environmentId}`)?.getMappedPort(8088) ?? 8088;
    const nodePort = startedEnvironment?.getContainer(`node_${environmentId}`)?.getMappedPort(9944) ?? 9944;

    return makeDefaultLivenessReads({
      indexerClientConnection: { indexerHttpUrl: `http://127.0.0.1:${indexerPort}/api/v4/graphql` },
      nodeClientConnection: { nodeURL: `ws://127.0.0.1:${nodePort}` },
    });
  };

  beforeAll(async () => {
    startedEnvironment = await environment.up();
  }, timeoutMinutes(3));

  afterAll(async () => {
    await startedEnvironment?.down();
  }, timeoutMinutes(1));

  it(
    'should read the latest block height from a real indexer',
    async () => {
      // The wait strategy fires on the first indexed block, which is genesis at height 0, so the read is retried until
      // the chain has advanced. Retrying rather than accepting 0 keeps the assertion meaningful: a read that always
      // returned 0 would be indistinguishable from a broken one.
      const height = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* liveReads();

            // `Effect.repeat` yields the schedule's output — a repetition count — so the height is read again afterwards
            // rather than taken from the repeat, which would assert on the count instead.
            yield* reads
              .indexerHeight()
              .pipe(
                Effect.repeat({ until: (height) => height > 0n, schedule: Schedule.spaced(Duration.seconds(1)) }),
                Effect.timeout(Duration.seconds(45)),
              );
            return yield* reads.indexerHeight();
          }),
        ),
      );

      expect(height).toBeGreaterThan(0n);
    },
    timeoutMinutes(1),
  );

  it(
    'should read genesis hashes from both endpoints that compare as the same chain',
    async () => {
      // The comparison the WrongNetwork verdict rests on, run against real presentation: the node reports its genesis
      // hash 0x-prefixed, the indexer serves a plain hex string, and both containers share one chain — so
      // `sameGenesis` must hold. A unit test cannot prove the format assumptions; only the real services can.
      const hashes = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* liveReads();
            const indexerGenesisHash = yield* reads.indexerGenesisHash();
            const nodeGenesisHash = yield* reads.nodeGenesisHash();
            return { indexerGenesisHash, nodeGenesisHash };
          }),
        ),
      );

      expect(hashes.indexerGenesisHash).toMatch(/^(0x)?[0-9a-fA-F]{64}$/);
      expect(hashes.nodeGenesisHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(IndexerLiveness.sameGenesis(hashes.indexerGenesisHash, hashes.nodeGenesisHash)).toBe(true);
    },
    timeoutMinutes(1),
  );

  it(
    'should read the finalized block height from a real node',
    async () => {
      // Proves the two-step read works against a real node: `chain_getFinalizedHead`, then `chain_getHeader` at that
      // hash. A unit test with a stubbed api cannot show that the call shape is accepted.
      const exit = await Effect.runPromiseExit(
        Effect.scoped(Effect.flatMap(liveReads(), (reads) => reads.finalizedHeight())),
      );

      // Printing the cause on failure: "Failed to read the node's finalized head" alone is not diagnosable from CI.
      expect(Exit.isSuccess(exit) ? 'ok' : Cause.pretty(exit.cause)).toBe('ok');
      expect(Exit.isSuccess(exit) ? exit.value : 0n).toBeGreaterThan(0n);
    },
    timeoutMinutes(1),
  );

  it(
    'should read twice from one reused client, reconnecting between the reads',
    async () => {
      // The reason a cached client is safe at all. `getFinalizedBlock` disconnects when it finishes, so the second poll
      // reaches a client whose socket is closed and has to reconnect through `ensureConnection`. The unit tests stub the
      // client and so cannot exercise that path — this is the only check that a reused client survives its own
      // disconnect, which is what the whole caching change rests on.
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* liveReads();
            const first = yield* reads.finalizedHeight();
            const second = yield* reads.finalizedHeight();
            return { first, second };
          }),
        ),
      );

      expect(Exit.isSuccess(exit) ? 'ok' : Cause.pretty(exit.cause)).toBe('ok');
      const heights = Exit.isSuccess(exit) ? exit.value : { first: 0n, second: 0n };
      expect(heights.first).toBeGreaterThan(0n);
      // The chain advances, so the second read is at least the first. Equality is fine — two reads can land in one block.
      expect(heights.second).toBeGreaterThanOrEqual(heights.first);
    },
    timeoutMinutes(1),
  );

  it(
    'should find a healthy indexer and node in sync under the default tolerances',
    async () => {
      // The end-to-end claim. This is the only test that shows the two heights are on the same scale and describe the
      // same chain, and that the shipped tolerances suit a real network rather than only the numbers in the unit tests.
      const verdict = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { indexerHeight, finalizedHeight } = yield* liveReads();
            const [indexer, finalized] = yield* Effect.all([indexerHeight(), finalizedHeight()]);

            return IndexerLiveness.evaluate({
              indexerHeight: indexer,
              finalizedHeight: finalized,
              ...DEFAULT_LIVENESS_CONFIGURATION,
            });
          }),
        ),
      );

      // Asserting the tag rather than a predicate, so a failure reports which verdict was reached.
      expect(verdict._tag).toBe('InSync');
    },
    timeoutMinutes(1),
  );

  it(
    'should adapt a real node connection failure into a LivenessReadError',
    async () => {
      // The unit tests construct `LivenessReadError` by hand. This is the only check that a genuine `NodeClientError`
      // is adapted into one, which is the path that runs during an actual outage.
      const unreachable = makeDefaultLivenessReads({
        indexerClientConnection: { indexerHttpUrl: 'http://127.0.0.1:1/api/v4/graphql' },
        nodeClientConnection: { nodeURL: 'ws://127.0.0.1:1' },
      });

      const exit = await Effect.runPromiseExit(
        Effect.scoped(Effect.flatMap(unreachable, (reads) => reads.finalizedHeight())),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.isSome(failure)).toBe(true);
      expect(Option.getOrThrow(failure)._tag).toBe('LivenessReadError');
    },
    timeoutMinutes(1),
  );
});
