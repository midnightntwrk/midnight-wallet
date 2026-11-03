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

import { Array as Arr, DateTime, Duration, Either, HashSet, Option, Order, pipe } from 'effect';
import { type PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities';
import {
  ProtocolVersion,
  WalletTransaction,
  type AnyTx,
  type FinalizedTx,
} from '@midnightntwrk/wallet-sdk-abstractions';
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';

/**
 * The key under which a transaction's history entry is stored.
 *
 * Prefer the ledger transaction hash — it's the canonical chain identifier and the value the indexer reports a
 * confirmed tx under. `transactionHash()` is only defined for proven + signed + bound transactions, though; it throws
 * for the other variants, notably the proof-erased transactions the simulator produces. In that case fall back to the
 * hex of the tx's serialized bytes: `serialize()` is total over every variant (it's the same encoding used to submit
 * the tx), so a key is always available — unlike `identifiers[0]`, which is an identifier, not a hash of the
 * transaction.
 *
 * Both the submit (pending) and revert (rejected) sides route through this one function so they can never disagree on
 * the key. The fallback is deterministic: the same transaction object yields the same bytes every time, and the
 * auto-revert path reverts the very object it submitted, so the rejected entry lands on the pending entry in place.
 * (Serialization differs across lifecycle states, so this is only stable for a fixed tx — which is exactly the
 * submit→revert flow.)
 */
export const txHistoryHash = (tx: { transactionHash: () => unknown; serialize: () => Uint8Array }): string => {
  try {
    return String(tx.transactionHash());
  } catch {
    return Buffer.from(tx.serialize()).toString('hex');
  }
};

/** How a coin is named wherever it is referred to without being carried: in a record, and in a release by id. */
export const coinIdsOf = (utxos: readonly { intentHash: string; outputNo: number }[]): readonly string[] =>
  utxos.map((utxo) => `${utxo.intentHash}#${utxo.outputNo}`);

type SpentCoins = { readonly inputs: readonly { readonly intentHash: string; readonly outputNo: number }[] };
type ShieldedOffer = { readonly inputs: readonly { readonly nullifier: string }[] };

/**
 * What a lifecycle record's facts are read off a finalized transaction; the same on ledger-v8 and ledger-v9, so both
 * traits share it.
 */
type FactsBearingTransaction = {
  readonly intents:
    | ReadonlyMap<
        number,
        {
          readonly ttl: Date;
          readonly dustActions?: { readonly spends: readonly unknown[] } | undefined;
          intentHash(segmentId: number): string;
          readonly guaranteedUnshieldedOffer: SpentCoins | undefined;
          readonly fallibleUnshieldedOffer: SpentCoins | undefined;
        }
      >
    | undefined;
  readonly guaranteedOffer: ShieldedOffer | undefined;
  readonly fallibleOffer: ReadonlyMap<number, ShieldedOffer> | undefined;
};

/**
 * The one TTL rule, closed over the ledger whose grace period it reads: a transaction can be included until the
 * earliest of its intent TTLs, or, when it spends Dust, carries shielded offers, or carries no intent at all, until the
 * Dust grace period after its creation if that comes first. The grace period is the wallet's own backstop rather than a
 * ledger rule; it is what lets a rewards or bridge claim, which has no intents and no offers and which the indexer
 * never reports a status for, leave the pending set at all.
 */
const ttlUnder =
  (dustGracePeriodSeconds: () => bigint) =>
  (tx: FactsBearingTransaction, createdAt: DateTime.Utc): Date => {
    const intents = [...(tx.intents?.values() ?? [])];
    const intentTTLs = Arr.filterMap(intents, (intent) => DateTime.make(intent.ttl));
    const spendsDust = intents.some((intent) => (intent.dustActions?.spends.length ?? 0) > 0);
    const hasShieldedOffers = tx.guaranteedOffer != null || (tx.fallibleOffer?.size ?? 0) > 0;
    const backstop = DateTime.addDuration(createdAt, Duration.seconds(Number(dustGracePeriodSeconds())));
    return DateTime.toDate(
      Arr.match(intentTTLs, {
        onEmpty: () => backstop,
        onNonEmpty: (ttls) => {
          const earliest = Arr.min(ttls, DateTime.Order);
          return spendsDust || hasShieldedOffers ? DateTime.min(earliest, backstop) : earliest;
        },
      }),
    );
  };

/** Passed, not reached: a transaction is still valid at the instant its TTL names. */
const hasTTLExpiredUnder =
  (dustGracePeriodSeconds: () => bigint) =>
  (tx: FactsBearingTransaction, creationTime: DateTime.Utc, now: DateTime.Utc): boolean =>
    DateTime.toEpochMillis(now) > ttlUnder(dustGracePeriodSeconds)(tx, creationTime).getTime();

/** Each intent's hash, taken with the segment it sits in, as the ledger stamps it on the coins the intent creates. */
const intentHashesOf = (tx: FactsBearingTransaction): readonly string[] =>
  [...(tx.intents?.entries() ?? [])].map(([segment, intent]) => intent.intentHash(segment));

/** Every coin the transaction spends, whoever owns it; `shielded` only when it spends a shielded coin. */
const inputsOf = (tx: FactsBearingTransaction): PendingTransactions.Reservation['inputs'] => {
  const unshielded = coinIdsOf(
    [...(tx.intents?.values() ?? [])].flatMap((intent) => [
      ...(intent.guaranteedUnshieldedOffer?.inputs ?? []),
      ...(intent.fallibleUnshieldedOffer?.inputs ?? []),
    ]),
  );
  const shielded = [
    ...(tx.guaranteedOffer?.inputs ?? []),
    ...[...(tx.fallibleOffer?.values() ?? [])].flatMap((offer) => offer.inputs),
  ].map((input) => input.nullifier);
  return shielded.length === 0 ? { unshielded } : { unshielded, shielded };
};

const v9DustGracePeriod = (): bigint => ledgerV9.LedgerParameters.initialParameters().dust.dustGracePeriodSeconds;
const v8DustGracePeriod = (): bigint => ledgerV8.LedgerParameters.initialParameters().dust.dustGracePeriodSeconds;

export const v9FinalizedTransactionTrait: PendingTransactions.TransactionTrait<ledgerV9.FinalizedTransaction> = {
  areAllTxIdsIncluded(tx: ledgerV9.FinalizedTransaction, txIds: readonly string[]): boolean {
    const txIdsSet = HashSet.fromIterable(tx.identifiers());
    const expectedIdSet = HashSet.fromIterable(txIds);
    return HashSet.isSubset(txIdsSet, expectedIdSet);
  },
  deserialize(serialized: Uint8Array): ledgerV9.FinalizedTransaction {
    return ledgerV9.Transaction.deserialize('signature', 'proof', 'binding', serialized);
  },
  firstId(tx: ledgerV9.FinalizedTransaction): string {
    return tx.identifiers()[0];
  },
  hasTTLExpired: hasTTLExpiredUnder(v9DustGracePeriod),
  intentHashes: intentHashesOf,
  inputs: inputsOf,
  ttl: ttlUnder(v9DustGracePeriod),
  ids(tx: ledgerV9.FinalizedTransaction): readonly string[] {
    return tx.identifiers();
  },
  isOneIncludedInOther(tx: ledgerV9.FinalizedTransaction, otherTx: ledgerV9.FinalizedTransaction): boolean {
    const txIds = HashSet.fromIterable(tx.identifiers());
    const otherTxIds = HashSet.fromIterable(otherTx.identifiers());
    const smallerSize = Order.min(Order.number)(HashSet.size(txIds), HashSet.size(otherTxIds));
    const intersection = HashSet.intersection(txIds, otherTxIds);
    return HashSet.size(intersection) == smallerSize;
  },
  isTx(tx: unknown): tx is ledgerV9.FinalizedTransaction {
    return tx instanceof ledgerV9.Transaction;
  },
  serialize(tx: ledgerV9.FinalizedTransaction): Uint8Array {
    return tx.serialize();
  },
};

/**
 * The ledger-v8's reading of a pending transaction.
 *
 * @remarks
 *   Structurally the same as ledger-v9's — identifiers, a TTL, bytes — against a different ledger version's classes. It
 *   is the classes that make this a separate trait: `instanceof` distinguishes them, each deserializer refuses the
 *   other's bytes, and a grace period is read off that version's own initial parameters.
 */
export const v8FinalizedTransactionTrait: PendingTransactions.TransactionTrait<ledgerV8.FinalizedTransaction> = {
  areAllTxIdsIncluded(tx, txIds) {
    return HashSet.isSubset(HashSet.fromIterable(tx.identifiers()), HashSet.fromIterable(txIds));
  },
  deserialize(serialized) {
    return ledgerV8.Transaction.deserialize('signature', 'proof', 'binding', serialized);
  },
  firstId(tx) {
    return tx.identifiers()[0];
  },
  hasTTLExpired: hasTTLExpiredUnder(v8DustGracePeriod),
  intentHashes: intentHashesOf,
  inputs: inputsOf,
  ttl: ttlUnder(v8DustGracePeriod),
  ids(tx) {
    return tx.identifiers();
  },
  isOneIncludedInOther(tx, otherTx) {
    const txIds = HashSet.fromIterable(tx.identifiers());
    const otherTxIds = HashSet.fromIterable(otherTx.identifiers());
    const smallerSize = Order.min(Order.number)(HashSet.size(txIds), HashSet.size(otherTxIds));
    return HashSet.size(HashSet.intersection(txIds, otherTxIds)) == smallerSize;
  },
  isTx(tx: unknown): tx is ledgerV8.FinalizedTransaction {
    return tx instanceof ledgerV8.Transaction;
  },
  serialize(tx) {
    return tx.serialize();
  },
};

/**
 * Lifts one ledger version's trait onto the handle the facade actually carries.
 *
 * @remarks
 *   The router has already chosen this trait by the version stamped on the handle, so unwrapping at the same epoch is a
 *   restatement of the choice rather than a second one — but it is where a handle that does not belong is refused
 *   rather than handed to a reader that would misread it. A handle it cannot read is reported as not being its
 *   transaction at all, which is precisely what `isTx` is for.
 * @param trait The ledger version's own reading of a transaction.
 * @param epoch The range of protocol versions that ledger version answers for.
 * @returns The same reading, in terms of handles.
 */
const overHandles = <T extends { serialize: () => Uint8Array }>(
  trait: PendingTransactions.TransactionTrait<T>,
  epoch: ProtocolVersion.ProtocolVersion.Range,
): PendingTransactions.TransactionTrait<FinalizedTx> => {
  const [stamp] = epoch;
  const carried = (handle: AnyTx): T => Either.getOrThrow(WalletTransaction.unwrapWithin<T>(handle, epoch));
  return {
    ids: (tx) => trait.ids(carried(tx)),
    firstId: (tx) => trait.firstId(carried(tx)),
    areAllTxIdsIncluded: (tx, txIds) => trait.areAllTxIdsIncluded(carried(tx), txIds),
    isOneIncludedInOther: (tx, otherTx) => trait.isOneIncludedInOther(carried(tx), carried(otherTx)),
    hasTTLExpired: (tx, creationTime, now) => trait.hasTTLExpired(carried(tx), creationTime, now),
    intentHashes: (tx) => trait.intentHashes(carried(tx)),
    inputs: (tx) => trait.inputs(carried(tx)),
    ttl: (tx, createdAt) => trait.ttl(carried(tx), createdAt),
    serialize: (tx) => trait.serialize(carried(tx)),
    deserialize: (serialized) => WalletTransaction.adopt('Finalized', trait.deserialize(serialized), stamp),
    isTx: (tx: unknown): tx is FinalizedTx =>
      WalletTransaction.is(tx) &&
      Either.match(WalletTransaction.unwrapWithin<unknown>(tx, epoch), {
        onLeft: () => false,
        onRight: (carried) => trait.isTx(carried),
      }),
  };
};

/**
 * The traits pending transactions are read with, split at the protocol version this chain forks at.
 *
 * @remarks
 *   One trait per ledger version, each reading the handle it is registered for and refusing the other's. That is what
 *   lets a transaction authored before the v9 fork be recognised as stranded once the wallets cross — its bytes can
 *   never be included afterwards — instead of waiting out a TTL for an inclusion that can never happen.
 * @param forkVersion The protocol version this chain forks at.
 * @returns The registry the pending transaction service reads with.
 */
export const finalizedTransactionTraits = (
  forkVersion: ProtocolVersion.ProtocolVersion,
): PendingTransactions.VersionedTransactionTrait<FinalizedTx> =>
  Either.getOrThrow(
    ProtocolVersion.makeRegistryFromActivations(
      forkVersion > ProtocolVersion.MinSupportedVersion
        ? [
            {
              sinceVersion: ProtocolVersion.MinSupportedVersion,
              value: overHandles(
                v8FinalizedTransactionTrait,
                ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, forkVersion),
              ),
            },
            {
              sinceVersion: forkVersion,
              value: overHandles(v9FinalizedTransactionTrait, ProtocolVersion.epochOf(forkVersion, forkVersion)),
            },
          ]
        : [
            {
              sinceVersion: ProtocolVersion.MinSupportedVersion,
              value: overHandles(
                v9FinalizedTransactionTrait,
                ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MinSupportedVersion),
              ),
            },
          ],
    ),
  );

