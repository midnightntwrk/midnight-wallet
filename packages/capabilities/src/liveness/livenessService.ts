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
import { Cause, Data, Duration, Effect, Option, Ref, Stream, SubscriptionRef } from 'effect';

/**
 * A block height could not be read.
 *
 * @remarks
 *   The indexer and the node fail in their own vocabularies — a GraphQL error and a `NodeClientError` respectively. Each
 *   caller adapts its failure into this one type, so the service depends on neither and needs only what it actually
 *   uses: a message to report on an {@link IndexerLiveness.Unavailable} verdict.
 */
export class LivenessReadError extends Data.TaggedError('LivenessReadError')<{
  /** A short description of why the read failed, surfaced to callers for diagnosis. */
  readonly message: string;
  /** The underlying failure, retained for logging. */
  readonly cause?: unknown;
}> {}

/**
 * The reads a liveness check runs, supplied as a dictionary so that callers decide where each comes from: the two block
 * heights it compares every poll, and the two genesis hashes it compares once to establish that the heights describe
 * the same chain.
 *
 * @remarks
 *   Both reads are required. A service is only started when a node endpoint is configured — when none is, no service runs
 *   at all and the progress keeps its {@link IndexerLiveness.Skipped} default. That is why neither read is optional: a
 *   service that might have no node would have to represent, and handle, a state it should never be in.
 */
export type LivenessReads = {
  /** Reads the height of the latest block the indexer reports having processed. */
  readonly indexerHeight: () => Effect.Effect<bigint, LivenessReadError>;
  /** Reads the height of the node's highest finalized block. */
  readonly finalizedHeight: () => Effect.Effect<bigint, LivenessReadError>;
  /** Reads the hash of the indexer's block at height zero — the chain the indexer is indexing. */
  readonly indexerGenesisHash: () => Effect.Effect<string, LivenessReadError>;
  /** Reads the hash of the node's genesis block — the chain the node is on. */
  readonly nodeGenesisHash: () => Effect.Effect<string, LivenessReadError>;
};

/** How far apart the indexer and the node may be before the difference is reported. */
export type LivenessConfiguration = {
  /** How many blocks the indexer may trail the finalized head by and still count as in sync. */
  readonly maxBehindBlocks: bigint;
  /** How many blocks the indexer may lead the finalized head by and still count as in sync. */
  readonly maxAheadBlocks: bigint;
  /**
   * How long a single poll may run before it is abandoned and reported as {@link IndexerLiveness.Unavailable}.
   *
   * @remarks
   *   Defaults to {@link DEFAULT_POLL_TIMEOUT}. Polls run one at a time, so without this bound a read that hangs — an
   *   endpoint that accepts a connection and never answers — would stop the loop forever, freezing the verdict at
   *   whatever was published last. A hung read must not be able to switch the check off.
   */
  readonly pollTimeout?: Duration.Duration;
};

/**
 * The default bound on a single poll.
 *
 * @remarks
 *   Comfortably above the node read's own ten-second connection bound, and below the default poll interval, so an
 *   abandoned poll never delays the tick that follows it.
 */
export const DEFAULT_POLL_TIMEOUT = Duration.seconds(20);

/**
 * Tolerances sized against Midnight's 6-second block slots (the indexer pins `SLOT_DURATION` at 6000 ms).
 *
 * @remarks
 *   `maxBehindBlocks` is a staleness allowance: ten blocks is about a minute of chain time, generous enough that an
 *   indexer briefly catching up is not reported as stale. `maxAheadBlocks` absorbs read skew — the two heights are read
 *   at different moments — while staying far below the thousands of blocks that separate two different networks.
 */
export const DEFAULT_LIVENESS_CONFIGURATION: LivenessConfiguration = {
  maxBehindBlocks: 10n,
  maxAheadBlocks: 10n,
};

/**
 * How often to compare the indexer against the node, by default.
 *
 * @remarks
 *   Deliberately unhurried. Each poll costs a request to a node the wallet does not own, a stalled indexer is a
 *   slow-developing condition, and polling faster than blocks are produced only re-reads the same block. At Midnight's
 *   6-second slots, half a minute is about five blocks, and it surfaces a stalled indexer well within the time any
 *   caller would notice.
 */
export const DEFAULT_POLL_INTERVAL = Duration.seconds(30);

export type LivenessService = {
  /**
   * Consumes `ticks`, comparing the indexer against the node once per tick and publishing the verdict.
   *
   * @remarks
   *   Ticks are supplied by the caller rather than generated here, so that tests drive the loop directly instead of
   *   waiting on a clock. The returned effect cannot fail: a read that fails becomes an
   *   {@link IndexerLiveness.Unavailable} verdict, because a check that gave up on its first network error would be
   *   useless against exactly the conditions it exists to detect.
   */
  readonly startPolling: (ticks: Stream.Stream<unknown>) => Effect.Effect<void>;
  /** The current verdict, followed by each subsequent one. */
  readonly state: () => Stream.Stream<IndexerLiveness.IndexerLiveness>;
};

