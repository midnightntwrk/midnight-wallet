/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { Array as Arr, DateTime, Duration } from 'effect';
import { describe, expect, it } from 'vitest';
import { v8FinalizedTransactionTrait, v9FinalizedTransactionTrait } from '../src/transaction.js';

/**
 * Both ledger versions' traits read a transaction the same way — identifiers, a TTL, offers, dust spends — against
 * different ledger classes. `hasTTLExpired` touches none of those classes, so one structural stub exercises both, and
 * running every case against each is what stops a fix landing on one and not the other.
 *
 * Each trait reads the dust grace period off its own ledger's initial parameters, so the period is paired with the
 * trait here rather than read once: if the two ledgers ever disagree, the boundary each case probes must move with it.
 */
const traits = [
  ['v8', v8FinalizedTransactionTrait, ledgerV8.LedgerParameters.initialParameters().dust.dustGracePeriodSeconds],
  ['v9', v9FinalizedTransactionTrait, ledgerV9.LedgerParameters.initialParameters().dust.dustGracePeriodSeconds],
] as const;

const creationTime = DateTime.unsafeMake('2026-01-01T00:00:00.000Z');

/** The two instants every case is probed at, derived from one ledger's dust grace period. */
const boundariesFor = (dustGracePeriodSeconds: bigint) => {
  const dustGracePeriod = Duration.seconds(Number(dustGracePeriodSeconds));
  return {
    /** The first instant at which a transaction carrying only the dust grace period has outlived it. */
    justAfterGracePeriod: DateTime.addDuration(creationTime, Duration.sum(dustGracePeriod, Duration.seconds(1))),
    /** An intent deadline comfortably beyond the dust grace period, so the grace period is always the earlier one. */
    intentTTLBeyondGracePeriod: DateTime.toDate(
      DateTime.addDuration(creationTime, Duration.sum(dustGracePeriod, Duration.hours(1))),
    ),
  };
};

/**
 * Asks one trait whether the stub has expired.
 *
 * Each trait's `hasTTLExpired` is typed against its own ledger's `FinalizedTransaction`, so calling either with the
 * shared stub needs the parameter widened back to the structural value it actually reads.
 */
const hasTTLExpired = (trait: (typeof traits)[number][1], tx: unknown, now: DateTime.Utc): boolean =>
  // Type cast required because: the two traits' parameter types are distinct nominal classes, so indexing the tuple
  // yields a union whose call signature demands their intersection — a type no value can have. `hasTTLExpired` reads
  // only `intents`, `guaranteedOffer` and `fallibleOffer`, which are identical across both.
  (trait.hasTTLExpired as (tx: unknown, creationTime: DateTime.Utc, now: DateTime.Utc) => boolean)(
    tx,
    creationTime,
    now,
  );

type StubIntent = Readonly<{
  ttl: Date;
  dustSpends: number;
}>;

type StubParts = Readonly<{
  intents: readonly StubIntent[];
  hasGuaranteedOffer: boolean;
  fallibleOfferSegments: number;
}>;

/**
 * Builds the smallest transaction-shaped value `hasTTLExpired` reads: its intents (deadline and dust spends), and
 * whether it carries shielded offers. A real `ledger.FinalizedTransaction` can only be produced by proving, which a
 * unit test must not do.
 */
const stubTransaction = (parts: StubParts): unknown => {
  const intents = new Map(
    Arr.map(parts.intents, (intent, index) => [
      index,
      {
        ttl: intent.ttl,
        dustActions: intent.dustSpends === 0 ? undefined : { spends: Arr.makeBy(intent.dustSpends, () => ({})) },
      },
    ]),
  );
  const fallibleOffer =
    parts.fallibleOfferSegments === 0
      ? undefined
      : new Map(Arr.makeBy(parts.fallibleOfferSegments, (index) => [index, {}]));
  const stub = {
    intents,
    guaranteedOffer: parts.hasGuaranteedOffer ? {} : undefined,
    fallibleOffer,
  };
  // Returned as `unknown` on purpose: each ledger's `Transaction` has a private constructor, so a structural stub is
  // the only way to reach `hasTTLExpired` from a unit test, and the widening happens once, at the call site that knows
  // which trait is being asked.
  return stub;
};

describe.each(traits)('%s finalizedTransactionTrait', (_label, trait, dustGracePeriodSeconds) => {
  const { justAfterGracePeriod, intentTTLBeyondGracePeriod } = boundariesFor(dustGracePeriodSeconds);

  /**
   * The dust grace period is a backstop for transactions whose expiry the intent deadlines do not already describe, so
   * it applies only to a transaction that carries shielded offers or dust spends. A transaction with none of those and
   * no intents has nothing to expire against and is deliberately never reaped — the case is asserted below. Every real
   * transaction carries an intent, and `Intent.ttl` is required, so a transaction with no deadline at all is not a
   * shape the chain produces.
   */
  describe('hasTTLExpired', () => {
    it('does not expire a transaction with no shielded offers and no dust spends before its intent deadline', () => {
      const tx = stubTransaction({
        intents: [{ ttl: intentTTLBeyondGracePeriod, dustSpends: 0 }],
        hasGuaranteedOffer: false,
        fallibleOfferSegments: 0,
      });

      expect(hasTTLExpired(trait, tx, justAfterGracePeriod)).toBe(false);
    });

    it('does not expire a transaction with no intents, no shielded offers and no dust spends', () => {
      const tx = stubTransaction({ intents: [], hasGuaranteedOffer: false, fallibleOfferSegments: 0 });

      expect(hasTTLExpired(trait, tx, justAfterGracePeriod)).toBe(false);
    });

    it('expires a transaction with a guaranteed offer once the dust grace period has passed', () => {
      const tx = stubTransaction({
        intents: [{ ttl: intentTTLBeyondGracePeriod, dustSpends: 0 }],
        hasGuaranteedOffer: true,
        fallibleOfferSegments: 0,
      });

      expect(hasTTLExpired(trait, tx, justAfterGracePeriod)).toBe(true);
    });

    it('expires a transaction with a fallible offer once the dust grace period has passed', () => {
      const tx = stubTransaction({
        intents: [{ ttl: intentTTLBeyondGracePeriod, dustSpends: 0 }],
        hasGuaranteedOffer: false,
        fallibleOfferSegments: 1,
      });

      expect(hasTTLExpired(trait, tx, justAfterGracePeriod)).toBe(true);
    });

    it('expires a transaction with dust spends once the dust grace period has passed', () => {
      const tx = stubTransaction({
        intents: [{ ttl: intentTTLBeyondGracePeriod, dustSpends: 1 }],
        hasGuaranteedOffer: false,
        fallibleOfferSegments: 0,
      });

      expect(hasTTLExpired(trait, tx, justAfterGracePeriod)).toBe(true);
    });

    it('expires a transaction whose intent deadline has passed, with no shielded offers and no dust spends', () => {
      const tx = stubTransaction({
        intents: [{ ttl: DateTime.toDate(creationTime), dustSpends: 0 }],
        hasGuaranteedOffer: false,
        fallibleOfferSegments: 0,
      });

      expect(hasTTLExpired(trait, tx, justAfterGracePeriod)).toBe(true);
    });
  });
});
