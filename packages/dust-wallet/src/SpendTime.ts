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

/** The local Dust trees hold the roots of no block a spend could be dated at, so the spend must wait. */
export class DustTreesNotAtBlockError extends Data.TaggedError('DustTreesNotAtBlock')<{
  readonly blockHeight: number;
  readonly local: DustTreeRoots;
  readonly reported: DustTreeRoots;
}> {}

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
 * @param gracePeriodSeconds How far before the newest block the node still accepts a spend's time.
 * @param currentTime A time the caller gives; it is the caller's to vouch for and is used as it is.
 * @returns The newest block's time when the local trees hold its roots, or when it reports none (a source that cannot
 *   report roots); else the own block's time when the trees hold its roots and it is within the grace period of the
 *   newest; else a {@link DustTreesNotAtBlockError}.
 */
export const spendTimeAt = (
  local: DustTreeRoots,
  tip: RootedBlock,
  ownBlock: Option.Option<RootedBlock>,
  gracePeriodSeconds: number,
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
  const withinGrace = (block: RootedBlock): boolean =>
    tip.timestamp.getTime() - block.timestamp.getTime() <= gracePeriodSeconds * 1000;
  return pipe(
    ownBlock,
    Option.filter((block) => holds(local, block) && withinGrace(block)),
    Option.match({
      onSome: (block) => Either.right<SpendTime>({ _tag: 'AtBlock', time: block.timestamp, height: block.height }),
      onNone: () => Either.left(new DustTreesNotAtBlockError({ blockHeight: tip.height, local, reported: tip.roots })),
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

/** Says which roots the local trees hold and which the block reports, for logs and the final error. */
export const describeNotAtBlock = (error: DustTreesNotAtBlockError): string =>
  `the wallet's Dust trees hold ${describeRoots(error.local)}, but block ${error.blockHeight} reports ` +
  describeRoots(error.reported);

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