/**
 * Reduces a failed poll to one line for {@link IndexerLiveness.Unavailable}'s `lastError`.
 *
 * @remarks
 *   That string is shown to whoever is diagnosing a stalled wallet, so it stays a message rather than a rendered cause: a
 *   stack trace is noise at that surface. Defects are labelled as unexpected, because unlike a read failure they
 *   indicate a bug rather than an unreachable node.
 */
const describeFailure = (cause: Cause.Cause<LivenessReadError>): string =>
  Option.match(Cause.failureOption(cause), {
    onSome: (error) => error.message,
    onNone: () =>
      Option.match(Cause.dieOption(cause), {
        onSome: (defect) =>
          `Unexpected failure while reading: ${defect instanceof Error ? defect.message : String(defect)}`,
        onNone: () => 'Unexpected failure while reading',
      }),
  });

/**
 * What the one-time genesis comparison has established.
 *
 * @remarks
 *   `Mismatch` carries its verdict rather than the hashes, so it is built exactly once — at the moment of proof — and
 *   every later poll republishes the same value, which the state stream's deduplication then collapses.
 */
type GenesisCheck = Data.TaggedEnum<{
  /** No successful comparison yet: the hashes have not both been read. */
  Unverified: {}; // eslint-disable-line @typescript-eslint/no-empty-object-type
  /** Both endpoints reported the same genesis block; heights are comparable. */
  SameChain: {}; // eslint-disable-line @typescript-eslint/no-empty-object-type
  /** The endpoints are on different chains; the verdict is pinned for the service's lifetime. */
  Mismatch: { readonly verdict: IndexerLiveness.IndexerLiveness };
}>;
const GenesisCheck = Data.taggedEnum<GenesisCheck>();

export class LivenessServiceImpl implements LivenessService {
  readonly #state: SubscriptionRef.SubscriptionRef<IndexerLiveness.IndexerLiveness>;
  readonly #reads: LivenessReads;
  readonly #configuration: LivenessConfiguration;
  // A plain `Ref` read at the top of a poll and written mid-poll — not a race, because polls run strictly one at a
  // time: `startPolling` awaits each poll before taking the next tick.
  readonly #genesisCheck: Ref.Ref<GenesisCheck>;

  /**
   * Creates a service whose verdict starts as {@link IndexerLiveness.Unknown} — a check exists but has not yet run.
   *
   * @param reads - Where the two heights come from.
   * @param configuration - The tolerances to apply, and the bound on a single poll.
   * @param initialVerdict - The verdict to start from. Callers that rebuild the service mid-session pass the verdict
   *   they already hold, so a reconnect does not erase a `Behind` the check had already reached — starting afresh at
   *   `Unknown` would hand back a stale-view answer the moment the gate re-opened.
   * @returns An effect yielding the service.
   */
  static make(
    reads: LivenessReads,
    configuration: LivenessConfiguration = DEFAULT_LIVENESS_CONFIGURATION,
    initialVerdict: IndexerLiveness.IndexerLiveness = IndexerLiveness.Unknown(),
  ): Effect.Effect<LivenessServiceImpl> {
    return Effect.all([
      SubscriptionRef.make<IndexerLiveness.IndexerLiveness>(initialVerdict),
      Ref.make<GenesisCheck>(GenesisCheck.Unverified()),
    ]).pipe(Effect.map(([state, genesisCheck]) => new LivenessServiceImpl(state, reads, configuration, genesisCheck)));
  }

  private constructor(
    state: SubscriptionRef.SubscriptionRef<IndexerLiveness.IndexerLiveness>,
    reads: LivenessReads,
    configuration: LivenessConfiguration,
    genesisCheck: Ref.Ref<GenesisCheck>,
  ) {
    this.#state = state;
    this.#reads = reads;
    this.#configuration = configuration;
    this.#genesisCheck = genesisCheck;
  }

  state(): Stream.Stream<IndexerLiveness.IndexerLiveness> {
    // `changes` already replays the current value before subsequent ones, under the ref's own semaphore. Prepending a
    // separate `get` would emit the first verdict twice — and read it outside that semaphore.
    //
    // `Stream.changes` then drops consecutive equal verdicts. Every poll writes unconditionally, and each write fans
    // out into the wallet's full state stream — without this, a healthy idle wallet re-notified every subscriber once
    // per poll, forever. Verdicts are structural data, so a lengthening outage still reports: `Unavailable`'s failure
    // count climbs, which makes consecutive verdicts unequal.
    return this.#state.changes.pipe(Stream.changes);
  }

