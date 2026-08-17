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
import { describe, expect, it } from 'vitest';
import * as IndexerLiveness from '../IndexerLiveness.js';

/** Tolerances used throughout: a generous staleness allowance, and a tight bound on read skew. */
const tolerances = { maxBehindBlocks: 10n, maxAheadBlocks: 2n };

describe('IndexerLiveness', () => {
  describe('evaluate', () => {
    describe('when the indexer agrees with the finalized head', () => {
      it('should report InSync when the indexer is exactly at the finalized head', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 1_000n, finalizedHeight: 1_000n, ...tolerances });

        expect(result).toStrictEqual(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }));
      });

      it('should report InSync when the indexer trails by less than maxBehindBlocks', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 995n, finalizedHeight: 1_000n, ...tolerances });

        expect(result).toStrictEqual(IndexerLiveness.InSync({ indexerHeight: 995n, finalizedHeight: 1_000n }));
      });

      it('should report InSync when the indexer trails by exactly maxBehindBlocks', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 990n, finalizedHeight: 1_000n, ...tolerances });

        expect(result).toStrictEqual(IndexerLiveness.InSync({ indexerHeight: 990n, finalizedHeight: 1_000n }));
      });

      it('should report InSync when the indexer leads by exactly maxAheadBlocks, which read skew can explain', () => {
        // The indexer height and the finalized height are read at different moments, so a small lead is expected.
        const result = IndexerLiveness.evaluate({ indexerHeight: 1_002n, finalizedHeight: 1_000n, ...tolerances });

        expect(result).toStrictEqual(IndexerLiveness.InSync({ indexerHeight: 1_002n, finalizedHeight: 1_000n }));
      });
    });

    describe('when the indexer trails the finalized head', () => {
      it('should report Behind when the lag exceeds maxBehindBlocks by one block', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 989n, finalizedHeight: 1_000n, ...tolerances });

        expect(result).toStrictEqual(
          IndexerLiveness.Behind({ indexerHeight: 989n, finalizedHeight: 1_000n, lag: 11n }),
        );
      });

      it('should report Behind carrying both heights and the lag, so a caller can surface how stale the view is', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 1_000n, finalizedHeight: 5_000n, ...tolerances });

        expect(result).toStrictEqual(
          IndexerLiveness.Behind({ indexerHeight: 1_000n, finalizedHeight: 5_000n, lag: 4_000n }),
        );
      });
    });

    describe('when the indexer leads the finalized head', () => {
      it('should report Ahead when the overshoot exceeds maxAheadBlocks by one block', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 1_003n, finalizedHeight: 1_000n, ...tolerances });

        expect(result).toStrictEqual(
          IndexerLiveness.Ahead({ indexerHeight: 1_003n, finalizedHeight: 1_000n, overshoot: 3n }),
        );
      });

      it('should report Ahead for a height the finalized chain cannot support, rather than waving it through', () => {
        // The indexer ingests finalized blocks only, so it cannot legitimately be this far ahead. Reporting InSync here
        // would make over-reporting a cost-free way to pass the check.
        const result = IndexerLiveness.evaluate({
          indexerHeight: 999_999_999n,
          finalizedHeight: 1_000n,
          ...tolerances,
        });

        expect(result).toStrictEqual(
          IndexerLiveness.Ahead({ indexerHeight: 999_999_999n, finalizedHeight: 1_000n, overshoot: 999_998_999n }),
        );
      });

      it('should report Ahead when indexer and node are on different networks, a likely misconfiguration', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 4_200_000n, finalizedHeight: 12_500n, ...tolerances });

        expect(result).toStrictEqual(
          IndexerLiveness.Ahead({ indexerHeight: 4_200_000n, finalizedHeight: 12_500n, overshoot: 4_187_500n }),
        );
      });
    });

    describe('with zero tolerance in both directions', () => {
      const strict = { maxBehindBlocks: 0n, maxAheadBlocks: 0n };

      it('should report InSync only on exact agreement', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 1_000n, finalizedHeight: 1_000n, ...strict });

        expect(result).toStrictEqual(IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }));
      });

      it('should report Behind when the indexer trails by a single block', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 999n, finalizedHeight: 1_000n, ...strict });

        expect(result).toStrictEqual(IndexerLiveness.Behind({ indexerHeight: 999n, finalizedHeight: 1_000n, lag: 1n }));
      });

      it('should report Ahead when the indexer leads by a single block', () => {
        const result = IndexerLiveness.evaluate({ indexerHeight: 1_001n, finalizedHeight: 1_000n, ...strict });

        expect(result).toStrictEqual(
          IndexerLiveness.Ahead({ indexerHeight: 1_001n, finalizedHeight: 1_000n, overshoot: 1n }),
        );
      });
    });

    it('should never report Skipped or Unknown, which describe the absence of a check rather than its result', () => {
      const result = IndexerLiveness.evaluate({ indexerHeight: 1_000n, finalizedHeight: 1_000n, ...tolerances });

      expect(IndexerLiveness.isSkipped(result)).toBe(false);
      expect(IndexerLiveness.isUnknown(result)).toBe(false);
    });
  });

  describe('indicatesStaleView', () => {
    it('should hold for Behind, the one verdict that proves the wallet is looking at out-of-date data', () => {
      const verdict = IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n });

      expect(IndexerLiveness.indicatesStaleView(verdict)).toBe(true);
    });

    it('should not hold for Ahead, which cannot distinguish a wrong indexer from a lagging node', () => {
      // Gating on this would report a healthy wallet as unsynchronized whenever its node endpoint fell behind. The
      // verdict is still surfaced to callers; it just does not decide completion.
      const verdict = IndexerLiveness.Ahead({ indexerHeight: 5_000n, finalizedHeight: 1_000n, overshoot: 4_000n });

      expect(IndexerLiveness.indicatesStaleView(verdict)).toBe(false);
    });

    it('should not hold for InSync', () => {
      const verdict = IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n });

      expect(IndexerLiveness.indicatesStaleView(verdict)).toBe(false);
    });

    it('should not hold when the check was skipped, so a caller with no node endpoint is never judged', () => {
      const verdict = IndexerLiveness.Skipped({ reason: 'no-node-configured' });

      expect(IndexerLiveness.indicatesStaleView(verdict)).toBe(false);
    });

    it('should not hold before the first verdict arrives, so startup is not treated as staleness', () => {
      expect(IndexerLiveness.indicatesStaleView(IndexerLiveness.Unknown())).toBe(false);
    });

    it('should not hold when the node cannot be reached, so a node outage never stalls a healthy wallet', () => {
      // An unreachable node says nothing about the indexer. Gating here would make `waitForSyncedState` hang on a
      // wallet whose indexer data is correct.
      const verdict = IndexerLiveness.Unavailable({ consecutiveFailures: 12, lastError: 'websocket closed' });

      expect(IndexerLiveness.indicatesStaleView(verdict)).toBe(false);
    });
  });

  describe('blocksSyncCompletion', () => {
    it('should hold for Behind, which proves the wallet is looking at out-of-date data', () => {
      const verdict = IndexerLiveness.Behind({ indexerHeight: 900n, finalizedHeight: 1_000n, lag: 100n });

      expect(IndexerLiveness.blocksSyncCompletion(verdict)).toBe(true);
    });

    it('should hold for Unknown, so a check that has not run yet cannot be passed by racing it', () => {
      // The first verdict needs a node connection and a metadata download — seconds — while the indexer's first
      // progress update lands in well under one. If Unknown did not block, a wallet with a stalled indexer would
      // report itself synchronized in exactly that window, over exactly the stale view the check exists to catch.
      expect(IndexerLiveness.blocksSyncCompletion(IndexerLiveness.Unknown())).toBe(true);
    });

    it('should not hold when the check was skipped, so a caller with no node endpoint still completes', () => {
      // Skipped means no verdict is ever coming. Blocking on it would leave every node-less wallet permanently
      // unsynchronized — which is why Skipped and Unknown are distinct variants.
      const verdict = IndexerLiveness.Skipped({ reason: 'no-node-configured' });

      expect(IndexerLiveness.blocksSyncCompletion(verdict)).toBe(false);
    });

    it('should not hold when the node cannot be reached, so a node outage never stalls a healthy wallet', () => {
      const verdict = IndexerLiveness.Unavailable({ consecutiveFailures: 3, lastError: 'websocket closed' });

      expect(IndexerLiveness.blocksSyncCompletion(verdict)).toBe(false);
    });

    it('should not hold for InSync or Ahead', () => {
      expect(
        IndexerLiveness.blocksSyncCompletion(
          IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n }),
        ),
      ).toBe(false);
      expect(
        IndexerLiveness.blocksSyncCompletion(
          IndexerLiveness.Ahead({ indexerHeight: 5_000n, finalizedHeight: 1_000n, overshoot: 4_000n }),
        ),
      ).toBe(false);
    });

    it('should hold for WrongNetwork, because every height the indexer reports describes a different chain', () => {
      // Unlike Unavailable, a genesis mismatch cannot be transient: the hashes are read successfully and differ, which
      // proves one of the two endpoints points at another chain and will keep pointing there until reconfigured. An
      // application waiting for sync must not proceed — and then submit — over data from the wrong network.
      const verdict = IndexerLiveness.WrongNetwork({
        indexerGenesisHash: 'aa'.repeat(32),
        nodeGenesisHash: `0x${'bb'.repeat(32)}`,
      });

      expect(IndexerLiveness.blocksSyncCompletion(verdict)).toBe(true);
    });
  });

  describe('indicatesStaleView for WrongNetwork', () => {
    it('should not hold, because wrong-network data is not stale — it is from another chain entirely', () => {
      // `indicatesStaleView` answers "may this balance be missing recent funds?". Wrong-network data deserves its own,
      // louder message, which callers write by matching the variant — not the staleness one.
      const verdict = IndexerLiveness.WrongNetwork({
        indexerGenesisHash: 'aa'.repeat(32),
        nodeGenesisHash: `0x${'bb'.repeat(32)}`,
      });

      expect(IndexerLiveness.indicatesStaleView(verdict)).toBe(false);
    });
  });

  describe('sameGenesis', () => {
    it('should tolerate presentation differences, so a formatting mismatch is never reported as a wrong network', () => {
      // The node reports its genesis hash 0x-prefixed and lowercase; the indexer serves a plain hex string with no
      // guaranteed prefix or case. Only the bytes may decide.
      expect(IndexerLiveness.sameGenesis(`0x${'Ab'.repeat(32)}`, 'aB'.repeat(32))).toBe(true);
      expect(IndexerLiveness.sameGenesis('ab'.repeat(32), 'ab'.repeat(32))).toBe(true);
    });

    it('should reject different hashes regardless of formatting', () => {
      expect(IndexerLiveness.sameGenesis(`0x${'aa'.repeat(32)}`, `0x${'bb'.repeat(32)}`)).toBe(false);
      expect(IndexerLiveness.sameGenesis('aa'.repeat(32), 'bb'.repeat(32))).toBe(false);
    });
  });

  describe('afterFailedPoll', () => {
    it('should report a single failure when no failure preceded it', () => {
      const result = IndexerLiveness.afterFailedPoll(IndexerLiveness.Unknown(), 'websocket closed');

      expect(result).toStrictEqual(
        IndexerLiveness.Unavailable({ consecutiveFailures: 1, lastError: 'websocket closed' }),
      );
    });

    it('should count consecutive failures up, so a long outage is distinguishable from a missed poll', () => {
      const previous = IndexerLiveness.Unavailable({ consecutiveFailures: 11, lastError: 'websocket closed' });

      const result = IndexerLiveness.afterFailedPoll(previous, 'websocket closed');

      expect(result).toStrictEqual(
        IndexerLiveness.Unavailable({ consecutiveFailures: 12, lastError: 'websocket closed' }),
      );
    });

    it('should restart the count when another verdict intervened, so a fresh outage is not reported as a continuing one', () => {
      const previous = IndexerLiveness.InSync({ indexerHeight: 1_000n, finalizedHeight: 1_000n });

      const result = IndexerLiveness.afterFailedPoll(previous, 'connection refused');

      expect(result).toStrictEqual(
        IndexerLiveness.Unavailable({ consecutiveFailures: 1, lastError: 'connection refused' }),
      );
    });
  });
});