type V8AnyTransaction = ledgerV8.Transaction<ledgerV8.SignatureEnabled, ledgerV8.Proofish, ledgerV8.Bindingish>;
type V9AnyTransaction = ledgerV9.Transaction<ledgerV9.SignatureEnabled, ledgerV9.Proofish, ledgerV9.Bindingish>;

/**
 * A transaction as its lifecycle record holds it: the ledger transaction, in whatever proof state the record's state
 * calls for, stamped with the protocol version it was built for.
 */
export type LifecycleTx = Readonly<{
  protocolVersion: ProtocolVersion.ProtocolVersion;
  transaction: V8AnyTransaction | V9AnyTransaction;
}>;

const isV8Transaction = (tx: unknown): tx is V8AnyTransaction => tx instanceof ledgerV8.Transaction;
const isV9Transaction = (tx: unknown): tx is V9AnyTransaction => tx instanceof ledgerV9.Transaction;

/** The ledger transaction `handle` carries, refused unless it is of the ledger the handle's version names. */
const carriedIn = (
  handle: AnyTx,
  forkVersion: ProtocolVersion.ProtocolVersion,
): V8AnyTransaction | V9AnyTransaction => {
  const carried = Either.getOrThrow(
    WalletTransaction.unwrapWithin<unknown>(handle, ProtocolVersion.epochOf(handle.protocolVersion, forkVersion)),
  );
  const isOwnLedger = handle.protocolVersion >= forkVersion ? isV9Transaction : isV8Transaction;
  return Option.getOrThrowWith(
    Option.liftPredicate(carried, (tx): tx is V8AnyTransaction | V9AnyTransaction => isOwnLedger(tx)),
    () => new Error(`A transaction stamped ${handle.protocolVersion} does not belong to that version's ledger.`),
  );
};

