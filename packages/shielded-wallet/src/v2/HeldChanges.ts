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
import type * as ledger from '@midnightntwrk/ledger-v9';
import { Option } from 'effect';

/** One transaction's changes to the wallet, with the protocol version they were applied under. */
export type RecordableChange = Readonly<{
  change: ledger.ZswapStateChanges;
  protocolVersion: number;
}>;

const joinChanges = (earlier: RecordableChange, later: RecordableChange): RecordableChange => ({
  protocolVersion: earlier.protocolVersion,
  change: {
    source: earlier.change.source,
    receivedCoins: [...earlier.change.receivedCoins, ...later.change.receivedCoins],
    spentCoins: [...earlier.change.spentCoins, ...later.change.spentCoins],
  },
});

/**
 * Splits a sync batch's changes into those complete enough to record and the one that may still grow.
 *
 * @remarks
 *   A transaction's events are contiguous but a sync batch can end inside them: a spend's input comes before its outputs,
 *   so a cut there leaves the spent coin in one batch and the change in the next. Only the batch's last transaction can
 *   be cut, and only while the wallet has not caught up with its source, so that one is held and joined with the head
 *   of the next batch when it shares its source. Recording it any earlier would let a reader see the transaction with
 *   half its coins.
 * @param held The change held back from the previous batch, if any.
 * @param batch This batch's changes, in chain order.
 * @param caughtUp Whether the wallet has applied every event its source holds, which completes every transaction.
 * @returns The changes to record now, and the one to hold until the next batch.
 */
export const releaseCompleteChanges = (
  held: Option.Option<RecordableChange>,
  batch: readonly RecordableChange[],
  caughtUp: boolean,
): readonly [readonly RecordableChange[], Option.Option<RecordableChange>] => {
  const joined = Option.match(held, {
    onNone: () => batch,
    onSome: (earlier) =>
      batch[0]?.change.source === earlier.change.source
        ? [joinChanges(earlier, batch[0]), ...batch.slice(1)]
        : [earlier, ...batch],
  });
  return caughtUp || joined.length === 0
    ? [joined, Option.none()]
    : [joined.slice(0, -1), Option.some(joined[joined.length - 1])];
};
