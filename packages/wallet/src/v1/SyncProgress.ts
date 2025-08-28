export interface SyncProgressData {
  readonly appliedIndex: bigint;
  readonly highestRelevantWalletIndex: bigint;
  readonly highestIndex: bigint;
  readonly highestRelevantIndex: bigint;
}

export interface SyncProgressOps {
  isCompleteWithin(data: SyncProgressData, gap: bigint): boolean;
}

export interface SyncProgress extends SyncProgressData {
  isStrictlyComplete(): boolean;
  isCompleteWithin(gap: bigint): boolean;
}

export const SyncProgress: SyncProgressOps = {
  isCompleteWithin(data: SyncProgressData, gap: bigint): boolean {
    return (
      data.highestIndex > 0n && data.highestRelevantIndex > 0n && data.highestRelevantIndex - data.appliedIndex <= gap
    );
  },
};

export const createSyncProgress = (
  params: {
    appliedIndex?: bigint;
    highestRelevantWalletIndex?: bigint;
    highestIndex?: bigint;
    highestRelevantIndex?: bigint;
  } = {},
): SyncProgress => {
  const { appliedIndex = 0n, highestRelevantWalletIndex = 0n, highestIndex = 0n, highestRelevantIndex = 0n } = params;

  const data: SyncProgressData = {
    appliedIndex,
    highestRelevantWalletIndex,
    highestIndex,
    highestRelevantIndex,
  };

  return {
    ...data,

    isStrictlyComplete(): boolean {
      return SyncProgress.isCompleteWithin(this, 0n);
    },

    isCompleteWithin(gap: bigint): boolean {
      return SyncProgress.isCompleteWithin(this, gap);
    },
  };
};
