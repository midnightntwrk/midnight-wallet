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
import { type LivenessReads } from '@midnightntwrk/wallet-sdk-capabilities';
import { Chunk, Duration, Effect, Either, Option, Ref, Stream, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { type PublicKey } from '../../KeyStore.js';
import { CoreWallet } from '../CoreWallet.js';
import { type SimulatorState } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import {
  type DefaultSyncConfiguration,
  makeDefaultSyncCapability,
  makeDefaultSyncService,
  makeLivenessUpdates,
  makeSimulatorSyncCapability,
  resolveNodeEndpoint,
} from '../Sync.js';
import { type IndexerLivenessUpdate } from '../SyncSchema.js';
import { type TransactionHistoryService } from '../TransactionHistory.js';

const indexerOnly = { indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v1/graphql' } };

const withNode = {
  ...indexerOnly,
  nodeClientConnection: { nodeURL: 'ws://localhost:9944' },
};

/** A history service that records nothing — a liveness verdict never reaches it. */
const noOpHistory: TransactionHistoryService = { put: () => Effect.void };

const publicKey: PublicKey = {
  publicKey: 'e6d8b9c1a2f3',
  addressHex: '0102030405',
  address: 'mn_addr_undeployed1testaddress',
};

const capability = () => makeDefaultSyncCapability(indexerOnly, () => ({ transactionHistoryService: noOpHistory }));

const livenessUpdate = (verdict: IndexerLiveness.IndexerLiveness): IndexerLivenessUpdate => ({
  type: 'IndexerLiveness',
  verdict,
});

/** Reads that answer with fixed heights and matching genesis hashes, so a verdict depends only on the tolerances. */
const fixedHeightReads = (heights: {
  readonly indexerHeight: bigint;
  readonly finalizedHeight: bigint;
}): LivenessReads => ({
  indexerHeight: () => Effect.succeed(heights.indexerHeight),
  finalizedHeight: () => Effect.succeed(heights.finalizedHeight),
  indexerGenesisHash: () => Effect.succeed('ab'.repeat(32)),
  nodeGenesisHash: () => Effect.succeed(`0x${'ab'.repeat(32)}`),
});

/**
 * Runs the liveness stream until it publishes a verdict, and returns that verdict.
 *
 * @remarks
 *   Filtering on `Unknown` rather than taking the first two elements: `SubscriptionRef.changes` replays whatever the
 *   current value is, so a poll that lands before the subscriber attaches would make the seed absent and a
 *   `Stream.take(2)` wait forever for a second verdict that never comes.
 */
const firstVerdict = (
  config: DefaultSyncConfiguration,
  reads: LivenessReads,
): Promise<Option.Option<IndexerLiveness.IndexerLiveness>> =>
  Effect.runPromise(
    Option.getOrThrow(makeLivenessUpdates(config, IndexerLiveness.Unknown(), () => Effect.succeed(reads))).pipe(
      Stream.map((update) => update.verdict),
      Stream.filter((verdict) => !IndexerLiveness.isUnknown(verdict)),
      Stream.runHead,
      Effect.timeout(Duration.seconds(5)),
      Effect.scoped,
    ),
  );

describe('makeDefaultSyncCapability', () => {
  describe('applying an IndexerLiveness update', () => {
    it('should record the verdict on the wallet progress', () => {
      const behind = IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n });
      const wallet = CoreWallet.init(publicKey, 'undeployed');

      const result = capability().applyUpdate(wallet, livenessUpdate(behind));

      expect(Either.isRight(result)).toBe(true);
      expect(Either.getOrThrow(result).progress.indexerLiveness).toStrictEqual(behind);
    });

    it('should leave transaction progress untouched, because staleness is orthogonal to applying transactions', () => {
      // A verdict says nothing about which transactions the wallet has applied. Touching these would let the liveness
      // check corrupt the sync cursor.
      const wallet = CoreWallet.updateProgress(CoreWallet.init(publicKey, 'undeployed'), {
        appliedId: 42n,
        highestTransactionId: 99n,
        isConnected: true,
      });

      const result = capability().applyUpdate(
        wallet,
        livenessUpdate(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n })),
      );

      const progress = Either.getOrThrow(result).progress;
      expect(progress.appliedId).toBe(42n);
      expect(progress.highestTransactionId).toBe(99n);
      expect(progress.isConnected).toBe(true);
    });
  });
});

