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
 * The data the unshielded wallet's API speaks, in types the SDK owns.
 *
 * @remarks
 *   Everything here is plain data that both ledger versions report identically, so both variants are stated in these
 *   types and neither ledger version has to be named to read what an unshielded wallet emits. Each variant's tree
 *   re-exports them under the names it always had. Kept apart from `UnshieldedWalletAPI.ts`, which the package exports
 *   flat: these it exports under the wallet's name, as `UnshieldedWalletTypes`, because several of them —
 *   `TokenTransfer`, `UtxoWithMeta`, `SyncProgress` — are also another wallet's, or the abstractions'.
 */
import {
  type IndexerLiveness,
  TransactionHistoryStorage,
  type TokenType,
  type UnshieldedUtxo,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  type DefaultSubmissionConfiguration,
  type LivenessConfiguration,
} from '@midnightntwrk/wallet-sdk-capabilities';
import { type Signing } from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import { type Clock, SafeBigInt } from '@midnightntwrk/wallet-sdk-utilities';
import { type Duration, Option, Schema } from 'effect';

export interface UtxoMeta {
  readonly ctime: Date;
  readonly registeredForDustGeneration: boolean;
}

export type UtxoHash = string;

/**
 * An unshielded UTxO the wallet holds, with what it knows about it.
 *
 * @remarks
 *   Each variant holds these as its own `Data.Class`, over its own ledger version's `Utxo`; both fit this shape, which is
 *   all a reader needs.
 */
export type UtxoWithMeta = Readonly<{
  utxo: UnshieldedUtxo;
  meta: UtxoMeta;
}>;

export type Balances = Record<TokenType, bigint>;

export interface TokenTransfer {
  readonly amount: bigint;
  readonly type: TokenType;
  readonly receiverAddress: UnshieldedAddress;
}

/**
 * Signs one segment of a transaction, asynchronously, so that MPC and HSM signers fit as well as an in-process
 * keystore.
 *
 * @remarks
 *   Answers in the SDK's own signature shape — a scheme and its bytes — which is the shape a ledger-v8 variant lowers
 *   from, so one signer serves a wallet on either side of the boundary.
 */
export type SignSegment = (data: Uint8Array) => Promise<Signing.Signature>;
export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
  keepAlive?: number;
};

export type NodeClientConnection = {
  /** The node's WebSocket RPC endpoint, used only to read the finalized head. */
  nodeURL: string;
};

/**
 * The node transactions are submitted through, borrowed from the submission configuration as the default source of a
 * finalized head.
 *
 * @remarks
 *   Every wallet configured to submit already names a node, and demanding that same endpoint a second time would leave
 *   the cross-check switched off for anyone who did not know to opt in.
 *
 *   Taken from `DefaultSubmissionConfiguration` rather than redeclared, so that renaming or retyping the field there
 *   fails to compile here. Declared independently it would merely stop matching, and the check would go quiet — the
 *   class of silent failure this feature exists to prevent.
 */
type SubmissionNodeFallback = Partial<Pick<DefaultSubmissionConfiguration, 'relayURL'>>;

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
  /**
   * The clock the booking sweep expires against. Defaults to system time; inject one to pin the expiry boundary in a
   * test, or to follow a simulated chain.
   */
  clock?: Clock.Clock;
  /**
   * Where to read the node's finalized head, for cross-checking the indexer's reported position.
   *
   * @remarks
   *   Synchronizing needs a node as well as an indexer, and this is where sync says so. Optional only because a wallet
   *   may run without one, in which case no cross-check happens and the wallet reports {@link IndexerLiveness.Skipped}.
   *
   *   A wallet configured for transaction submission need not set it: the endpoint named by `relayURL` is used, so the
   *   same node is not configured twice. Set this to name the node explicitly — a wallet built without submission
   *   configuration has no `relayURL` to borrow.
   */
  nodeClientConnection?: NodeClientConnection;
  /**
   * How far the indexer may drift from the node's finalized head before the difference is reported.
   *
   * @remarks
   *   Defaults to the capabilities package's `DEFAULT_LIVENESS_CONFIGURATION`, whose tolerances suit a chain producing
   *   blocks seconds apart. Set this for a chain with a different block time, or to tighten the staleness allowance a
   *   caller is willing to treat as current.
   */
  livenessConfiguration?: LivenessConfiguration;
  /**
   * How often to compare the indexer against the node.
   *
   * @remarks
   *   Defaults to the capabilities package's `DEFAULT_POLL_INTERVAL`. Each poll costs one request to the indexer and one
   *   to a node the wallet does not own, so shortening this trades load for how quickly a stalled indexer is noticed.
   *   Polling faster than blocks are produced only re-reads the same block.
   *
   *   Polls never overlap: each one is awaited before the next tick is taken. An interval shorter than the time a read
   *   takes — a read of the node is given ten seconds before it is abandoned — therefore slows the effective cadence to
   *   the speed of the reads rather than running two at once.
   */
  livenessPollInterval?: Duration.DurationInput;
} & SubmissionNodeFallback;

