export interface SyncProgressData {
  readonly appliedId: bigint;
  readonly highestTransactionId: bigint;
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
    const applyLag = BigInt(Math.abs(Number(data.highestTransactionId - data.appliedId)));
    return data.isConnected && applyLag <= maxGap;
  },
};

export const createSyncProgress = (
  params: {
    appliedId?: bigint;
    highestTransactionId?: bigint;
    isConnected?: boolean;
  } = {},
): SyncProgress => {
  const { appliedId = 0n, highestTransactionId = 0n, isConnected = false } = params;

  const data: SyncProgressData = {
    appliedId,
    highestTransactionId,
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
