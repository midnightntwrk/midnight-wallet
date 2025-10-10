import { describe, it, expect } from 'vitest';
import { SyncProgress, type SyncProgressData } from '../SyncProgress.js';

describe('SyncProgress', () => {
  describe('isCompleteWithin', () => {
    describe('when connected', () => {
      it('should return true when applyLag is within default maxGap (50)', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 120n, // applyLag = 20
          highestIndex: 200n,
          highestRelevantIndex: 120n,
          isConnected: true,
        };

        const result = SyncProgress.isCompleteWithin(data);
        expect(result).toBe(true);
      });

      it('should return true when applyLag equals default maxGap (50)', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 150n, // applyLag = 50
          highestIndex: 200n,
          highestRelevantIndex: 150n,
          isConnected: true,
        };

        const result = SyncProgress.isCompleteWithin(data);
        expect(result).toBe(true);
      });

      it('should return false when applyLag exceeds default maxGap (50)', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 160n, // applyLag = 60
          highestIndex: 200n,
          highestRelevantIndex: 160n,
          isConnected: true,
        };

        const result = SyncProgress.isCompleteWithin(data);
        expect(result).toBe(false);
      });

      it('should return true when appliedIndex is greater than highestRelevantWalletIndex (negative applyLag)', () => {
        const data: SyncProgressData = {
          appliedIndex: 150n,
          highestRelevantWalletIndex: 100n, // applyLag = 50
          highestIndex: 200n,
          highestRelevantIndex: 100n,
          isConnected: true,
        };

        const result = SyncProgress.isCompleteWithin(data);
        expect(result).toBe(true);
      });

      it('should return true when indices are equal (applyLag = 0)', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 100n, // applyLag = 0
          highestIndex: 200n,
          highestRelevantIndex: 100n,
          isConnected: true,
        };

        const result = SyncProgress.isCompleteWithin(data);
        expect(result).toBe(true);
      });
    });

    describe('when not connected', () => {
      it('should return false even when applyLag is within default maxGap (50)', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 120n, // applyLag = 20
          highestIndex: 200n,
          highestRelevantIndex: 120n,
          isConnected: false,
        };

        const result = SyncProgress.isCompleteWithin(data);
        expect(result).toBe(false);
      });

      it('should return false when applyLag is zero but not connected', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 100n, // applyLag = 0
          highestIndex: 200n,
          highestRelevantIndex: 100n,
          isConnected: false,
        };

        const result = SyncProgress.isCompleteWithin(data);
        expect(result).toBe(false);
      });
    });

    describe('with custom maxGap parameter', () => {
      it('should respect custom maxGap when connected', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 120n, // applyLag = 20
          highestIndex: 200n,
          highestRelevantIndex: 120n,
          isConnected: true,
        };

        const resultWithSmallGap = SyncProgress.isCompleteWithin(data, 10n);
        const resultWithLargeGap = SyncProgress.isCompleteWithin(data, 30n);

        expect(resultWithSmallGap).toBe(false); // 20 > 10
        expect(resultWithLargeGap).toBe(true); // 20 <= 30
      });

      it('should return false with custom maxGap when not connected', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 120n, // applyLag = 20
          highestIndex: 200n,
          highestRelevantIndex: 120n,
          isConnected: false,
        };

        const result = SyncProgress.isCompleteWithin(data, 100n);
        expect(result).toBe(false);
      });

      it('should handle zero maxGap', () => {
        const data: SyncProgressData = {
          appliedIndex: 100n,
          highestRelevantWalletIndex: 100n, // applyLag = 0
          highestIndex: 200n,
          highestRelevantIndex: 100n,
          isConnected: true,
        };

        const result = SyncProgress.isCompleteWithin(data, 0n);
        expect(result).toBe(true); // 0 <= 0
      });
    });
  });
});
