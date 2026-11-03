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
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import * as TransactionTraits from '../transactionTraits.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);

const FORK = version(2_000_000n);
const BEFORE = version(1_000n);
const AFTER = version(2_000_001n);

/**
 * Two transaction shapes that no single trait can read, standing in for the two ledger versions: `era` is what tells
 * them apart, exactly as the ledger `Transaction` class does in production.
 */
type FakeTx = Readonly<{ era: 'before' | 'after'; ids: readonly string[] }>;

const traitOf = (era: FakeTx['era']): TransactionTraits.TransactionTrait<FakeTx> => ({
  ids: (tx) => tx.ids,
  firstId: (tx) => tx.ids[0],
  areAllTxIdsIncluded: (tx, txIds) => tx.ids.every((id) => txIds.includes(id)),
  isOneIncludedInOther: (tx, otherTx) =>
    tx.era === otherTx.era &&
    (tx.ids.every((id) => otherTx.ids.includes(id)) || otherTx.ids.every((id) => tx.ids.includes(id))),
  hasTTLExpired: () => false,
  intentHashes: () => [],
  inputs: () => ({ unshielded: [] }),
  ttl: () => new Date(0),
  serialize: (tx) => Buffer.from(JSON.stringify(tx), 'utf-8'),
  deserialize: (bytes) => {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8')) as FakeTx;
    if (parsed.era !== era) throw new Error(`A ${era} trait cannot read a ${parsed.era} transaction.`);
    return parsed;
  },
  isTx: (tx): tx is FakeTx =>
    typeof tx === 'object' && tx !== null && 'era' in tx && (tx as FakeTx).era === era && 'ids' in tx,
});

const beforeTrait = traitOf('before');
const afterTrait = traitOf('after');

const traits: TransactionTraits.VersionedTransactionTrait<FakeTx> = Either.getOrThrow(
  ProtocolVersion.makeRegistryFromActivations([
    { sinceVersion: ProtocolVersion.MinSupportedVersion, value: beforeTrait },
    { sinceVersion: FORK, value: afterTrait },
  ]),
);

const txBefore: FakeTx = { era: 'before', ids: ['a'] };
const txAfter: FakeTx = { era: 'after', ids: ['b'] };

describe('Choosing the transaction trait by protocol version', () => {
  it('reads an item with the trait registered for the version it was stamped with', () => {
    expect(TransactionTraits.traitForVersion(traits, Option.some(BEFORE))).toStrictEqual(Option.some(beforeTrait));
    expect(TransactionTraits.traitForVersion(traits, Option.some(AFTER))).toStrictEqual(Option.some(afterTrait));
  });

  it('reads an envelope that carries no stamp with the oldest registered trait', () => {
    expect(TransactionTraits.traitForVersion(traits, Option.none())).toStrictEqual(Option.some(beforeTrait));
  });

  it('recognises an incoming transaction by asking each registered trait which one owns it', () => {
    expect(TransactionTraits.traitForTx(traits, txBefore)).toStrictEqual(Option.some(beforeTrait));
    expect(TransactionTraits.traitForTx(traits, txAfter)).toStrictEqual(Option.some(afterTrait));
  });
});
