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
import { Lifecycle, PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { DateTime, Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { DefaultForkSchedule, finalizedTransactionTraits } from '@midnightntwrk/wallet-sdk-facade';
import { fixturesFor } from './fixtures.js';

/**
 * The registry the wallet itself reads pending transactions with, built from the fork schedule the facade presets.
 * Every fixture here was written before the v9 fork and carries no protocol-version stamp, so the registry's oldest
 * trait — ledger-v8's — is the one that reads it, exactly as it would for a stored payload an application hands back.
 * Building a one-epoch registry instead would route the bytes to ledger-v9, whose deserializer refuses them.
 */
const traits = finalizedTransactionTraits(DefaultForkSchedule.v9);

const fixtures = fixturesFor('pending-transactions');

/**
 * Pending transactions have carried a `{ version: 'v1', transactions }` envelope since the surface first shipped, and
 * its source is deliberately left alone. These tests freeze that: the envelope is the house pattern the other four
 * surfaces are being brought in line with, so it must not drift while they change around it.
 */
describe('pending transactions written by published releases', () => {
  it('should have a fixture to restore', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$id (written by $writtenBy.name $writtenBy.version)', (fixture) => {
    const restore = () => PendingTransactions.deserialize(fixture.serialized, traits);

    it('should still be stored under the v1 envelope', () => {
      const written: unknown = JSON.parse(fixture.serialized);

      expect(written).toMatchObject({ version: 'v1' });
    });

    it('should restore every transaction it was written with', () => {
      const result = restore();

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(PendingTransactions.all(result.right)).toHaveLength(fixture.expected['txCount'] as number);
      }
    });

    it('should restore transactions that still carry the identifiers they were written with', () => {
      const result = restore();

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        // Through the trait, not off the handle: a restored transaction is a version-stamped handle, and reading its
        // identifiers is exactly what the trait it was read with is for. The registry has a ledger-v8 and a ledger-v9
        // epoch, so each item is read with the trait of the epoch it was stamped in — for these ledger-v8 fixtures,
        // which carry no stamp, that is the oldest one, and a ledger-v9 fixture would route itself to the other.
        const identifiers = result.right.all.map((item) => [
          ...Option.getOrThrow(PendingTransactions.traitForVersion(traits, item.protocolVersion)).ids(item.tx),
        ]);
        expect(identifiers).toEqual(fixture.expected['identifiers']);
      }
    });

    // Read as lifecycle records, each pending item is a submitted record: v1 showed it as submitted, kept only when it
    // was finalized, and stored none of the facts a record carries, so those come off the transaction itself.
    describe('read as lifecycle records', () => {
      const lifecycle = () => Either.getOrThrow(Lifecycle.deserialize(fixture.serialized, traits));
      const oldestTrait = Option.getOrThrow(PendingTransactions.headTrait(traits));
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
  });
});