  startPolling(ticks: Stream.Stream<unknown>): Effect.Effect<void> {
    return Stream.runForEach(ticks, () => this.#poll());
  }

  /**
   * Compares the two heights once and publishes the result.
   *
   * @remarks
   *   The whole poll is folded into the verdict: `catchAll` converts a failed read into an `Unavailable` verdict, so the
   *   returned effect has no error channel and the polling loop survives an unreachable node. `SubscriptionRef.update`
   *   reads the previous verdict inside the callback, which is what lets `afterFailedPoll` continue a run of failures
   *   without a separate get-then-write race.
   */
  #poll(): Effect.Effect<void> {
    return this.#compareOnce().pipe(
      Effect.map((verdict) => () => verdict),
      // A bound on the whole poll, not only on the reads' own deadlines: polls run one at a time, so a read that hangs
      // — an endpoint that accepts a connection and never answers — would otherwise stop the loop forever, freezing
      // the verdict at whatever was published last. A hung read must not be able to switch the check off.
      Effect.timeoutFail({
        duration: this.#configuration.pollTimeout ?? DEFAULT_POLL_TIMEOUT,
        onTimeout: () => new LivenessReadError({ message: 'Poll abandoned: a read did not complete in time' }),
      }),
      // `catchAllCause`, not `catchAll`: a read can die as well as fail — an unparsed URL, a payload that is not the
      // shape it claims — and a defect would kill the poll fibre outright. The verdict would then freeze at whatever
      // was written last, which at start-up is `Unknown` and never gates, leaving an indexer able to switch off the
      // check simply by answering badly.
      Effect.catchAllCause((cause) =>
        Effect.succeed((previous: IndexerLiveness.IndexerLiveness) =>
          IndexerLiveness.afterFailedPoll(previous, describeFailure(cause)),
        ),
      ),
      Effect.flatMap((nextVerdict) => SubscriptionRef.update(this.#state, nextVerdict)),
    );
  }

  /**
   * Runs one comparison: the chain identity first, then the heights.
   *
   * @remarks
   *   Height comparison is meaningful only between endpoints on the same chain, so no height verdict is published until
   *   the genesis hashes have been read once and found to match. A mismatch pins {@link IndexerLiveness.WrongNetwork}
   *   for the service's lifetime — neither endpoint changes chain until reconfigured, and reconfiguring builds a new
   *   wallet — while a match is cached so the hashes are read exactly once. A _failed_ hash read proves nothing about
   *   which chain anyone is on, so it caches nothing: it surfaces through the ordinary `Unavailable` path and the next
   *   poll tries the hashes again.
   */
  #compareOnce(): Effect.Effect<IndexerLiveness.IndexerLiveness, LivenessReadError> {
    return Ref.get(this.#genesisCheck).pipe(
      Effect.flatMap(
        GenesisCheck.$match({
          Mismatch: ({ verdict }) => Effect.succeed(verdict),
          SameChain: () => this.#compareHeights(),
          Unverified: () =>
            this.#verifyGenesis().pipe(
              Effect.flatMap(
                GenesisCheck.$match({
                  Mismatch: ({ verdict }) => Effect.succeed(verdict),
                  SameChain: () => this.#compareHeights(),
                  // Unreachable: #verifyGenesis only ever returns a settled check. Comparing heights anyway keeps the
                  // match total without inventing an error for a state that cannot occur.
                  Unverified: () => this.#compareHeights(),
                }),
              ),
            ),
        }),
      ),
    );
  }

  /** Reads both genesis hashes, settles the check, and caches the outcome. */
  #verifyGenesis(): Effect.Effect<GenesisCheck, LivenessReadError> {
    return Effect.all([this.#reads.indexerGenesisHash(), this.#reads.nodeGenesisHash()], { concurrency: 2 }).pipe(
      Effect.map(([indexerGenesisHash, nodeGenesisHash]) =>
        IndexerLiveness.sameGenesis(indexerGenesisHash, nodeGenesisHash)
          ? GenesisCheck.SameChain()
          : GenesisCheck.Mismatch({ verdict: IndexerLiveness.WrongNetwork({ indexerGenesisHash, nodeGenesisHash }) }),
      ),
      Effect.tap((check) => Ref.set(this.#genesisCheck, check)),
    );
  }

  /** Reads both heights and reduces them to a verdict under the configured tolerances. */
  #compareHeights(): Effect.Effect<IndexerLiveness.IndexerLiveness, LivenessReadError> {
    return Effect.all([this.#reads.indexerHeight(), this.#reads.finalizedHeight()], { concurrency: 2 }).pipe(
      Effect.map(([indexerHeight, finalizedHeight]) =>
        IndexerLiveness.evaluate({
          indexerHeight,
          finalizedHeight,
          maxBehindBlocks: this.#configuration.maxBehindBlocks,
          maxAheadBlocks: this.#configuration.maxAheadBlocks,
        }),
      ),
    );
  }
}
