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

/**
 * What an application sees about the transactions it has submitted and the chain has not answered for yet.
 *
 * @remarks
 *   The machinery underneath already distinguishes every one of these: items are stamped with the version they were
 *   authored for, a fork gives the stranded ones their own verdict, and the wallet reverts them. What the state exposed
 *   was the machinery — a bag of items, some with a `result` field carrying an indexer-shaped status string, and the
 *   protocol-upgrade case indistinguishable from a chain rejection unless the reader knew to compare strings. These are
 *   the same facts as a tagged status an application can exhaust.
 */
import {
  type FinalizedTx,
  NetworkId,
  ProtocolVersion,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities';
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import { DateTime, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { pendingTransactionsOf } from '../src/index.js';

const authoredFor = ProtocolVersion.MinSupportedVersion;
const chainNow = ProtocolVersion.ProtocolVersion(2_000_000n);
const submittedAt = DateTime.unsafeMake(1_700_000_000_000);

const aTransaction = (): FinalizedTx =>
  WalletTransaction.adopt('Finalized', ledgerV8.Transaction.fromParts(NetworkId.NetworkId.Undeployed), authoredFor);

const held = (
  tx: FinalizedTx,
  result?: PendingTransactions.TransactionResult,
): PendingTransactions.PendingTransactions<FinalizedTx> => ({
  all: [
    {
      tx,
      creationTime: submittedAt,
      protocolVersion: Option.some(authoredFor),
      ...(result !== undefined ? { result } : {}),
    },
  ],
});

describe('a transaction the chain has not answered for', () => {
  it('is submitted, and carries the transaction and when it was submitted', () => {
    const tx = aTransaction();

    expect(pendingTransactionsOf(held(tx))).toStrictEqual([
      {
        transaction: tx,
        submittedAt,
        authoredFor: Option.some(authoredFor),
        status: { _tag: 'Submitted' },
      },
    ]);
  });
});

describe('a transaction the chain rejected', () => {
  it('is rejected, with the segments the chain reported', () => {
    const tx = aTransaction();
    const segments = [{ id: 0, success: false }];

    expect(pendingTransactionsOf(held(tx, { status: 'FAILURE', segments }))[0].status).toStrictEqual({
      _tag: 'Rejected',
      segments,
    });
  });

  it('is rejected when only some segments succeeded, which is still not a transaction that happened', () => {
    const tx = aTransaction();
    const segments = [
      { id: 0, success: true },
      { id: 1, success: false },
    ];

    expect(pendingTransactionsOf(held(tx, { status: 'PARTIAL_SUCCESS', segments }))[0].status).toStrictEqual({
      _tag: 'Rejected',
      segments,
    });
  });
});

describe('a transaction a protocol upgrade left behind', () => {
  it('is orphaned, and says which version it was authored for and which the chain reached', () => {
    const tx = aTransaction();

    expect(
      pendingTransactionsOf(held(tx, { status: 'ORPHANED_BY_FORK', authoredFor, chainNow }))[0].status,
    ).toStrictEqual({ _tag: 'Orphaned', authoredFor, chainNow });
  });

  it('is not the same as a rejection, because the chain never said anything about it', () => {
    // The distinction the previous shape could not make without comparing status strings: the node rejected this,
    // versus this can never be submitted at all.
    const rejected = pendingTransactionsOf(held(aTransaction(), { status: 'FAILURE', segments: [] }))[0];
    const orphaned = pendingTransactionsOf(
      held(aTransaction(), { status: 'ORPHANED_BY_FORK', authoredFor, chainNow }),
    )[0];

    expect(rejected.status._tag).not.toBe(orphaned.status._tag);
  });
});

describe('a transaction the chain confirmed', () => {
  it('is confirmed, for the moment before the wallet clears it', () => {
    const tx = aTransaction();
    const segments = [{ id: 0, success: true }];

    expect(pendingTransactionsOf(held(tx, { status: 'SUCCESS', segments }))[0].status).toStrictEqual({
      _tag: 'Confirmed',
      segments,
    });
  });
});

describe('an empty pending set', () => {
  it('is an empty list, which is what an application checks for', () => {
    expect(pendingTransactionsOf(PendingTransactions.empty())).toStrictEqual([]);
  });
});