/**
 * Decides which node endpoint the liveness check should read, if any.
 *
 * @remarks
 *   `nodeClientConnection` is sync's own statement of the node it needs, so it is preferred. A wallet configured for
 *   submission need not repeat that endpoint, so `relayURL` serves as the default. Only a wallet naming neither goes
 *   unchecked.
 * @param config - The sync configuration.
 * @returns The endpoint to read the finalized head from, or `Option.none` when the wallet names no node at all.
 */
export const resolveNodeEndpoint = (config: DefaultSyncConfiguration): Option.Option<NodeClientConnection> =>
  Option.orElse(Option.fromNullable(config.nodeClientConnection), () =>
    Option.map(Option.fromNullable(config.relayURL), (relayURL) => ({ nodeURL: relayURL.toString() })),
  );

export interface SyncProgressData {
  readonly appliedId: bigint;
  readonly highestTransactionId: bigint;
  readonly isConnected: boolean;
  /**
   * The outcome of cross-checking the indexer's reported position against a node's finalized head.
   *
   * @remarks
   *   `highestTransactionId` is a value the indexer reports about itself, so on its own it cannot distinguish a caught-up
   *   indexer from a stalled or withholding one. This field carries an independent verdict, and
   *   {@link SyncProgressOps.isCompleteWithin} refuses to report completion while that verdict blocks it — see
   *   {@link IndexerLiveness.blocksSyncCompletion} for which verdicts do.
   */
  readonly indexerLiveness: IndexerLiveness.IndexerLiveness;
}

export interface SyncProgressOps {
  isCompleteWithin(data: SyncProgressData, maxGap?: bigint): boolean;
}

export interface SyncProgress extends SyncProgressData {
  isStrictlyComplete(): boolean;
  isCompleteWithin(maxGap?: bigint): boolean;
}

const UtxoSchema = Schema.Struct({
  value: SafeBigInt.SafeBigInt,
  owner: Schema.String,
  tokenType: Schema.String,
  intentHash: Schema.String,
  outputIndex: Schema.Number,
});

export const UnshieldedSectionSchema = Schema.Struct({
  id: Schema.Number,
  createdUtxos: Schema.Array(UtxoSchema),
  spentUtxos: Schema.Array(UtxoSchema),
});

type UnshieldedSection = Schema.Schema.Type<typeof UnshieldedSectionSchema>;

/**
 * Merges two records of one transaction's unshielded section, the one being written taking precedence.
 *
 * @param existing The section already stored.
 * @param incoming The section being written.
 * @returns `existing`, with every field `incoming` records replaced by its value there.
 */
export const mergeUnshieldedSections = (
  existing: UnshieldedSection,
  incoming: UnshieldedSection,
): UnshieldedSection => ({
  ...existing,
  ...incoming,
});

/**
 * Unshielded entry schema. Extends the common entry shape with an optional `unshielded` section. Tightening — required
 * `unshielded` plus required `protocolVersion`/`status`/`timestamp` — happens at the writer-input type, not on the
 * stored shape. Fees are not unshielded's concern (dust pays them); unshielded never writes `fees`.
 */
export const UnshieldedTransactionHistoryEntrySchema = TransactionHistoryStorage.extendEntrySchema({
  unshielded: Schema.optional(UnshieldedSectionSchema),
});

export type UnshieldedTransactionHistoryEntry = Schema.Schema.Type<typeof UnshieldedTransactionHistoryEntrySchema>;

export type UnshieldedHistoryStorage =
  TransactionHistoryStorage.TransactionHistoryReader<TransactionHistoryStorage.TransactionHistoryEntryWithHash> &
    TransactionHistoryStorage.TransactionHistoryWriter<UnshieldedTransactionHistoryEntry>;
