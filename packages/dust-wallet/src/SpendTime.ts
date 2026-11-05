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
 * The time a Dust spend is dated at, shared by both variants because none of it depends on a ledger version.
 *
 * @remarks
 *   The node checks a Dust spend's proof against the Dust tree roots it recorded at the spend's time, and the proof is
 *   built from the wallet's local trees. So a spend is sound only when dated at a block whose roots the local trees
 *   hold, and recent enough that the node still accepts it.
 */
import { Data, Duration, Effect, Either, Option, pipe, Predicate, Schedule } from 'effect';

/** The commitment and generation tree roots of a Dust state, hex-encoded as the indexer reports a block's roots. */
export type DustTreeRoots = { readonly commitment: string; readonly generation: string };

/** A block as dating a spend needs it: where it is, when it was made, and the Dust roots it reports. */
export type RootedBlock = { readonly height: number; readonly timestamp: Date; readonly roots: DustTreeRoots };

/**
 * Why a block whose roots the local trees hold still could not date the spend.
 *
 * - `TooFarBehindNewest`: it is more than {@link MAX_OWN_BLOCK_LAG} behind the newest block.
 * - `GraceEndsBeforeTtl`: its Dust grace period ends before the transaction's TTL.
 */
export type OwnBlockRefusal = {
  readonly height: number;
  readonly reason: 'TooFarBehindNewest' | 'GraceEndsBeforeTtl';
};

/** The local Dust trees hold the roots of no block a spend could be dated at, so the spend must wait. */
export class DustTreesNotAtBlockError extends Data.TaggedError('DustTreesNotAtBlock')<{
  readonly blockHeight: number;
  readonly local: DustTreeRoots;
  readonly reported: DustTreeRoots;
  /** The wallet's own block, when it held the local roots but was refused, and why. */
  readonly ownBlockRefusal: Option.Option<OwnBlockRefusal>;
}> {}

/**
 * How far behind the newest block a wallet's own block may be and still date a spend.
 *
 * @remarks
 *   The node checks a spend's proof against the roots it recorded at the spend's time, and keeps past roots only for its
 *   global TTL, not for the Dust grace period. Mainnet's global TTL is days, but the ledger's built-in parameters set
 *   it to one hour, and the SDK cannot read it. An event-less sync pass lands every few seconds, so a block more than
 *   ten minutes old means sync has stalled; waiting for it is safer than naming roots the node may have dropped.
 */
export const MAX_OWN_BLOCK_LAG = Duration.minutes(10);

/**
 * When a spend is dated, and what vouches for that time.
 *
 * - `Given`: the caller passed the time.
 * - `AtBlock`: a block whose roots the local trees hold.
 * - `Unreported`: the newest block reports no roots, so nothing could be checked.
 */
export type SpendTime =
  | { readonly _tag: 'Given'; readonly time: Date }
  | { readonly _tag: 'AtBlock'; readonly time: Date; readonly height: number }
  | { readonly _tag: 'Unreported'; readonly time: Date; readonly height: number };

const reportsNoRoots = (roots: DustTreeRoots): boolean => roots.commitment === '' && roots.generation === '';

/** Whether the local trees hold exactly the roots `block` reports. */
export const holds = (local: DustTreeRoots, block: RootedBlock): boolean =>
  local.commitment === block.roots.commitment && local.generation === block.roots.generation;

/**
 * Picks the time to date a Dust spend at.
 *
 * @param local The local Dust trees' roots, which the spend's proof is built from.
 * @param tip The newest block.
 * @param ownBlock The block the wallet last verified its roots against, when its sync knows one.
 * @param gracePeriodSeconds How long after a spend's time the node still accepts it: it requires `ctime + grace >=
 *   tblock`, where `tblock` is the block that includes the transaction.
 * @param ttl The latest time the transaction can be included, so the latest `tblock`.
 * @param currentTime A time the caller gives; it is the caller's to vouch for and is used as it is.
 * @returns The newest block's time when the local trees hold its roots, or when it reports none (a source that cannot
 *   report roots); else the own block's time when the trees hold its roots, it is no more than {@link MAX_OWN_BLOCK_LAG}
 *   behind the newest block, and its grace period lasts until `ttl`; else a {@link DustTreesNotAtBlockError}, which
 *   names the own block's refusal when there was one.
 */