/**
 * The balanced transaction `handle` carries, with its proofs erased: identifiers, intent hashes and inputs survive
 * erasure, so the record still matches the transaction once it is proven and bound.
 *
 * @example
 *   const held = erasedOf(balancedHandle, configuration.forks.v9);
 *
 * @param handle The balanced transaction, at any stage.
 * @param forkVersion The protocol version this chain forks at, which says which ledger the handle's bytes are.
 * @returns The transaction as a balanced record holds it.
 */
export const erasedOf = (handle: AnyTx, forkVersion: ProtocolVersion.ProtocolVersion): LifecycleTx => ({
  protocolVersion: handle.protocolVersion,
  transaction: carriedIn(handle, forkVersion).eraseProofs(),
});

/**
 * The finalized transaction `handle` carries, as it is.
 *
 * @example
 *   const held = lifecycleTxOf(finalizedHandle, configuration.forks.v9);
 *
 * @param handle The finalized transaction.
 * @param forkVersion The protocol version this chain forks at, which says which ledger the handle's bytes are.
 * @returns The transaction as a finalized or submitted record holds it.
 */
export const lifecycleTxOf = (handle: FinalizedTx, forkVersion: ProtocolVersion.ProtocolVersion): LifecycleTx => ({
  protocolVersion: handle.protocolVersion,
  transaction: carriedIn(handle, forkVersion),
});

