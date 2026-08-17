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
import { Data } from 'effect';

/**
 * Why an indexer liveness check did not produce a verdict.
 *
 * @remarks
 *   Modelled as a union rather than a bare boolean so that additional skip conditions can be introduced without a
 *   breaking change to {@link IndexerLiveness}.
 */
export type SkipReason = 'no-node-configured' | 'simulation';

/**
 * The result of cross-checking an indexer's reported position against a node's finalized head.
 *
 * @remarks
 *   An indexer reports its own progress, and nothing in that report is derived from consensus. A wallet that treats the
 *   report as authoritative reports itself fully synchronized over a stale view when the indexer is stalled, lagging,
 *   or withholding data. This type carries the outcome of an independent check against a node, so that "the indexer
 *   says it is caught up" can be told apart from "the indexer agrees with the finalized chain".
 *
 *   Only {@link IndexerLiveness.Behind} and {@link IndexerLiveness.WrongNetwork} are negative verdicts.
 *   {@link IndexerLiveness.Skipped} and {@link IndexerLiveness.Unknown} both mean "no verdict was reached", and must not
 *   gate sync completion — a caller that configured no node endpoint would otherwise never observe a synchronized
 *   wallet.
 */
export type IndexerLiveness = Data.TaggedEnum<{
  /** The check could not run at all. Carries no judgement about the indexer. */
  Skipped: { readonly reason: SkipReason };

  /** The check can run but has not yet produced its first verdict. */
  Unknown: {}; // eslint-disable-line @typescript-eslint/no-empty-object-type

  /**
   * The check is configured, but its most recent poll could not complete.
   *
   * @remarks
   *   Either read may be the one that failed — the node's finalized head or the indexer's latest block — or the poll as a
   *   whole may have timed out; `lastError` says which. A failed poll proves nothing about the indexer's own progress,
   *   so this verdict does not gate sync completion — a node outage must not make a wallet whose indexer is healthy
   *   report itself unsynchronized. It is a distinct variant rather than a reuse of {@link IndexerLiveness.Unknown} so
   *   that a misconfigured or dead endpoint is visible to the caller instead of being indistinguishable from a check
   *   that has not yet run. The protection this check provides degrades while polls fail, and this variant is how that
   *   degradation announces itself.
   */
  Unavailable: {
    /** How many consecutive polls have failed. */
    readonly consecutiveFailures: number;
    /** The message from the most recent failure. It names the read that failed, for diagnosis. */
    readonly lastError: string;
  };

  /** The indexer's position is within the accepted tolerance of the node's finalized head. */
  InSync: {
    /** The height of the latest block the indexer reports having processed. */
    readonly indexerHeight: bigint;
    /** The height of the node's highest finalized block. */
    readonly finalizedHeight: bigint;
  };

  /** The indexer's position trails the node's finalized head by more than the accepted tolerance. */
  Behind: {
    /** The height of the latest block the indexer reports having processed. */
    readonly indexerHeight: bigint;
    /** The height of the node's highest finalized block. */
    readonly finalizedHeight: bigint;
    /** How far the indexer trails the finalized head, in blocks. Always greater than the accepted tolerance. */
    readonly lag: bigint;
  };

  /**
   * The indexer claims a position further ahead of the node's finalized head than read skew can explain.
   *
   * @remarks
   *   The indexer ingests finalized blocks only — `subscribe_finalized_blocks` is its sole chain subscription — so its
   *   reported block is a finalized one and cannot legitimately run far ahead of a node's finalized head. The chains
   *   are already known to match by the time heights are compared (a mismatch is {@link IndexerLiveness.WrongNetwork}
   *   and pre-empts every height verdict), so a large overshoot means either a node endpoint whose finality lags — one
   *   restarting or resyncing — or an indexer reporting a height it cannot support. Without this variant,
   *   over-reporting would be a cost-free way to pass a liveness check.
   */
  Ahead: {
    /** The height of the latest block the indexer reports having processed. */
    readonly indexerHeight: bigint;
    /** The height of the node's highest finalized block. */
    readonly finalizedHeight: bigint;
    /** How far the indexer leads the finalized head, in blocks. Always greater than the accepted tolerance. */
    readonly overshoot: bigint;
  };

  /**
   * The indexer and the node report different genesis blocks: they are on different chains.
   *
   * @remarks
   *   Unlike {@link IndexerLiveness.Unavailable}, this cannot be transient. Both hashes were read successfully and differ,
   *   which proves at least one of the two endpoints points at another chain — and it will keep pointing there until
   *   reconfigured. Every height the indexer reports therefore describes a different chain, so height comparison is
   *   meaningless and this verdict gates sync completion (see {@link IndexerLiveness.blocksSyncCompletion}): an
   *   application waiting for sync must not proceed — and then submit — over data from the wrong network. Both hashes
   *   are carried as reported, so a diagnostic can show the operator exactly what each endpoint answered.
   */
  WrongNetwork: {
    /** The hash of the indexer's block at height zero, as the indexer reported it. */
    readonly indexerGenesisHash: string;
    /** The node's genesis hash, as the node reported it. */
    readonly nodeGenesisHash: string;
  };
}>;

