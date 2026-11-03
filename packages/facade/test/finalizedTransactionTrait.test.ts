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
import { ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { type TransactionTraits } from '@midnightntwrk/wallet-sdk-capabilities';
import { Array as Arr, DateTime, Duration, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  finalizedTransactionTraits,
  v8FinalizedTransactionTrait,
  v9FinalizedTransactionTrait,
} from '../src/transaction.js';

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
   * The dust grace period is the wallet's own backstop, not a ledger rule: it bounds a transaction whose expiry the
   * intent deadlines do not already describe — one carrying shielded offers or dust spends, and one carrying no intent
   * at all. A rewards or bridge claim built by `Transaction.fromRewards` has no intents and no offers, and the indexer
   * never reports a status for it, so the backstop is the only way it ever leaves the pending set.
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

    it('expires a transaction with no intents, no shielded offers and no dust spends once the dust grace period has passed', () => {
      const tx = stubTransaction({ intents: [], hasGuaranteedOffer: false, fallibleOfferSegments: 0 });

      expect(hasTTLExpired(trait, tx, creationTime)).toBe(false);
      expect(hasTTLExpired(trait, tx, justAfterGracePeriod)).toBe(true);
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

type Spend = Readonly<{ intentHash: string; outputNo: number }>;

type FactsIntent = Readonly<{
  segment: number;
  ttl: Date;
  dustSpends?: number;
  guaranteedSpends?: readonly Spend[];
  fallibleSpends?: readonly Spend[];
}>;

type FactsParts = Readonly<{
  /** Absent for a transaction with no intent at all, such as a rewards claim. */
  intents?: readonly FactsIntent[];
  guaranteedNullifiers?: readonly string[];
  /** One list of nullifiers per fallible segment, segments numbered from 1. */
  fallibleNullifiers?: ReadonlyArray<readonly string[]>;
}>;

/**
 * Builds the smallest transaction-shaped value the facts a lifecycle record keeps are read from: each intent's TTL,
 * Dust spends, hash and unshielded spends, and the Zswap inputs of the shielded offers. Each intent hashes to
 * `intent-<segment>`, so a hash taken with the wrong segment shows. It serializes, so it can be sealed in a handle.
 */
const factsTransaction = (parts: FactsParts): unknown => ({
  intents:
    parts.intents === undefined
      ? undefined
      : new Map(
          parts.intents.map((intent) => [
            intent.segment,
            {
              ttl: intent.ttl,
              dustActions:
                (intent.dustSpends ?? 0) === 0 ? undefined : { spends: Arr.makeBy(intent.dustSpends ?? 0, () => ({})) },
              intentHash: (segment: number) => `intent-${segment}`,
              guaranteedUnshieldedOffer:
                intent.guaranteedSpends === undefined ? undefined : { inputs: intent.guaranteedSpends },
              fallibleUnshieldedOffer:
                intent.fallibleSpends === undefined ? undefined : { inputs: intent.fallibleSpends },
            },
          ]),
        ),
  guaranteedOffer:
    parts.guaranteedNullifiers === undefined
      ? undefined
      : { inputs: parts.guaranteedNullifiers.map((nullifier) => ({ nullifier })) },
  fallibleOffer:
    parts.fallibleNullifiers === undefined
      ? undefined
      : new Map(
          parts.fallibleNullifiers.map((nullifiers, index) => [
            index + 1,
            { inputs: nullifiers.map((nullifier) => ({ nullifier })) },
          ]),
        ),
  serialize: () => new Uint8Array(),
});

/**
 * One trait, widened to read the structural stub.
 *
 * Type cast required because: each trait is typed against its own ledger's `FinalizedTransaction`, a nominal class with
 * a private constructor, while the members under test read only the structural fields the stub carries.
 */
const reading = (trait: (typeof traits)[number][1]): TransactionTraits.TransactionTrait<unknown> =>
  trait as unknown as TransactionTraits.TransactionTrait<unknown>;

const at = (offset: Duration.DurationInput): Date => DateTime.toDate(DateTime.addDuration(creationTime, offset));

describe.each(traits)('%s finalizedTransactionTrait, the facts a lifecycle record keeps', (_label, trait, grace) => {
  const read = reading(trait);
  const gracePeriod = Duration.seconds(Number(grace));
  const graceEnds = at(gracePeriod);
  const beyondGrace = at(Duration.sum(gracePeriod, Duration.hours(1)));
  const lessBeyondGrace = at(Duration.sum(gracePeriod, Duration.minutes(30)));
  const withinGrace = at(Duration.seconds(1));

  describe('ttl', () => {
    it('should end at the earliest intent TTL when the transaction spends no Dust and carries no shielded offer', () => {
      const tx = factsTransaction({
        intents: [
          { segment: 1, ttl: beyondGrace },
          { segment: 2, ttl: lessBeyondGrace },
        ],
      });

      expect(read.ttl(tx, creationTime)).toStrictEqual(lessBeyondGrace);
    });

    it('should end once the Dust grace period after creation has passed for a transaction with no intent, so a rewards claim the indexer never reports still ends', () => {
      expect(read.ttl(factsTransaction({}), creationTime)).toStrictEqual(graceEnds);
    });

    it.each([
      ['spends Dust', { intents: [{ segment: 1, ttl: beyondGrace, dustSpends: 1 }] }],
      [
        'carries a guaranteed shielded offer',
        { intents: [{ segment: 1, ttl: beyondGrace }], guaranteedNullifiers: [] },
      ],
      ['carries a fallible shielded offer', { intents: [{ segment: 1, ttl: beyondGrace }], fallibleNullifiers: [[]] }],
    ] as const)(
      'should end once the Dust grace period after creation has passed when the transaction %s, before a later intent TTL',
      (_what, parts) => {
        expect(read.ttl(factsTransaction(parts), creationTime)).toStrictEqual(graceEnds);
      },
    );

    it('should end at an intent TTL that comes before the Dust grace period does, whatever else the transaction carries', () => {
      const tx = factsTransaction({
        intents: [{ segment: 1, ttl: withinGrace, dustSpends: 1 }],
        guaranteedNullifiers: [],
      });

      expect(read.ttl(tx, creationTime)).toStrictEqual(withinGrace);
    });

    it('should agree with hasTTLExpired: valid at its TTL instant, expired just after it', () => {
      const tx = factsTransaction({ intents: [{ segment: 1, ttl: lessBeyondGrace }] });
      const ttl = DateTime.unsafeMake(read.ttl(tx, creationTime));

      expect(read.hasTTLExpired(tx, creationTime, ttl)).toBe(false);
      expect(read.hasTTLExpired(tx, creationTime, DateTime.addDuration(ttl, Duration.millis(1)))).toBe(true);
    });
  });

  describe('intentHashes', () => {
    it('should name each intent by its hash, taken with the segment it sits in', () => {
      const tx = factsTransaction({
        intents: [
          { segment: 1, ttl: beyondGrace },
          { segment: 2, ttl: beyondGrace },
        ],
      });

      expect([...read.intentHashes(tx)].toSorted()).toStrictEqual(['intent-1', 'intent-2']);
    });

    it('should name none for a transaction with no intent', () => {
      expect(read.intentHashes(factsTransaction({}))).toStrictEqual([]);
    });
  });

  describe('inputs', () => {
    it('should name every unshielded coin of every intent by intent hash and output number, and every shielded coin by nullifier', () => {
      const tx = factsTransaction({
        intents: [
          {
            segment: 1,
            ttl: beyondGrace,
            guaranteedSpends: [{ intentHash: 'h-a', outputNo: 0 }],
            fallibleSpends: [{ intentHash: 'h-b', outputNo: 3 }],
          },
          { segment: 2, ttl: beyondGrace, fallibleSpends: [{ intentHash: 'h-c', outputNo: 1 }] },
        ],
        guaranteedNullifiers: ['n-guaranteed'],
        fallibleNullifiers: [['n-fallible-1'], ['n-fallible-2a', 'n-fallible-2b']],
      });

      const inputs = read.inputs(tx);

      expect([...inputs.unshielded].toSorted()).toStrictEqual(['h-a#0', 'h-b#3', 'h-c#1']);
      expect([...(inputs.shielded ?? [])].toSorted()).toStrictEqual([
        'n-fallible-1',
        'n-fallible-2a',
        'n-fallible-2b',
        'n-guaranteed',
      ]);
    });

    it('should leave shielded inputs out when the transaction spends no shielded coin, as a reservation always has', () => {
      const tx = factsTransaction({
        intents: [{ segment: 1, ttl: beyondGrace, guaranteedSpends: [{ intentHash: 'h-a', outputNo: 0 }] }],
        guaranteedNullifiers: [],
      });

      expect(read.inputs(tx)).toStrictEqual({ unshielded: ['h-a#0'] });
    });

    it('should name nothing for a transaction that spends nothing', () => {
      expect(read.inputs(factsTransaction({}))).toStrictEqual({ unshielded: [] });
    });
  });
});

describe('finalizedTransactionTraits, the facts a lifecycle record keeps', () => {
  const FORK = ProtocolVersion.V9NativeForkVersion;
  const registry = finalizedTransactionTraits(FORK);
  const ttl = new Date(DateTime.toEpochMillis(creationTime) + 1000);
  const stub = factsTransaction({
    intents: [{ segment: 1, ttl, guaranteedSpends: [{ intentHash: 'h-a', outputNo: 0 }] }],
    guaranteedNullifiers: ['n-a'],
  });

  it.each([
    ['ledger-v8', ProtocolVersion.MinSupportedVersion],
    ['ledger-v9', FORK],
  ] as const)(
    'should read them through the handle the facade carries, with the %s trait its stamp selects',
    (_ledger, stamp) => {
      // Type cast required because: `adopt` seals any serializable transaction, and the stub is one; its static type is
      // `unknown` only so that it can stand in for either ledger's class.
      const handle = WalletTransaction.adopt('Finalized', stub as { serialize: () => Uint8Array }, stamp);
      const trait = Option.getOrThrow(ProtocolVersion.select(registry, stamp));

      expect(trait.intentHashes(handle)).toStrictEqual(['intent-1']);
      expect(trait.inputs(handle)).toStrictEqual({ unshielded: ['h-a#0'], shielded: ['n-a'] });
      expect(trait.ttl(handle, creationTime)).toStrictEqual(ttl);
    },
  );
});