/**
 * The handle for a transaction a finalized or submitted record holds: the record keeps its bytes as they were
 * finalized, and its stamp beside them.
 *
 * @example
 *   const tx = finalizedOf(record.tx);
 *
 * @param held The transaction as the record holds it.
 * @returns The finalized handle it was recorded from.
 */
export const finalizedOf = (held: LifecycleTx): FinalizedTx =>
  WalletTransaction.adopt('Finalized', held.transaction, held.protocolVersion);

type LedgerTransaction = FactsBearingTransaction & { identifiers(): string[]; serialize(): Uint8Array };

/**
 * One ledger's reading of a record's transaction, whatever its proof state. The bytes are read as proven first, then as
 * proof-erased; which of the two a record holds is its state's to say, never the bytes', because a simulated prover
 * finalizes a transaction by erasing its proofs.
 */
const lifecycleTraitOf = <T extends (V8AnyTransaction | V9AnyTransaction) & LedgerTransaction>(
  isOwn: (tx: unknown) => tx is T,
  readProven: (bytes: Uint8Array) => T,
  readErased: (bytes: Uint8Array) => T,
  dustGracePeriodSeconds: () => bigint,
  epoch: ProtocolVersion.ProtocolVersion.Range,
): PendingTransactions.TransactionTrait<LifecycleTx> => {
  const [stamp] = epoch;
  const own = (held: LifecycleTx): T =>
    Option.getOrThrowWith(
      Option.liftPredicate(held.transaction, isOwn),
      () => new Error(`A transaction stamped ${held.protocolVersion} was handed to another ledger's trait.`),
    );
  const ids = (held: LifecycleTx): readonly string[] => own(held).identifiers();
  return {
    ids,
    firstId: (held) => ids(held)[0],
    areAllTxIdsIncluded: (held, txIds) =>
      HashSet.isSubset(HashSet.fromIterable(ids(held)), HashSet.fromIterable(txIds)),
    isOneIncludedInOther: (held, other) => {
      const heldIds = HashSet.fromIterable(ids(held));
      const otherIds = HashSet.fromIterable(ids(other));
      const smallerSize = Order.min(Order.number)(HashSet.size(heldIds), HashSet.size(otherIds));
      return HashSet.size(HashSet.intersection(heldIds, otherIds)) === smallerSize;
    },
    hasTTLExpired: (held, creationTime, now) =>
      hasTTLExpiredUnder(dustGracePeriodSeconds)(own(held), creationTime, now),
    intentHashes: (held) => intentHashesOf(own(held)),
    inputs: (held) => inputsOf(own(held)),
    ttl: (held, createdAt) => ttlUnder(dustGracePeriodSeconds)(own(held), createdAt),
    serialize: (held) => own(held).serialize(),
    deserialize: (bytes) => ({
      protocolVersion: stamp,
      transaction: pipe(
        Either.try(() => readProven(bytes)),
        Either.orElse(() => Either.try(() => readErased(bytes))),
        Either.getOrThrow,
      ),
    }),
    isTx: (held: unknown): held is LifecycleTx =>
      typeof held === 'object' && held !== null && 'transaction' in held && isOwn(held.transaction),
  };
};