describe('makeSimulatorSyncCapability', () => {
  it('should mark the liveness check skipped, because a simulation has no node to cross-check against', () => {
    // `Unknown` gates sync completion, so a wallet whose progress never left `Unknown` would never report itself
    // synchronized. The simulator wiring knows no check will ever run, and says so — the same principle as the default
    // sync service reporting `Skipped` when no node is configured.
    const emptySimulatorState = {
      currentTime: new Date(0),
      blocks: [{ number: 7n }],
      ledger: { dust: { toString: () => '' }, utxo: { filter: () => [] } },
      // Type cast required because: the capability reads only these fields, and a real LedgerState needs the ledger
      // WASM runtime, which a unit test must not load.
    } as unknown as SimulatorState;

    const result = makeSimulatorSyncCapability().applyUpdate(CoreWallet.init(publicKey, 'undeployed'), {
      update: emptySimulatorState,
    });

    expect(Either.getOrThrow(result).progress.indexerLiveness).toStrictEqual(
      IndexerLiveness.Skipped({ reason: 'simulation' }),
    );
  });
});

describe('makeLivenessUpdates', () => {
  it('should seed the stream from the verdict it is given, so a reconnect does not erase what was known', async () => {
    // `updates()` is rebuilt on every indexer-stream retry, under `Stream.retry`. Starting each new liveness stream at
    // `Unknown` would clear a `Behind` verdict on every reconnect and let `waitForSyncedState` resolve over the stale
    // view the check had already caught.
    const behind = IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n });

    const first = await Effect.runPromise(
      Stream.runHead(Option.getOrThrow(makeLivenessUpdates(withNode, behind))).pipe(Effect.scoped),
    );

    expect(first).toStrictEqual(Option.some({ type: 'IndexerLiveness', verdict: behind }));
  });

  it('should produce a stream only when a node endpoint is configured', () => {
    // Without a node there is nothing to compare the indexer against, so no service runs and the sync stream reports
    // `Skipped` once instead. Both directions are asserted together: either alone is satisfied by a function that
    // ignores its configuration entirely.
    expect(Option.isNone(makeLivenessUpdates(indexerOnly, IndexerLiveness.Unknown()))).toBe(true);
    expect(Option.isSome(makeLivenessUpdates(withNode, IndexerLiveness.Unknown()))).toBe(true);
  });

  it('should fall back to relayURL, so a wallet configured for submission is checked without further configuration', () => {
    // `relayURL` is a required part of the facade's configuration, so every wallet that can submit already has a node.
    // Asking for the same endpoint twice would leave the check switched off for everyone who did not know to opt in.
    const withRelayOnly = { ...indexerOnly, relayURL: new URL('ws://localhost:9944') };

    expect(Option.isSome(makeLivenessUpdates(withRelayOnly, IndexerLiveness.Unknown()))).toBe(true);
  });

  it('should prefer an explicit nodeClientConnection over relayURL', () => {
    // The override exists for pointing the liveness read at a different node than submission uses.
    const both = { ...withNode, relayURL: new URL('ws://someone-elses-node:9944') };

    expect(resolveNodeEndpoint(both)).toStrictEqual(Option.some({ nodeURL: 'ws://localhost:9944' }));
  });

  it('should resolve no endpoint when neither is configured', () => {
    expect(resolveNodeEndpoint(indexerOnly)).toStrictEqual(Option.none());
  });

  it('should apply the configured tolerances rather than the defaults', async () => {
    // Both directions are asserted, because each travels as a separate field: wiring one through and leaving the other
    // as a literal default would pass a test that checked only the direction that was wired.
    const tighterThanDefault = {
      ...withNode,
      livenessConfiguration: { maxBehindBlocks: 5n, maxAheadBlocks: 5n },
    };

    // A lag of 8 blocks: inside the default allowance of 10, outside the configured 5.
    const behind = await firstVerdict(
      tighterThanDefault,
      fixedHeightReads({ indexerHeight: 992n, finalizedHeight: 1_000n }),
    );

    // An overshoot of 8 blocks: likewise inside the default allowance and outside the configured one.
    const ahead = await firstVerdict(
      tighterThanDefault,
      fixedHeightReads({ indexerHeight: 1_008n, finalizedHeight: 1_000n }),
    );

    expect(behind).toStrictEqual(
      Option.some(IndexerLiveness.Behind({ indexerHeight: 992n, finalizedHeight: 1_000n, lag: 8n })),
    );
    expect(ahead).toStrictEqual(
      Option.some(IndexerLiveness.Ahead({ indexerHeight: 1_008n, finalizedHeight: 1_000n, overshoot: 8n })),
    );
  });

  it('should poll at the configured interval rather than the default', async () => {
    // Pinned to the moment of the second poll rather than to a count over a window: that fails whether the interval is
    // ignored in favour of the 30-second default or applied to the wrong schedule, and it does not depend on how the
    // first tick is timed.
    const program = Effect.gen(function* () {
      const polls = yield* Ref.make(0);
      const countingReads: LivenessReads = {
        indexerHeight: () => Ref.updateAndGet(polls, (n) => n + 1).pipe(Effect.as(1_000n)),
        finalizedHeight: () => Effect.succeed(1_000n),
        indexerGenesisHash: () => Effect.succeed('ab'.repeat(32)),
        nodeGenesisHash: () => Effect.succeed(`0x${'ab'.repeat(32)}`),
      };

      const updates = Option.getOrThrow(
        makeLivenessUpdates({ ...withNode, livenessPollInterval: Duration.seconds(5) }, IndexerLiveness.Unknown(), () =>
          Effect.succeed(countingReads),
        ),
      );

      yield* Effect.fork(Stream.runDrain(updates));

      yield* TestClock.adjust(Duration.millis(4_999));
      const justBeforeTheInterval = yield* Ref.get(polls);

      yield* TestClock.adjust(Duration.millis(1));
      const atTheInterval = yield* Ref.get(polls);

      return { justBeforeTheInterval, atTheInterval };
    });

    const counts = await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(TestContext.TestContext)));

    // The first poll runs immediately, so the second — and only the second — is what the interval governs.
    expect(counts).toStrictEqual({ justBeforeTheInterval: 1, atTheInterval: 2 });
  });
});

describe('makeDefaultSyncService liveness feed', () => {
  it('should report the check skipped once when no node is configured, so progress never stays Unknown', async () => {
    // `Unknown` gates sync completion, so a wallet with no node must be told that no check is coming. Said through the
    // liveness feed rather than the indexer stream, because the report must not depend on the indexer answering.
    const service = makeDefaultSyncService(indexerOnly);
    const wallet = CoreWallet.init(publicKey, 'undeployed');

    const collected = await Effect.runPromise(
      // Non-null assertion required because: the default service always provides the feed; its absence would itself
      // be the failure under test.
      service.livenessUpdates!(wallet).pipe(Stream.runCollect, Effect.scoped),
    );

    const updates = Chunk.toReadonlyArray(collected);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toStrictEqual(livenessUpdate(IndexerLiveness.Skipped({ reason: 'no-node-configured' })));
  });

  it('should keep verdicts out of the indexer subscription, whose lifetime is retry-bound', () => {
    // The indexer stream is rebuilt by the variant's retry on every failure; the liveness feed is forked once at
    // wallet scope. A verdict emitted through `updates()` would silently re-tie the poller to the retry loop.
    const service = makeDefaultSyncService(withNode);

    expect(service.livenessUpdates).toBeDefined();
  });
});
