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
 * A simulated chain's protocol-version timeline.
 *
 * Which protocol version a chain is on, and when it changes, is the same question whichever ledger the chain runs — so
 * it is answered once here and shared by every simulator, rather than duplicated per ledger version.
 *
 * Nothing in this module refers to a ledger type. Functions are stated over the smallest structure they need
 * ({@link VersionTimeline}), which every simulator state satisfies.
 */

import { Function as EFunction } from 'effect';
import { type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';

/**
 * A protocol version scheduled to activate at a block height — a fork on the simulated chain.
 *
 * The version itself is always supplied by the caller: the protocol version of the real fork is not final, so nothing
 * in the simulator may assume a particular value.
 */
export type ScheduledFork = Readonly<{
  /** Height of the first block produced under {@link version}. */
  atBlock: bigint;
  /** Version that activates at {@link atBlock}. */
  version: ProtocolVersion.ProtocolVersion;
}>;

/**
 * The version-timeline part of a simulator state — the current version plus any scheduled activations.
 *
 * Every simulator state satisfies this structurally, so the functions below apply to all of them without knowing which
 * ledger the state's other fields belong to.
 */
export type VersionTimeline = Readonly<{
  protocolVersion: ProtocolVersion.ProtocolVersion;
  scheduledForks: readonly ScheduledFork[];
}>;

/** Get the protocol version the chain is currently on. */
export const getProtocolVersion = (timeline: VersionTimeline): ProtocolVersion.ProtocolVersion =>
  timeline.protocolVersion;

/**
 * Resolve the protocol version a block of the given height is produced under: the highest scheduled version whose
 * activation height has been reached, or the chain's current version when no schedule applies.
 *
 * Scheduling a version at a height the chain has already passed therefore activates it on the next block rather than
 * rewriting history — produced blocks keep the version they were produced under.
 *
 * @param timeline - Current version timeline
 * @param blockNumber - Height of the block being produced
 */
export const protocolVersionAt: {
  (blockNumber: bigint): (timeline: VersionTimeline) => ProtocolVersion.ProtocolVersion;
  (timeline: VersionTimeline, blockNumber: bigint): ProtocolVersion.ProtocolVersion;
} = EFunction.dual(2, (timeline: VersionTimeline, blockNumber: bigint): ProtocolVersion.ProtocolVersion =>
  timeline.scheduledForks.reduce(
    (version, fork) => (fork.atBlock <= blockNumber && fork.version > version ? fork.version : version),
    timeline.protocolVersion,
  ),
);

/**
 * Set the protocol version blocks produced from now on are stamped with. Already-produced blocks are untouched.
 *
 * @param state - Current simulator state
 * @param version - Version to switch the chain to
 */
export const setProtocolVersion = <TState extends VersionTimeline>(
  state: TState,
  version: ProtocolVersion.ProtocolVersion,
): TState => ({
  ...state,
  protocolVersion: version,
});

/**
 * Schedule a protocol version to activate at a block height — a fork on the simulated chain.
 *
 * @param state - Current simulator state
 * @param atBlock - Height of the first block produced under `version`
 * @param version - Version that activates at `atBlock`
 */
export const scheduleFork = <TState extends VersionTimeline>(
  state: TState,
  atBlock: bigint,
  version: ProtocolVersion.ProtocolVersion,
): TState => ({
  ...state,
  scheduledForks: [...state.scheduledForks, { atBlock, version }],
});
