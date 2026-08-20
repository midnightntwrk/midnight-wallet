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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Buffer } from 'buffer';
import { DateTime, Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import * as PendingTransactions from '../pendingTransactions.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);

const FORK = version(2_000_000n);
const BEFORE = version(1_000n);
const AFTER = version(2_000_001n);

/**
 * Two transaction shapes that no single trait can read, standing in for the two ledger versions: `era` is what tells
 * them apart, exactly as the ledger `Transaction` class does in production.
 */
type FakeTx = Readonly<{ era: 'before' | 'after'; ids: readonly string[] }>;

const traitOf = (era: FakeTx['era']): PendingTransactions.TransactionTrait<FakeTx> => ({
  ids: (tx) => tx.ids,
  firstId: (tx) => tx.ids[0],
  areAllTxIdsIncluded: (tx, txIds) => tx.ids.every((id) => txIds.includes(id)),
  isOneIncludedInOther: (tx, otherTx) =>
    tx.era === otherTx.era && (tx.ids.every((id) => otherTx.ids.includes(id)) || otherTx.ids.every((id) => tx.ids.includes(id))),
  hasTTLExpired: () => false,
  serialize: (tx) => Buffer.from(JSON.stringify(tx), 'utf-8'),
  deserialize: (bytes) => {
    const parsed: FakeTx = JSON.parse(Buffer.from(bytes).toString('utf-8'));
    if (parsed.era !== era) throw new Error(`A ${era} trait cannot read a ${parsed.era} transaction.`);
    return parsed;
  },
  isTx: (tx): tx is FakeTx =>
    typeof tx === 'object' && tx !== null && 'era' in tx && (tx as FakeTx).era === era && 'ids' in tx,
});

const beforeTrait = traitOf('before');
const afterTrait = traitOf('after');

const traits: PendingTransactions.VersionedTransactionTrait<FakeTx> = Either.getOrThrow(
  ProtocolVersion.makeRegistryFromActivations([
    { sinceVersion: ProtocolVersion.MinSupportedVersion, value: beforeTrait },
    { sinceVersion: FORK, value: afterTrait },
  ]),
);

const now = DateTime.unsafeMake(1_752_487_200_000);
const txBefore: FakeTx = { era: 'before', ids: ['a'] };
const txAfter: FakeTx = { era: 'after', ids: ['b'] };

const added = (
  state: PendingTransactions.PendingTransactions<FakeTx>,
  tx: FakeTx,
  authoredFor: Option.Option<ProtocolVersion.ProtocolVersion>,
): PendingTransactions.PendingTransactions<FakeTx> =>
  PendingTransactions.addPendingTransaction(state, tx, now, traits, authoredFor);

describe('Choosing the transaction trait by protocol version', () => {
  it('reads an item with the trait registered for the version it was stamped with', () => {
    expect(PendingTransactions.traitForVersion(traits, Option.some(BEFORE))).toStrictEqual(Option.some(beforeTrait));
    expect(PendingTransactions.traitForVersion(traits, Option.some(AFTER))).toStrictEqual(Option.some(afterTrait));
  });

  it('reads an envelope that carries no stamp with the oldest registered trait', () => {
    expect(PendingTransactions.traitForVersion(traits, Option.none())).toStrictEqual(Option.some(beforeTrait));
  });

  it('recognises an incoming transaction by asking each registered trait which one owns it', () => {
    expect(PendingTransactions.traitForTx(traits, txBefore)).toStrictEqual(Option.some(beforeTrait));
    expect(PendingTransactions.traitForTx(traits, txAfter)).toStrictEqual(Option.some(afterTrait));
  });
});

describe('Stamping a pending transaction with the version it was authored for', () => {
  it('records the version on the item', () => {
    const state = added(PendingTransactions.empty<FakeTx>(), txBefore, Option.some(BEFORE));

    expect(state.all[0].protocolVersion).toStrictEqual(Option.some(BEFORE));
  });

  it('keeps transactions authored for different versions apart instead of merging them', () => {
    // Merging asks whether one transaction's identifiers include the other's. Across a protocol boundary that
    // question is meaningless — the two were authored against different rules — so both must stay.
    const sameIds: FakeTx = { era: 'after', ids: ['a'] };
    const state = added(added(PendingTransactions.empty<FakeTx>(), txBefore, Option.some(BEFORE)), sameIds, Option.some(AFTER));

    expect(state.all).toHaveLength(2);
  });
});

describe('Serializing pending transactions across a protocol boundary', () => {
  it('round-trips the stamp', () => {
    const state = added(added(PendingTransactions.empty<FakeTx>(), txBefore, Option.some(BEFORE)), txAfter, Option.some(AFTER));

    const restored = Either.getOrThrow(
      PendingTransactions.deserialize<FakeTx>(PendingTransactions.serialize(state, traits), traits),
    );

    expect(restored.all.map((item) => item.protocolVersion)).toStrictEqual([Option.some(BEFORE), Option.some(AFTER)]);
    expect(restored.all.map((item) => item.tx)).toStrictEqual([txBefore, txAfter]);
  });

  it('still reads an envelope written before transactions were stamped, using the oldest trait', () => {
    const legacy = JSON.stringify({
      version: 'v1',
      transactions: [
        {
          tx: Buffer.from(JSON.stringify(txBefore), 'utf-8').toString('hex'),
          creationTime: DateTime.formatIso(now),
        },
      ],
    });

    const restored = Either.getOrThrow(PendingTransactions.deserialize<FakeTx>(legacy, traits));

    expect(restored.all).toHaveLength(1);
    expect(restored.all[0].tx).toStrictEqual(txBefore);
    expect(restored.all[0].protocolVersion).toStrictEqual(Option.none());
  });
});

describe('Orphaning a pending transaction the fork left behind', () => {
  const pendingBefore = added(PendingTransactions.empty<FakeTx>(), txBefore, Option.some(BEFORE));

  it('orphans an item once the chain has moved past the version epoch it was authored in', () => {
    const orphaned = PendingTransactions.orphanBeyond(pendingBefore, traits, AFTER);

    const [item] = PendingTransactions.allOrphaned(orphaned);
    expect(item.tx).toStrictEqual(txBefore);
    expect(item.result.status).toBe('ORPHANED_BY_FORK');
    expect(item.result.authoredFor).toStrictEqual(BEFORE);
    expect(item.result.chainNow).toStrictEqual(AFTER);
  });

  it('leaves an item alone while the chain is still inside the epoch it was authored in', () => {
    const untouched = PendingTransactions.orphanBeyond(pendingBefore, traits, version(1_999_999n));

    expect(PendingTransactions.allOrphaned(untouched)).toHaveLength(0);
    expect(PendingTransactions.allPending(untouched)).toHaveLength(1);
  });

  it('never orphans an item whose authored-for version was never observed', () => {
    const unstamped = added(PendingTransactions.empty<FakeTx>(), txBefore, Option.none());

    expect(PendingTransactions.allOrphaned(PendingTransactions.orphanBeyond(unstamped, traits, AFTER))).toHaveLength(0);
  });

  it('leaves an item that already has a verdict alone', () => {
    const failed = PendingTransactions.saveResult(
      pendingBefore,
      txBefore,
      { status: 'FAILURE', segments: [] },
      traits,
    );

    const after = PendingTransactions.orphanBeyond(failed, traits, AFTER);

    expect(PendingTransactions.allOrphaned(after)).toHaveLength(0);
    expect(PendingTransactions.allFailed(after)).toHaveLength(1);
  });

  it('hands orphans to the same revert path as reported failures', () => {
    const bothKinds = PendingTransactions.orphanBeyond(
      PendingTransactions.saveResult(
        added(pendingBefore, txAfter, Option.some(AFTER)),
        txAfter,
        { status: 'FAILURE', segments: [] },
        traits,
      ),
      traits,
      AFTER,
    );

    expect(PendingTransactions.allRejected(bothKinds).map((item) => item.tx)).toStrictEqual([txBefore, txAfter]);
  });
});
