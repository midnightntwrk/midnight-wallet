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
import * as ledger from '@midnightntwrk/ledger-v9';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { type RecordableChange, releaseCompleteChanges } from '../HeldChanges.js';

const coin = (value: number): ledger.QualifiedShieldedCoinInfo => ({
  ...ledger.createShieldedCoinInfo(ledger.shieldedToken().raw, BigInt(value)),
  mt_index: BigInt(value),
});

/** A transaction's change to the wallet: `source` names the transaction, the numbers name its coins. */
const change = (source: string, received: readonly number[] = [], spent: readonly number[] = []): RecordableChange => ({
  protocolVersion: 3,
  change: { source, receivedCoins: received.map(coin), spentCoins: spent.map(coin) },
});

/** What a test compares: each change's source with its coins' values, so equal coins compare equal. */
const shape = (changes: readonly RecordableChange[]) =>
  changes.map(({ change: c }) => ({
    source: c.source,
    received: c.receivedCoins.map((coin) => Number(coin.value)),
    spent: c.spentCoins.map((coin) => Number(coin.value)),
  }));

const release = (
  held: Option.Option<RecordableChange>,
  changes: readonly RecordableChange[],
  applied: Readonly<{ first?: string; last?: string }>,
  complete: boolean,
) => {
  const [released, stillHeld] = releaseCompleteChanges(
    held,
    {
      changes,
      firstAppliedSource: Option.fromNullable(applied.first),
      lastAppliedSource: Option.fromNullable(applied.last),
    },
    complete,
  );
  return { released: shape(released), held: Option.map(stillHeld, (h) => shape([h])[0]) };
};

describe('releaseCompleteChanges', () => {
  it('should release nothing and hold nothing for an empty batch with nothing held', () => {
    expect(release(Option.none(), [], {}, false)).toEqual({ released: [], held: Option.none() });
  });

  it('should keep holding a change across a batch that applies no event, because nothing yet shows its transaction ended', () => {
    expect(release(Option.some(change('S', [], [1])), [], {}, false)).toEqual({
      released: [],
      held: Option.some({ source: 'S', received: [], spent: [1] }),
    });
  });

  it('should release a held change on a batch that applies no event once the wallet is complete, because a complete wallet has every event of every transaction', () => {
    expect(release(Option.some(change('S', [], [1])), [], {}, true)).toEqual({
      released: [{ source: 'S', received: [], spent: [1] }],
      held: Option.none(),
    });
  });

  it('should release a held change before the batch when the batch starts with another transaction, because a transaction’s events are contiguous', () => {
    expect(release(Option.some(change('S', [], [1])), [change('T', [2])], { first: 'T', last: 'U' }, false)).toEqual({
      released: [
        { source: 'S', received: [], spent: [1] },
        { source: 'T', received: [2], spent: [] },
      ],
      held: Option.none(),
    });
  });

  it('should release a held change when the batch applies only another transaction’s events, none touching the wallet, because a transaction’s events are contiguous', () => {
    expect(release(Option.some(change('S', [], [1])), [], { first: 'T', last: 'T' }, false)).toEqual({
      released: [{ source: 'S', received: [], spent: [1] }],
      held: Option.none(),
    });
  });

  it('should join a held change with the head of the batch when the batch continues its transaction', () => {
    expect(
      release(
        Option.some(change('S', [], [1])),
        [change('S', [2]), change('T', [3])],
        { first: 'S', last: 'U' },
        false,
      ),
    ).toEqual({
      released: [
        { source: 'S', received: [2], spent: [1] },
        { source: 'T', received: [3], spent: [] },
      ],
      held: Option.none(),
    });
  });

  it('should keep holding a change when the batch only continues its transaction with events that do not touch the wallet, because its transaction may go on further', () => {
    expect(release(Option.some(change('S', [], [1])), [], { first: 'S', last: 'S' }, false)).toEqual({
      released: [],
      held: Option.some({ source: 'S', received: [], spent: [1] }),
    });
  });

  it('should release a held change when the batch continues its transaction without touching the wallet and then moves on, because its transaction ended inside the batch', () => {
    expect(release(Option.some(change('S', [], [1])), [change('T', [2])], { first: 'S', last: 'T' }, false)).toEqual({
      released: [{ source: 'S', received: [], spent: [1] }],
      held: Option.some({ source: 'T', received: [2], spent: [] }),
    });
  });

  it('should hold the batch’s last change while catching up when the batch ends inside its transaction, because the rest of it may come in the next batch', () => {
    expect(release(Option.none(), [change('S', [1]), change('T', [2])], { first: 'S', last: 'T' }, false)).toEqual({
      released: [{ source: 'S', received: [1], spent: [] }],
      held: Option.some({ source: 'T', received: [2], spent: [] }),
    });
  });

  it('should release the batch’s last change while catching up when a later transaction was applied after it, because a batch can only end inside its last applied transaction', () => {
    expect(release(Option.none(), [change('S', [1]), change('T', [2])], { first: 'S', last: 'U' }, false)).toEqual({
      released: [
        { source: 'S', received: [1], spent: [] },
        { source: 'T', received: [2], spent: [] },
      ],
      held: Option.none(),
    });
  });

  it('should release the batch’s last change when the batch ends inside its transaction but the wallet is complete', () => {
    expect(release(Option.none(), [change('T', [2])], { first: 'T', last: 'T' }, true)).toEqual({
      released: [{ source: 'T', received: [2], spent: [] }],
      held: Option.none(),
    });
  });
});