export const spendTimeAt = (
  local: DustTreeRoots,
  tip: RootedBlock,
  ownBlock: Option.Option<RootedBlock>,
  gracePeriodSeconds: number,
  ttl: Date,
  currentTime: Date | undefined,
): Either.Either<SpendTime, DustTreesNotAtBlockError> => {
  if (currentTime !== undefined) {
    return Either.right({ _tag: 'Given', time: currentTime });
  }
  if (reportsNoRoots(tip.roots)) {
    return Either.right({ _tag: 'Unreported', time: tip.timestamp, height: tip.height });
  }
  if (holds(local, tip)) {
    return Either.right({ _tag: 'AtBlock', time: tip.timestamp, height: tip.height });
  }
  const refusalOf = (block: RootedBlock): Option.Option<OwnBlockRefusal> => {
    if (tip.timestamp.getTime() - block.timestamp.getTime() > Duration.toMillis(MAX_OWN_BLOCK_LAG)) {
      return Option.some({ height: block.height, reason: 'TooFarBehindNewest' });
    }
    // The transaction may be included as late as `ttl`, so the block's grace period must last at least that long.
    return block.timestamp.getTime() + gracePeriodSeconds * 1000 < ttl.getTime()
      ? Option.some({ height: block.height, reason: 'GraceEndsBeforeTtl' })
      : Option.none();
  };
  const notAtBlock = (ownBlockRefusal: Option.Option<OwnBlockRefusal>) =>
    Either.left(new DustTreesNotAtBlockError({ blockHeight: tip.height, local, reported: tip.roots, ownBlockRefusal }));
  return pipe(
    ownBlock,
    Option.filter((block) => holds(local, block)),
    Option.match({
      onNone: () => notAtBlock(Option.none()),
      onSome: (block) =>
        pipe(
          refusalOf(block),
          Option.match({
            onNone: () => Either.right<SpendTime>({ _tag: 'AtBlock', time: block.timestamp, height: block.height }),
            onSome: (refusal) => notAtBlock(Option.some(refusal)),
          }),
        ),
    }),
  );
};

/**
 * How often balancing reads the newest block again while the local trees hold no usable block's roots, and for how
 * long.
 *
 * @remarks
 *   The event-based sync closes the gap within moments. The event-less sync applies the chain in passes, by default five
 *   seconds apart, and a wallet on it can usually date a spend at the block its last pass verified. Two minutes covers
 *   many passes at the default interval, after which the wallet is not keeping up and balancing fails.
 */
export const spendTimeRetrySchedule = pipe(Schedule.spaced(Duration.seconds(1)), Schedule.upTo(Duration.minutes(2)));

const isNotAtBlock = (error: unknown): error is DustTreesNotAtBlockError =>
  Predicate.isTagged(error, 'DustTreesNotAtBlock');

const describeRoots = (roots: DustTreeRoots): string =>
  `commitment ${roots.commitment || '(none)'}, generation ${roots.generation || '(none)'}`;

const describeRefusal = (refusal: OwnBlockRefusal): string =>
  refusal.reason === 'TooFarBehindNewest'
    ? `; block ${refusal.height} holds them but is too far behind the newest block`
    : `; block ${refusal.height} holds them but its Dust grace period ends before the transaction's TTL`;

/** Says which roots the local trees hold, which the block reports, and why the wallet's own block was refused. */
export const describeNotAtBlock = (error: DustTreesNotAtBlockError): string =>
  `the wallet's Dust trees hold ${describeRoots(error.local)}, but block ${error.blockHeight} reports ` +
  describeRoots(error.reported) +
  Option.match(error.ownBlockRefusal, { onNone: () => '', onSome: describeRefusal });

/**
 * Runs `attempt` again on {@link spendTimeRetrySchedule} while it fails because the local trees hold no usable block's
 * roots, and turns that failure, once the schedule is spent, into the caller's error.
 *
 * @param attempt One try at dating and building the spend; it must read the newest block afresh each time.
 * @param onExhausted Builds the caller's error from the last {@link DustTreesNotAtBlockError}.
 * @returns The attempt's result, its other failures unchanged, or `onExhausted`'s error.
 */
export const awaitTreesAtBlock = <A, E, R>(
  attempt: Effect.Effect<A, E | DustTreesNotAtBlockError, R>,
  onExhausted: (error: DustTreesNotAtBlockError) => E,
): Effect.Effect<A, E, R> =>
  pipe(
    attempt,
    Effect.tapError((error) =>
      isNotAtBlock(error) ? Effect.logDebug(`Waiting to date a Dust spend: ${describeNotAtBlock(error)}`) : Effect.void,
    ),
    Effect.retry({ schedule: spendTimeRetrySchedule, while: isNotAtBlock }),
    Effect.catchIf(isNotAtBlock, (error) => Effect.fail(onExhausted(error))),
  );

/** Logs that a spend was dated without a root check, which is expected only of a source that cannot report roots. */
export const warnIfUnchecked = (spendTime: SpendTime): Effect.Effect<void> =>
  spendTime._tag === 'Unreported'
    ? Effect.logWarning(
        `Dated a Dust spend at block ${spendTime.height} without checking its Dust roots, because the block reports ` +
          'none. A source that reports roots and stops will see its spends rejected.',
      )
    : Effect.void;