const v8LifecycleTrait = (epoch: ProtocolVersion.ProtocolVersion.Range) =>
  lifecycleTraitOf(
    isV8Transaction,
    (bytes) => ledgerV8.Transaction.deserialize('signature', 'proof', 'binding', bytes),
    (bytes) => ledgerV8.Transaction.deserialize('signature', 'no-proof', 'no-binding', bytes),
    v8DustGracePeriod,
    epoch,
  );

const v9LifecycleTrait = (epoch: ProtocolVersion.ProtocolVersion.Range) =>
  lifecycleTraitOf(
    isV9Transaction,
    (bytes) => ledgerV9.Transaction.deserialize('signature', 'proof', 'binding', bytes),
    (bytes) => ledgerV9.Transaction.deserialize('signature', 'no-proof', 'no-binding', bytes),
    v9DustGracePeriod,
    epoch,
  );

/**
 * The traits lifecycle records are read with, split at the protocol version this chain forks at: one per ledger, each
 * reading only its own ledger's transactions, as {@link finalizedTransactionTraits} does for handles.
 *
 * @example
 *   const traits = lifecycleTransactionTraits(configuration.forks.v9);
 *
 * @param forkVersion The protocol version this chain forks at.
 * @returns The registry the transaction lifecycle service reads with.
 */
