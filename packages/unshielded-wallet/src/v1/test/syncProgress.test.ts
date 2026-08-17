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
import { describe, expect, it } from 'vitest';
import { createSyncProgress, SyncProgress, type SyncProgressData } from '../SyncProgress.js';

/** A fully caught-up, connected wallet. Only `indexerLiveness` varies across the tests below. */
const caughtUp = (indexerLiveness: IndexerLiveness.IndexerLiveness): SyncProgressData => ({
  appliedId: 100n,
  highestTransactionId: 100n,
  isConnected: true,
  indexerLiveness,
});

describe('SyncProgress', () => {
  describe('isCompleteWithin', () => {
    describe('when the indexer is behind the finalized head', () => {
      const behind = IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n });

      it('should return false even though the wallet has applied every transaction the indexer reported', () => {
        // The whole point of the check: the indexer's own report says "caught up", the chain says otherwise.
        const result = SyncProgress.isCompleteWithin(caughtUp(behind));

        expect(result).toBe(false);
      });

      it('should return false regardless of how generous maxGap is, because maxGap bounds apply lag, not staleness', () => {
        const result = SyncProgress.isCompleteWithin(caughtUp(behind), 1_000_000n);

        expect(result).toBe(false);
      });
    });

    describe('when the indexer and the node are on different networks', () => {
      it('should return false, because every height the indexer reports describes a different chain', () => {
        // Guards the wiring, not the predicate: completion must keep flowing through
        // `IndexerLiveness.blocksSyncCompletion`, where WrongNetwork gates, rather than enumerating variants here.
        const result = SyncProgress.isCompleteWithin(
          caughtUp(
            IndexerLiveness.WrongNetwork({
              indexerGenesisHash: 'aa'.repeat(32),
              nodeGenesisHash: `0x${'bb'.repeat(32)}`,
            }),
          ),
        );

        expect(result).toBe(false);
      });
    });

    describe('when the indexer claims a position ahead of the finalized head', () => {
      it('should return true, because an overshoot does not show the wallet to be looking at stale data', () => {
        // An overshoot cannot distinguish a wrong indexer from a node endpoint that has fallen behind. Blocking here
        // would report a healthy wallet as unsynchronized whenever its node lagged, so the verdict is surfaced on the
        // progress rather than used to gate completion.
        const result = SyncProgress.isCompleteWithin(
          caughtUp(
            IndexerLiveness.Ahead({ indexerHeight: 4_200_000n, finalizedHeight: 12_500n, overshoot: 4_187_500n }),
          ),
        );

        expect(result).toBe(true);
      });
    });

    describe('when no verdict on the indexer has been reached', () => {
      it('should return true when the check was skipped, so callers with no node endpoint still observe completion', () => {
        // Every existing caller configures no node endpoint. Gating on a verdict that can never arrive would leave
        // `waitForSyncedState` blocked forever.
        const result = SyncProgress.isCompleteWithin(
          caughtUp(IndexerLiveness.Skipped({ reason: 'no-node-configured' })),
        );

        expect(result).toBe(true);
      });

      it('should return false while the first check is still in flight, so startup cannot race past the check', () => {
        // The reverse was true at first — Unknown did not gate — and it left a hole: the indexer's first progress
        // update lands in under a second, while the first verdict needs a node connection and a metadata download.
        // In that window a wallet with a stalled indexer was connected, caught up with the indexer's own report, and
        // ungated — so `waitForSyncedState` resolved over exactly the stale view this check exists to catch. A wallet
        // with no node configured is not affected: its wiring reports `Skipped`, which does not gate.
        const result = SyncProgress.isCompleteWithin(caughtUp(IndexerLiveness.Unknown()));

        expect(result).toBe(false);
      });
    });

    describe('when the indexer agrees with the finalized head', () => {
      it('should return true', () => {
        const result = SyncProgress.isCompleteWithin(
          caughtUp(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n })),
        );

        expect(result).toBe(true);
      });

      it('should still return false when the wallet has not applied everything the indexer reported', () => {
        // A live indexer does not excuse the wallet from applying what it has been sent.
        const result = SyncProgress.isCompleteWithin({
          appliedId: 100n,
          highestTransactionId: 200n, // applyLag = 100, beyond the default maxGap of 50
          isConnected: true,
          indexerLiveness: IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }),
        });

        expect(result).toBe(false);
      });

      it('should still return false when disconnected', () => {
        const result = SyncProgress.isCompleteWithin({
          appliedId: 100n,
          highestTransactionId: 100n,
          isConnected: false,
          indexerLiveness: IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }),
        });

        expect(result).toBe(false);
      });
    });
  });

  describe('createSyncProgress', () => {
    it('should default to an unknown verdict, because this constructor cannot see whether a node is configured', () => {
      // Not `Skipped`: that claims "no node was configured", which this constructor has no way of knowing. A wallet
      // that does configure one would be misreported until its first verdict arrived, defeating the point of keeping
      // the two cases distinct. The sync wiring reports `Skipped` because it can see the configuration.
      const progress = createSyncProgress();

      expect(progress.indexerLiveness).toStrictEqual(IndexerLiveness.Unknown());
    });

    it('should carry a supplied verdict through to the created progress', () => {
      const verdict = IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n });

      const progress = createSyncProgress({
        appliedId: 100n,
        highestTransactionId: 100n,
        isConnected: true,
        indexerLiveness: verdict,
      });

      expect(progress.indexerLiveness).toStrictEqual(verdict);
    });
  });

  describe('isStrictlyComplete', () => {
    it('should return false when the indexer is behind, even with zero apply lag', () => {
      const progress = createSyncProgress({
        appliedId: 100n,
        highestTransactionId: 100n,
        isConnected: true,
        indexerLiveness: IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n }),
      });

      expect(progress.isStrictlyComplete()).toBe(false);
    });

    it('should return true when the indexer agrees with the finalized head and apply lag is zero', () => {
      const progress = createSyncProgress({
        appliedId: 100n,
        highestTransactionId: 100n,
        isConnected: true,
        indexerLiveness: IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }),
      });

      expect(progress.isStrictlyComplete()).toBe(true);
    });
  });
});