const IndexerLiveness = Data.taggedEnum<IndexerLiveness>();

/** A type predicate that determines if a given value is an {@link IndexerLiveness.Skipped} enum variant. */
export const isSkipped = IndexerLiveness.$is('Skipped');

/** A type predicate that determines if a given value is an {@link IndexerLiveness.Unknown} enum variant. */
export const isUnknown = IndexerLiveness.$is('Unknown');

/** A type predicate that determines if a given value is an {@link IndexerLiveness.InSync} enum variant. */
export const isInSync = IndexerLiveness.$is('InSync');

/** A type predicate that determines if a given value is an {@link IndexerLiveness.Behind} enum variant. */
export const isBehind = IndexerLiveness.$is('Behind');

/** A type predicate that determines if a given value is an {@link IndexerLiveness.Ahead} enum variant. */
export const isAhead = IndexerLiveness.$is('Ahead');

/** A type predicate that determines if a given value is an {@link IndexerLiveness.Unavailable} enum variant. */
export const isUnavailable = IndexerLiveness.$is('Unavailable');

/** A type predicate that determines if a given value is an {@link IndexerLiveness.WrongNetwork} enum variant. */
export const isWrongNetwork = IndexerLiveness.$is('WrongNetwork');

export const { $match: match, Skipped, Unknown, InSync, Behind, Ahead, Unavailable, WrongNetwork } = IndexerLiveness;

/**
 * Decides whether two genesis-block hashes name the same chain.
 *
 * @remarks
 *   Presentation differs by source — a node reports its genesis hash `0x`-prefixed and lowercase, an indexer serves a
 *   plain hex string with no guaranteed prefix or case — so only the bytes may decide. A formatting difference reported
 *   as a wrong network would gate a correctly configured wallet forever.
 * @param left - One genesis-block hash, in any hex presentation.
 * @param right - The other genesis-block hash, in any hex presentation.
 * @returns `true` when both hashes carry the same bytes.
 */
export const sameGenesis = (left: string, right: string): boolean => normalizeHash(left) === normalizeHash(right);

/** Reduces a hex hash to bare lowercase digits, so presentation cannot influence a comparison. */
const normalizeHash = (hash: string): string => hash.toLowerCase().replace(/^0x/, '');

/**
 * Determines whether a verdict shows the indexer to be serving a stale view of the chain.
 *
 * @remarks
 *   It holds for {@link IndexerLiveness.Behind} alone. Only that verdict proves something about the data the wallet is
 *   using: the indexer is missing finalized blocks, so the wallet's view is genuinely out of date. Sync-completion
 *   checks gate on {@link blocksSyncCompletion} instead, which additionally holds for {@link IndexerLiveness.Unknown} —
 *   staleness proven and staleness not-yet-ruled-out are different statements, and this predicate makes only the
 *   first.
 * @example
 *   ```ts
 *   const knownStale = IndexerLiveness.indicatesStaleView(progress.indexerLiveness);
 *   ```;
 *
 * @param liveness - The verdict to test.
 * @returns `true` when the indexer is known to trail the finalized head beyond the accepted tolerance.
 */
export const indicatesStaleView = (liveness: IndexerLiveness): boolean => isBehind(liveness);

/**
 * Determines whether a verdict must keep a wallet from reporting itself synchronized.
 *
 * @remarks
 *   This is the predicate that sync-completion checks gate on, rather than testing for individual variants.
 *
 *   It holds for {@link IndexerLiveness.Behind}, which proves the wallet's view is out of date, and for
 *   {@link IndexerLiveness.Unknown}, which records that a check exists but has not yet reached its first verdict. The
 *   second matters because the first verdict needs a node connection and a metadata download — seconds — while the
 *   indexer's first progress update lands in well under one. If `Unknown` did not block, a wallet with a stalled
 *   indexer would report itself synchronized in exactly that window, over exactly the stale view the check exists to
 *   catch.
 *
 *   It deliberately does not hold for {@link IndexerLiveness.Skipped}: that variant means no verdict is ever coming, so
 *   blocking on it would leave every wallet without a node endpoint permanently unsynchronized — which is why `Skipped`
 *   and `Unknown` are distinct variants. Nor does it hold for {@link IndexerLiveness.Unavailable} — a failed poll proves
 *   nothing about the indexer's progress — or for {@link IndexerLiveness.Ahead}, which cannot distinguish a wrong
 *   indexer from a lagging node endpoint. Wrong-network deployments do gate, but through
 *   {@link IndexerLiveness.WrongNetwork}, whose genesis-hash comparison is deterministic where a height threshold could
 *   never be.
 * @example
 *   ```ts
 *   const canReportSynced = !IndexerLiveness.blocksSyncCompletion(progress.indexerLiveness);
 *   ```;
 *
 * @param liveness - The verdict to test.
 * @returns `true` when the wallet must not report itself synchronized under this verdict.
 */
