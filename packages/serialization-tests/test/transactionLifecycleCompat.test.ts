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
import { Lifecycle, TransactionTraits } from '@midnightntwrk/wallet-sdk-capabilities/transactionLifecycle';
import { DateTime, Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { DefaultForkSchedule, lifecycleEntriesOf, lifecycleTransactionTraits } from '@midnightntwrk/wallet-sdk-facade';
import { fixturesFor } from './fixtures.js';

/**
 * The registry the facade itself keeps its lifecycle records with, built from the fork schedule it presets. Every
 * fixture here was written before the v9 fork and carries no protocol-version stamp, so the registry's oldest trait —
 * ledger-v8's — is the one that reads it, exactly as it would for a stored payload an application hands back. Building
 * a one-epoch registry instead would route the bytes to ledger-v9, whose deserializer refuses them.
 */
const traits = lifecycleTransactionTraits(DefaultForkSchedule.v9);

const fixtures = fixturesFor('transaction-lifecycle');

/**
 * Every published release wrote this store as a `{ version: 'v1', transactions }` envelope of pending items and
 * reservations. Each must still load, upgraded to one lifecycle record per transaction.
 */
describe('transaction lifecycle stores written by published releases', () => {
  it('should have a fixture to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    const lifecycle = () => Either.getOrThrow(Lifecycle.deserialize(fixture.serialized, traits));

    it('should still be stored under the v1 envelope', () => {
      const written: unknown = JSON.parse(fixture.serialized);

      expect(written).toMatchObject({ version: 'v1' });
    });

    // Read as lifecycle records, each pending item is a submitted record: v1 showed it as submitted, kept only when it
    // was finalized, and stored none of the facts a record carries, so those come off the transaction itself.
    describe('read as lifecycle records', () => {
      const oldestTrait = Option.getOrThrow(TransactionTraits.headTrait(traits));
      const creationTime = DateTime.unsafeMake(fixture.expected['creationTime'] as string);

      it('should hold one submitted record per transaction, never submitted at a time v1 did not keep', () => {
        const records = lifecycle().records;

        expect(records).toHaveLength(fixture.expected['txCount'] as number);
        expect(records.map((record) => record.state)).toStrictEqual(
          records.map(() => Lifecycle.LifecycleState.Submitted()),
        );
        expect(records.map((record) => record.submittedAt)).toStrictEqual(records.map(() => Option.none()));
        expect(records.map((record) => record.createdAt)).toStrictEqual(records.map(() => creationTime));
      });

      it('should give each record the identifiers its transaction was written with', () => {
        expect(lifecycle().records.map((record) => record.identifiers)).toEqual(fixture.expected['identifiers']);
      });

      // Unstamped, so read with the oldest trait and never given a version: nothing recorded which one built it.
      it('should take each record’s intent hashes, inputs and TTL from its transaction, read with the oldest trait', () => {
        const records = lifecycle().records;
        const txs = records.map((record) => Option.getOrThrow(record.tx));

        expect(records.map((record) => record.protocolVersion)).toStrictEqual(records.map(() => Option.none()));
        expect(records.map((record) => record.intentHashes)).toStrictEqual(
          txs.map((tx) => oldestTrait.intentHashes(tx)),
        );
        expect(records.map((record) => record.inputs)).toStrictEqual(txs.map((tx) => oldestTrait.inputs(tx)));
        expect(records.map((record) => record.ttl)).toStrictEqual(txs.map((tx) => oldestTrait.ttl(tx, creationTime)));
        // Each fixture transaction is one shielded output: no intent and nothing spent, so no intent hashes, no inputs,
        // and a TTL that is the Dust grace period of three hours after the record began.
        expect(records.map((record) => record.intentHashes)).toStrictEqual(records.map(() => []));
        expect(records.map((record) => record.inputs)).toStrictEqual(records.map(() => ({ unshielded: [] })));
        expect(records.map((record) => record.ttl)).toStrictEqual(
          records.map(() => new Date(DateTime.toEpochMillis(creationTime) + 3 * 60 * 60 * 1000)),
        );
      });
    });

    // The traits the wallet holds its records with read a transaction in any proof state; these fixtures were written
    // proven, so this is where reading the proven form is pinned.
    describe('read in the proven form v1 stored it', () => {
      // Type cast required because: the fixture is a v1 payload, whose envelope holds each transaction's hex as `tx`.
      const stored = (JSON.parse(fixture.serialized) as { transactions: ReadonlyArray<{ tx: string }> }).transactions;

      it('should hold each proven transaction as finalized, and write back its bytes', () => {
        const records = lifecycle().records;
        const oldestTrait = Option.getOrThrow(TransactionTraits.headTrait(traits));
        const txs = records.map((record) => Option.getOrThrow(record.tx));

        expect(txs.map((tx) => tx.form)).toStrictEqual(txs.map(() => 'Finalized'));
        expect(txs.map((tx) => Buffer.from(oldestTrait.serialize(tx)).toString('hex'))).toStrictEqual(
          stored.map((item) => item.tx),
        );
      });

      it('should show an application each transaction as submitted, carrying the finalized transaction it stored', () => {
        const entries = lifecycleEntriesOf(lifecycle());

        expect(entries.map((entry) => entry.status)).toStrictEqual(entries.map(() => ({ _tag: 'Submitted' })));
        expect(entries.map((entry) => entry.identifiers)).toEqual(fixture.expected['identifiers']);
        expect(entries.map((entry) => Option.map(entry.transaction, (tx) => tx.stage))).toStrictEqual(
          entries.map(() => Option.some('Finalized')),
        );
      });
    });
  });
});
