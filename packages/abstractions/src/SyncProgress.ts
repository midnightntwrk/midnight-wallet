// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
export interface SyncProgressData {
  readonly appliedIndex: bigint;
  readonly highestRelevantWalletIndex: bigint;
  readonly highestIndex: bigint;
  readonly highestRelevantIndex: bigint;
  readonly isConnected: boolean;
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
    const applyLag = BigInt(Math.abs(Number(data.highestRelevantWalletIndex - data.appliedIndex)));
    return data.isConnected && applyLag <= maxGap;
  },
};

export const createSyncProgress = (
  params: {
    appliedIndex?: bigint;
    highestRelevantWalletIndex?: bigint;
    highestIndex?: bigint;
    highestRelevantIndex?: bigint;
    isConnected?: boolean;
  } = {},
): SyncProgress => {
  const {
    appliedIndex = 0n,
    highestRelevantWalletIndex = 0n,
    highestIndex = 0n,
    highestRelevantIndex = 0n,
    isConnected = false,
  } = params;

  const data: SyncProgressData = {
    appliedIndex,
    highestRelevantWalletIndex,
    highestIndex,
    highestRelevantIndex,
    isConnected,
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
