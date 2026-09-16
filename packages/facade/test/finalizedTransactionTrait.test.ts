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

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Array as Arr, DateTime, Duration } from 'effect';
import { describe, expect, it } from 'vitest';
import { v8FinalizedTransactionTrait, v9FinalizedTransactionTrait } from '../src/transaction.js';

/**
 * Both ledger versions' traits read a transaction the same way — identifiers, a TTL, offers, dust spends — against
 * different ledger classes. `hasTTLExpired` touches none of those classes, so one structural stub exercises both, and
 * running every case against each is what stops a fix landing on one and not the other.
 */
const traits = [
  ['v8', v8FinalizedTransactionTrait],
  ['v9', v9FinalizedTransactionTrait],
] as const;

const dustGracePeriod = Duration.seconds(
  Number(ledger.LedgerParameters.initialParameters().dust.dustGracePeriodSeconds),
);

const creationTime = DateTime.unsafeMake('2026-01-01T00:00:00.000Z');
/** The first instant at which a transaction carrying only the dust grace period has outlived it. */
const justAfterGracePeriod = DateTime.addDuration(creationTime, Duration.sum(dustGracePeriod, Duration.seconds(1)));
/** An intent deadline comfortably beyond the dust grace period, so the grace period is always the earlier one. */
const intentTTLBeyondGracePeriod = DateTime.toDate(
  DateTime.addDuration(creationTime, Duration.sum(dustGracePeriod, Duration.hours(1))),
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
const stubTransaction = <T,>(parts: StubParts): T => {
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
  // Type cast required because: `hasTTLExpired` reads only `intents`, `guaranteedOffer` and `fallibleOffer`, and each
  // ledger's `Transaction` has a private constructor, so a structural stub is the only way to reach either from a unit
  // test. The same stub serves both versions because none of the three fields differ between them.
  return stub as T;
};

describe.each(traits)('%s finalizedTransactionTrait', (_label, trait) => {
  /**
   * The dust grace period is a backstop for transactions whose expiry the intent deadlines do not already describe, so
   * it applies only to a transaction that carries shielded offers or dust spends. A transaction with none of those and
   * no intents has nothing to expire against and is deliberately never reaped — the case is asserted below. Every real
   * transaction carries an intent, and `Intent.ttl` is required, so a transaction with no deadline at all is not a
   * shape the chain produces.
   */
  describe('hasTTLExpired', () => {
    it('does not expire a transaction with no shielded offers and no dust spends before its intent deadline', () => {
      const tx = stubTransaction<Parameters<typeof trait.hasTTLExpired>[0]>({
        intents: [{ ttl: intentTTLBeyondGracePeriod, dustSpends: 0 }],
        hasGuaranteedOffer: false,
        fallibleOfferSegments: 0,
      });

      expect(trait.hasTTLExpired(tx, creationTime, justAfterGracePeriod)).toBe(false);
    });

    it('does not expire a transaction with no intents, no shielded offers and no dust spends', () => {
      const tx = stubTransaction<Parameters<typeof trait.hasTTLExpired>[0]>({ intents: [], hasGuaranteedOffer: false, fallibleOfferSegments: 0 });

      expect(trait.hasTTLExpired(tx, creationTime, justAfterGracePeriod)).toBe(false);
    });

    it('expires a transaction with a guaranteed offer once the dust grace period has passed', () => {
      const tx = stubTransaction<Parameters<typeof trait.hasTTLExpired>[0]>({
        intents: [{ ttl: intentTTLBeyondGracePeriod, dustSpends: 0 }],
        hasGuaranteedOffer: true,
        fallibleOfferSegments: 0,
      });

      expect(trait.hasTTLExpired(tx, creationTime, justAfterGracePeriod)).toBe(true);
    });

    it('expires a transaction with a fallible offer once the dust grace period has passed', () => {
      const tx = stubTransaction<Parameters<typeof trait.hasTTLExpired>[0]>({
        intents: [{ ttl: intentTTLBeyondGracePeriod, dustSpends: 0 }],
        hasGuaranteedOffer: false,
        fallibleOfferSegments: 1,
      });

      expect(trait.hasTTLExpired(tx, creationTime, justAfterGracePeriod)).toBe(true);
    });

    it('expires a transaction with dust spends once the dust grace period has passed', () => {
      const tx = stubTransaction<Parameters<typeof trait.hasTTLExpired>[0]>({
        intents: [{ ttl: intentTTLBeyondGracePeriod, dustSpends: 1 }],
        hasGuaranteedOffer: false,
        fallibleOfferSegments: 0,
      });

      expect(trait.hasTTLExpired(tx, creationTime, justAfterGracePeriod)).toBe(true);
    });

    it('expires a transaction whose intent deadline has passed, with no shielded offers and no dust spends', () => {
      const tx = stubTransaction<Parameters<typeof trait.hasTTLExpired>[0]>({
        intents: [{ ttl: DateTime.toDate(creationTime), dustSpends: 0 }],
        hasGuaranteedOffer: false,
        fallibleOfferSegments: 0,
      });

      expect(trait.hasTTLExpired(tx, creationTime, justAfterGracePeriod)).toBe(true);
    });
  });
});