export const blocksSyncCompletion = (liveness: IndexerLiveness): boolean =>
  isBehind(liveness) || isUnknown(liveness) || isWrongNetwork(liveness);

/**
 * Compares an indexer's reported block height against a node's finalized block height.
 *
 * @remarks
 *   The two tolerances are separate because they bound different things. `maxBehindBlocks` is a staleness allowance — how
 *   out-of-date a view a caller is willing to treat as current — and can be generous. `maxAheadBlocks` bounds read
 *   skew: the indexer ingests finalized blocks only, so it cannot legitimately lead a node's finalized head by more
 *   than the time between the two reads accounts for, and this value should stay small. A single shared tolerance would
 *   force a generous staleness allowance to also admit a large fabricated overshoot.
 * @example
 *   ```ts
 *   const verdict = IndexerLiveness.evaluate({
 *     indexerHeight: 1_000n,
 *     finalizedHeight: 1_030n,
 *     maxBehindBlocks: 10n,
 *     maxAheadBlocks: 2n,
 *   });
 *   // IndexerLiveness.Behind({ indexerHeight: 1000n, finalizedHeight: 1030n, lag: 30n })
 *   ```;
 *
 * @param params - The two heights to compare, and the tolerances to allow in each direction.
 * @param params.indexerHeight - The height of the latest block the indexer reports having processed.
 * @param params.finalizedHeight - The height of the node's highest finalized block.
 * @param params.maxBehindBlocks - How many blocks the indexer may trail the finalized head by and still count as in
 *   sync. `0n` requires the indexer to have reached the finalized head exactly.
 * @param params.maxAheadBlocks - How many blocks the indexer may lead the finalized head by and still count as in sync.
 *   `0n` admits no overshoot at all.
 * @returns {@link IndexerLiveness.Behind} When the indexer trails by more than `maxBehindBlocks`,
 *   {@link IndexerLiveness.Ahead} when it leads by more than `maxAheadBlocks`, and {@link IndexerLiveness.InSync}
 *   otherwise. Never {@link IndexerLiveness.Skipped} or {@link IndexerLiveness.Unknown}, which describe the absence of a
 *   check rather than its outcome.
 */
export const evaluate = ({
  indexerHeight,
  finalizedHeight,
  maxBehindBlocks,
  maxAheadBlocks,
}: {
  readonly indexerHeight: bigint;
  readonly finalizedHeight: bigint;
  readonly maxBehindBlocks: bigint;
  readonly maxAheadBlocks: bigint;
}): IndexerLiveness => {
  const lag = finalizedHeight - indexerHeight;
  const overshoot = -lag;

  return lag > maxBehindBlocks
    ? Behind({ indexerHeight, finalizedHeight, lag })
    : overshoot > maxAheadBlocks
      ? Ahead({ indexerHeight, finalizedHeight, overshoot })
      : InSync({ indexerHeight, finalizedHeight });
};

/**
 * Produces the verdict that follows an attempt to read the node failing.
 *
 * @remarks
 *   The consecutive-failure count is the only state a liveness check carries between polls, and this function is where it
 *   advances. It counts up while failures continue, so a caller can tell a single missed poll from a node that has been
 *   unreachable for a long time, and resets once any other verdict has intervened, so a fresh outage is not reported as
 *   a continuing one.
 * @example
 *   ```ts
 *   const next = IndexerLiveness.afterFailedPoll(previous, 'websocket closed');
 *   ```;
 *
 * @param previous - The verdict before this poll.
 * @param lastError - The message from the failure that just occurred.
 * @returns An {@link IndexerLiveness.Unavailable} verdict whose count continues the previous run of failures, or starts
 *   a new one.
 */
export const afterFailedPoll = (previous: IndexerLiveness, lastError: string): IndexerLiveness =>
  Unavailable({
    // Any other verdict means the node was reachable since the last failure, so this outage starts a fresh count.
    consecutiveFailures: isUnavailable(previous) ? previous.consecutiveFailures + 1 : 1,
    lastError,
  });