export const lifecycleTransactionTraits = (
  forkVersion: ProtocolVersion.ProtocolVersion,
): PendingTransactions.VersionedTransactionTrait<LifecycleTx> =>
  Either.getOrThrow(
    ProtocolVersion.makeRegistryFromActivations(
      forkVersion > ProtocolVersion.MinSupportedVersion
        ? [
            {
              sinceVersion: ProtocolVersion.MinSupportedVersion,
              value: v8LifecycleTrait(ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, forkVersion)),
            },
            {
              sinceVersion: forkVersion,
              value: v9LifecycleTrait(ProtocolVersion.epochOf(forkVersion, forkVersion)),
            },
          ]
        : [
            {
              sinceVersion: ProtocolVersion.MinSupportedVersion,
              value: v9LifecycleTrait(
                ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, ProtocolVersion.MinSupportedVersion),
              ),
            },
          ],
    ),
  );

/**
 * The transaction a recipe's parts make once merged, each part held as a lifecycle record holds it. Parts of one recipe
 * are all built for one ledger, so a part of another is refused rather than merged.
 *
 * @example
 *   const whole = mergedLifecycleTxs(BalancingRecipe.getTransactions(recipe).map((part) => erasedOf(part, fork)));
 *
 * @param parts The parts, the first of which stamps the result.
 * @returns The merged transaction.
 */
export const mergedLifecycleTxs = (parts: Arr.NonEmptyReadonlyArray<LifecycleTx>): LifecycleTx =>
  Arr.reduce(Arr.tailNonEmpty(parts), Arr.headNonEmpty(parts), (merged, part) => ({
    ...merged,
    transaction: Option.getOrThrowWith(
      mergedOnOneLedger(merged.transaction, part.transaction),
      () => new Error('The parts of one recipe were built for different ledgers.'),
    ),
  }));

const mergedOnOneLedger = (
  left: V8AnyTransaction | V9AnyTransaction,
  right: V8AnyTransaction | V9AnyTransaction,
): Option.Option<V8AnyTransaction | V9AnyTransaction> =>
  isV9Transaction(left) && isV9Transaction(right)
    ? Option.some(left.merge(right))
    : isV8Transaction(left) && isV8Transaction(right)
      ? Option.some(left.merge(right))
      : Option.none();
