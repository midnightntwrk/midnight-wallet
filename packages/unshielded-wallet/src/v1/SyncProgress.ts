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

export const SyncProgress: SyncProgressOps = {
  isCompleteWithin(data: SyncProgressData, maxGap: bigint = 50n): boolean {
    const applyLag = BigInt(Math.abs(Number(data.highestTransactionId - data.appliedId)));
    // `applyLag` only shows whether the wallet has kept up with the indexer; both of its terms come from the indexer, so
    // it cannot reveal an indexer that is itself stale. That is what the liveness verdict adds: `Behind` blocks because
    // staleness is proven, and `Unknown` blocks because it is not yet ruled out — the first verdict takes seconds, and
    // an ungated `Unknown` would let start-up race past the check over exactly the stale view it exists to catch.
    return data.isConnected && applyLag <= maxGap && !IndexerLiveness.blocksSyncCompletion(data.indexerLiveness);
  },
};

export const createSyncProgress = (
  params: {
    appliedId?: bigint;
    highestTransactionId?: bigint;
    isConnected?: boolean;
    indexerLiveness?: IndexerLiveness.IndexerLiveness;
  } = {},
): SyncProgress => {
  const {
    appliedId = 0n,
    highestTransactionId = 0n,
    isConnected = false,
    // `Unknown`, not `Skipped`: this constructor cannot see the sync configuration, so it does not know whether a node
    // was configured. Claiming `no-node-configured` here would misreport a wallet that has one, right up until the
    // first verdict arrives — and telling those apart is the entire reason the two cases are distinct. The sync wiring,
    // which does know, sets `Skipped`.
    indexerLiveness = IndexerLiveness.Unknown(),
  } = params;

  const data: SyncProgressData = {
    appliedId,
    highestTransactionId,
    isConnected,
    indexerLiveness,
  };

  return {
    ...data,

    isStrictlyComplete(): boolean {
      return SyncProgress.isCompleteWithin(this, 0n);
    },

    isCompleteWithin(maxGap?: bigint): boolean {
      return SyncProgress.isCompleteWithin(this, maxGap);
    },
  };
};
