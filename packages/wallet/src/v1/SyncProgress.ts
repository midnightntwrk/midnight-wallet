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
