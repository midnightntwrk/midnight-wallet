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

/** A sync batch's changes, with the transactions of the first and last events it applied. */
export type AppliedBatch = Readonly<{
  /** The batch's changes, in chain order. */
  changes: readonly RecordableChange[];
  /** The transaction of the first event the batch applied, if it applied any. */
  firstAppliedSource: Option.Option<string>;
  /** The transaction of the last event the batch applied, if it applied any. */
  lastAppliedSource: Option.Option<string>;
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
 *   so a cut there leaves the spent coin in one batch and the change in the next. Only the transaction of the last
 *   event applied can have been cut, so a change is held only when it belongs to that transaction and the wallet is not
 *   yet complete; the next batch then either continues the transaction, and its head change is joined on, or applies
 *   another transaction's event first, which proves the held one ended. A batch that applies nothing proves nothing, so
 *   a held change stays held across it. Recording a cut transaction any earlier would let a reader see it with half its
 *   coins.
 * @param held The change held back from the previous batch, if any.
 * @param applied This batch's changes, in chain order, with the transactions of its first and last applied events.
 * @param complete Whether nothing more of any applied transaction can follow: the wallet has applied every event its
 *   source holds, or the source has moved past this variant's protocol versions, which no transaction spans.
 * @returns The changes to record now, and the one to hold until the next batch.
 */
export const releaseCompleteChanges = (
  held: Option.Option<RecordableChange>,
  applied: AppliedBatch,
  complete: boolean,
): readonly [readonly RecordableChange[], Option.Option<RecordableChange>] => {
  const batch = applied.changes;
  const joined = Option.match(held, {
    onNone: () => batch,
    onSome: (earlier) =>
      batch[0]?.change.source === earlier.change.source
        ? [joinChanges(earlier, batch[0]), ...batch.slice(1)]
        : [earlier, ...batch],
  });
  // A batch that applied nothing leaves the held change's transaction as the last one the wallet has seen.
  const lastSeenSource = Option.orElse(applied.lastAppliedSource, () =>
    Option.map(held, (earlier) => earlier.change.source),
  );
  const last = joined.at(-1);
  const mayBeCut = !complete && last !== undefined && Option.contains(lastSeenSource, last.change.source);
  return mayBeCut ? [joined.slice(0, -1), Option.some(last)] : [joined, Option.none()];
};
