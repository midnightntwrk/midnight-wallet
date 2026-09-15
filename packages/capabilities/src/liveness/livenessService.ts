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
import { Cause, Data, Deferred, Duration, Effect, identity, Option, Stream, SubscriptionRef } from 'effect';

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
 * The reads a liveness check runs, supplied as a dictionary so that callers decide where each comes from: the two tips
 * it compares every poll, the block those tips share, and the two genesis hashes it compares once to establish that the
 * tips describe the same chain.
 *
 * @remarks
 *   Every read is required. A service is only started when a node endpoint is configured — when none is, no service runs
 *   at all and the progress keeps its {@link IndexerLiveness.Skipped} default. That is why no read is optional: a
 *   service that might have no node would have to represent, and handle, a state it should never be in.
 *
 *   The tips carry hashes as well as heights because a height alone proves nothing — it is a number the indexer chooses.
 *   The block at that height is what it cannot invent, so the check compares one block per poll: the newest one both
 *   endpoints claim to have passed.
 */
export type LivenessReads = {
  /** Reads the height and hash of the latest block the indexer reports having processed. */
  readonly indexerTip: () => Effect.Effect<IndexerLiveness.BlockRef, LivenessReadError>;
  /** Reads the height and hash of the node's highest finalized block. */
  readonly finalizedBlock: () => Effect.Effect<IndexerLiveness.BlockRef, LivenessReadError>;
  /**
   * Reads the hash of the indexer's block at a given height, or `Option.none` when it has none there.
   *
   * @remarks
   *   Called only for a height the indexer has just claimed to have passed, which is why absence is part of a verdict
   *   rather than a failure: an indexer that cannot serve a block it reports having ingested contradicts its own
   *   answer.
   */
  readonly indexerBlockHashAt: (height: bigint) => Effect.Effect<Option.Option<string>, LivenessReadError>;
  /**
   * Reads the hash of the node's block at a given height, or `Option.none` when it has none there.
   *
   * @remarks
   *   Called only for a height at or below the node's own finalized head, where a canonical chain always has a block — so
   *   absence says this node does not have the block being claimed, not that the read went wrong.
   */
  readonly nodeBlockHashAt: (height: bigint) => Effect.Effect<Option.Option<string>, LivenessReadError>;
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
   *   waiting on a clock. The returned effect cannot fail: a read that fails is folded into the verdict by
   *   {@link IndexerLiveness.afterFailedPoll} — {@link IndexerLiveness.Unavailable}, or a gating verdict kept as it is —
   *   because a check that gave up on its first network error would be useless against exactly the conditions it exists
   *   to detect.
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
 * What the one-time genesis comparison established.
 *
 * @remarks
 *   Only outcomes are named here. "Not yet compared" is not a value of this type but the empty `Deferred` that holds it,
 *   so a settled check can never be confused with a pending one. `Mismatch` carries its verdict rather than the hashes,
 *   so it is built exactly once — at the moment of proof — and every later poll republishes the same value, which the
 *   state stream's deduplication then collapses.
 */
type GenesisCheck = Data.TaggedEnum<{
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
  // The check settles once and is never rewritten. A `Deferred` enforces that where a `Ref` would only promise it: a
  // second completion is a no-op, and "not yet settled" is the empty `Deferred` rather than a sentinel value.
  readonly #genesisCheck: Deferred.Deferred<GenesisCheck>;

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
      Deferred.make<GenesisCheck>(),
    ]).pipe(Effect.map(([state, genesisCheck]) => new LivenessServiceImpl(state, reads, configuration, genesisCheck)));
  }

  private constructor(
    state: SubscriptionRef.SubscriptionRef<IndexerLiveness.IndexerLiveness>,
    reads: LivenessReads,
    configuration: LivenessConfiguration,
    genesisCheck: Deferred.Deferred<GenesisCheck>,
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
    // `changesWith` then drops a verdict that says nothing new. Every poll writes unconditionally, and each write fans
    // out into the wallet's full state stream — without this, a healthy idle wallet re-notified every subscriber once
    // per poll, forever. Structural equality would not do: the heights on `InSync`, `Behind` and `Ahead` advance with
    // the chain every poll, so consecutive verdicts are never structurally equal. `equivalent` compares what a caller
    // acts on — the kind, a `Behind`'s lag, `Unavailable`'s climbing count — so a lengthening outage or a growing lag
    // still reports, and a healthy idle wallet stays quiet.
    return this.#state.changes.pipe(Stream.changesWith(IndexerLiveness.equivalent));
  }

  startPolling(ticks: Stream.Stream<unknown>): Effect.Effect<void> {
    return Stream.runForEach(ticks, () => this.#poll());
  }

  /**
   * Compares the two heights once and publishes the result.
   *
   * @remarks
   *   The whole poll is folded into the verdict: `catchAllCause` hands a failed read to `afterFailedPoll`, so the
   *   returned effect has no error channel and the polling loop survives an unreachable node. `SubscriptionRef.update`
   *   reads the previous verdict inside the callback, which is what lets `afterFailedPoll` continue a run of failures —
   *   or keep a `Behind` that a failed poll cannot disprove — without a separate get-then-write race.
   */
  #poll(): Effect.Effect<void> {
    return this.#compareOnce().pipe(
      Effect.map((verdict) => () => verdict),
      // `disconnect` makes the deadline below a hard one. A timeout interrupts its loser and then waits for it, so a
      // read stuck inside an uninterruptible region — the node client's connection build is one, and cannot be made
      // otherwise without leaking the client it builds — would stretch the deadline to the read's own length. Disconnected,
      // the read is interrupted in the background instead: the verdict lands on time, and a build that does finish still
      // caches its client for the next poll.
      Effect.disconnect,
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
    // `poll` reads without waiting: an empty `Deferred` means the hashes have not yet been compared, so compare them now.
    return Deferred.poll(this.#genesisCheck).pipe(
      Effect.flatMap(Option.match({ onNone: () => this.#verifyGenesis(), onSome: identity })),
      Effect.flatMap(
        GenesisCheck.$match({
          Mismatch: ({ verdict }) => Effect.succeed(verdict),
          SameChain: () => this.#compareTips(),
        }),
      ),
    );
  }

  /** Reads both genesis hashes, settles the check, and caches the outcome. */
  #verifyGenesis(): Effect.Effect<GenesisCheck, LivenessReadError> {
    return Effect.all([this.#reads.indexerGenesisHash(), this.#reads.nodeGenesisHash()], { concurrency: 2 }).pipe(
      Effect.map(([indexerGenesisHash, nodeGenesisHash]) =>
        IndexerLiveness.sameBlockHash(indexerGenesisHash, nodeGenesisHash)
          ? GenesisCheck.SameChain()
          : GenesisCheck.Mismatch({
              // The genesis comparison is the height-zero case of the same block comparison every poll runs.
              verdict: IndexerLiveness.WrongNetwork({
                height: 0n,
                indexerBlockHash: Option.some(indexerGenesisHash),
                nodeBlockHash: Option.some(nodeGenesisHash),
              }),
            }),
      ),
      Effect.tap((check) => Deferred.succeed(this.#genesisCheck, check)),
    );
  }

  /**
   * Reads both tips, confirms they name the same block where they overlap, and reduces the heights to a verdict.
   *
   * @remarks
   *   Only one extra block is read per poll, and none at all when the two tips are already at the same height: the
   *   endpoint that trails is reporting the shared block as its own tip, so the only open question is what the endpoint
   *   that leads names there. Asking both would be a second round trip for an answer already in hand.
   */
  #compareTips(): Effect.Effect<IndexerLiveness.IndexerLiveness, LivenessReadError> {
    return Effect.all([this.#reads.indexerTip(), this.#reads.finalizedBlock()], { concurrency: 2 }).pipe(
      Effect.flatMap(([indexer, finalized]) =>
        this.#sharedBlockHash(indexer, finalized).pipe(
          Effect.map((sharedHash) =>
            IndexerLiveness.evaluateTips({
              indexer,
              finalized,
              sharedHash,
              maxBehindBlocks: this.#configuration.maxBehindBlocks,
              maxAheadBlocks: this.#configuration.maxAheadBlocks,
            }),
          ),
        ),
      ),
    );
  }

  /** Asks whichever endpoint is ahead what it names at the other's height; neither, when the two are level. */
  #sharedBlockHash(
    indexer: IndexerLiveness.BlockRef,
    finalized: IndexerLiveness.BlockRef,
  ): Effect.Effect<Option.Option<string>, LivenessReadError> {
    return indexer.height === finalized.height
      ? Effect.succeed(Option.none())
      : indexer.height > finalized.height
        ? this.#reads.indexerBlockHashAt(finalized.height)
        : this.#reads.nodeBlockHashAt(indexer.height);
  }
}
