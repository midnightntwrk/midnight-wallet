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
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  type DefaultSubmissionConfiguration,
  makeDefaultSubmissionService,
  type SubmissionService,
} from '@midnightntwrk/wallet-sdk-capabilities';
import {
  type AnyVersionUnboundTransaction,
  type AnyVersionUnprovenTransaction,
  type DefaultProvingConfiguration,
  makeDefaultVersionedProvingService,
  type VersionedProvingService,
} from '@midnightntwrk/wallet-sdk-capabilities/proving';
import {
  type DefaultDustConfiguration,
  type DustKeysByEpoch,
  type DustWalletAPI,
  type DustWalletState,
  ManualSyncUnsupportedError,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { type CoinsAndBalances as DustCoinsAndBalances } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import {
  type DefaultShieldedConfiguration,
  type ShieldedKeysByEpoch,
  type ShieldedWalletAPI,
  type ShieldedWalletState,
  ShieldedSectionSchema,
  mergeShieldedSections,
} from '@midnightntwrk/wallet-sdk-shielded';
import type {
  DefaultUnshieldedConfiguration,
  SignSegment,
  UnshieldedWalletAPI,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  type UnshieldedWalletState,
  UnshieldedSectionSchema,
  mergeUnshieldedSections,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { TransactionOps as V1UnshieldedTransactionOps } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { TransactionOps as V2UnshieldedTransactionOps } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { DustSectionSchema, mergeDustSections } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { FetchTermsAndConditions as FetchTermsAndConditionsQuery } from '@midnightntwrk/wallet-sdk-indexer-client';
import { QueryRunner } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Array as Arr, Cause, DateTime, Effect, Either, Option, pipe, Schema } from 'effect';
import {
  type AnyTx,
  type FinalizedTx,
  ProtocolVersion,
  type WalletTransactionUnwrapError,
  TransactionHistoryStorage,
  type UnboundTx,
  type UnprovenTx,
  WalletTransaction,
  WireFormatError,
} from '@midnightntwrk/wallet-sdk-abstractions';
import * as ledgerV8 from '@midnightntwrk/ledger-v8';
import { type WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import * as Signatures from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import {
  BehaviorSubject,
  combineLatest,
  concatMap,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  type Observable,
  pairwise,
  type Subscription,
  take,
  tap,
} from 'rxjs';
import {
  classifySubmissionFailure,
  type DefaultTransactionLifecycleServiceConfiguration,
  type InclusionVerdict,
  Lifecycle,
  SubmissionFailure,
  TransactionTraits,
  type TransactionLifecycleService,
  TransactionLifecycleServiceImpl,
} from '@midnightntwrk/wallet-sdk-capabilities';
import {
  type AnyLedgerParameters,
  type AnyVersionValidatableTransaction,
  type BlockData,
  type BlockDataFetcher,
  LedgerParametersMismatchError,
  makeDefaultBlockDataFetcher,
  makeDefaultVersionedValidationService,
  type ValidateTxOptions,
  ValidationFetchError,
  type VersionedValidationService,
  WellFormedError,
  type WellFormedStrictnessFlags,
  withLedgerParameters,
} from '@midnightntwrk/wallet-sdk-capabilities/validation';
import {
  coinIdsOf,
  erasedOf,
  finalizedOf,
  lifecycleTxOf,
  lifecycleTransactionTraits,
  type LifecycleTx,
  mergedLifecycleTxs,
  txHistoryHash,
} from './transaction.js';

/**
 * The traits pending transactions are read with, exported so a test that restores a stored pending-transaction payload
 * reads it exactly as the wallet does. Building a second trait for that would be testing the copy, not the wallet.
 */
export { finalizedTransactionTraits, lifecycleTransactionTraits, type LifecycleTx } from './transaction.js';

/**
 * Why the wallet gave up on a transaction, for the history entry.
 *
 * @remarks
 *   A chain rejection speaks for itself through the entry's status; an orphaned transaction has no chain verdict at all,
 *   so the entry is the only place the reason can be recorded.
 */
const rejectionReason = (result: TransactionTraits.TransactionResult): string | undefined =>
  result.status === 'ORPHANED_BY_FORK' ? 'orphaned-by-protocol-upgrade' : undefined;

/** The end a record reached, as the verdict a release is decided by; none for an end that releases nothing. */
const endResultOf = (state: Lifecycle.LifecycleState): Option.Option<TransactionTraits.TransactionResult> => {
  switch (state._tag) {
    case 'Rejected':
      // A TTL that passed is a refusal no chain applied any of, so it releases as a failure with no segments.
      return Option.some(state.verdict.status === 'TTL_PASSED' ? { status: 'FAILURE', segments: [] } : state.verdict);
    case 'Orphaned':
      return Option.some({ status: 'ORPHANED_BY_FORK', authoredFor: state.authoredFor, chainNow: state.chainNow });
    default:
      return Option.none();
  }
};

const recordKey = (record: Lifecycle.LifecycleRecord<LifecycleTx>): string => record.identifiers.join(',');

/**
 * The states only a finalized transaction reaches: it is finalized, then submitted, and only a submitted one is
 * refused. A record in any of them holds its transaction finalized whatever form its stored bytes were read back in.
 */
const HOLDS_FINALIZED: ReadonlyArray<Lifecycle.LifecycleState['_tag']> = ['Finalized', 'Submitted', 'Rejected'];

/**
 * The finalized transaction a record holds, stamped with the version the record says it was built for; none while it
 * holds only the balanced transaction with its proofs erased, which is no finalized transaction, at whatever state the
 * record has reached since.
 *
 * @remarks
 *   A transaction read back from a store is stamped at the start of its epoch, because bytes carry no version; the record
 *   carries the one it was built for, which is the stamp its handle was recorded with.
 */
const finalizedHeldBy = (record: Lifecycle.LifecycleRecord<LifecycleTx>): Option.Option<FinalizedTx> =>
  heldAsFinalized({
    ...record,
    // A balanced record is moved there by balancing alone, which never hands it a finalized transaction.
    tx: Option.filter(
      record.tx,
      (held) =>
        record.state._tag !== 'Balanced' && (held.form === 'Finalized' || HOLDS_FINALIZED.includes(record.state._tag)),
    ),
  });

/** The handle for the transaction a record holds, for a caller that already knows it holds it finalized. */
const heldAsFinalized = (record: Lifecycle.LifecycleRecord<LifecycleTx>): Option.Option<FinalizedTx> =>
  Option.map(record.tx, (held) =>
    finalizedOf({ ...held, protocolVersion: Option.getOrElse(record.protocolVersion, () => held.protocolVersion) }),
  );

/**
 * The transactions whose records went from finalized or submitted to rejected or orphaned between two emissions, with
 * the verdict each release is decided by.
 *
 * @remarks
 *   A record that expires before it is submitted is not among them: what it releases is a narrower thing, decided by
 *   {@link newlyExpired}.
 */
const newlyEnded = (
  previous: ReadonlyArray<Lifecycle.LifecycleRecord<LifecycleTx>>,
  current: ReadonlyArray<Lifecycle.LifecycleRecord<LifecycleTx>>,
): ReadonlyArray<Readonly<{ tx: FinalizedTx; result: TransactionTraits.TransactionResult }>> => {
  const wasHeldFinalized = new Set(
    previous.filter((record) => record.state._tag === 'Finalized' || record.state._tag === 'Submitted').map(recordKey),
  );
  return Arr.filterMap(current, (record) =>
    wasHeldFinalized.has(recordKey(record))
      ? // Held finalized: it was finalized or submitted on the emission before.
        Option.all({ tx: heldAsFinalized(record), result: endResultOf(record.state) })
      : Option.none(),
  );
};

/**
 * The transactions whose records went from balanced or finalized to expired between two emissions: their TTL passed
 * before they were submitted.
 *
 * @remarks
 *   Only their Dust is released from here. The shielded and unshielded wallets booked their coins with the same TTL and
 *   sweep them once it passes; a second release by coin could free a coin booked again since for another transaction.
 *   The dust wallet holds a spend until its own grace period runs out, which can be long after the TTL.
 *
 *   A balanced record holds its transaction with the proofs erased, and it is handed over as a finalized handle all the
 *   same: the dust wallet matches a booking by each intent's Dust spends and their creation time, which the erased form
 *   keeps.
 */
const newlyExpired = (
  previous: ReadonlyArray<Lifecycle.LifecycleRecord<LifecycleTx>>,
  current: ReadonlyArray<Lifecycle.LifecycleRecord<LifecycleTx>>,
): ReadonlyArray<FinalizedTx> => {
  const wasUnsubmitted = new Set(
    previous.filter((record) => record.state._tag === 'Balanced' || record.state._tag === 'Finalized').map(recordKey),
  );
  return Arr.filterMap(current, (record) =>
    record.state._tag === 'Expired' && wasUnsubmitted.has(recordKey(record)) ? heldAsFinalized(record) : Option.none(),
  );
};

/** The fallible segments a verdict says the chain did not apply; none for a verdict that carries no segments. */
const failedSegmentsOf = (result: TransactionTraits.TransactionResult): ReadonlyArray<number> =>
  'segments' in result ? result.segments.filter((segment) => !segment.success).map((segment) => segment.id) : [];

/**
 * The verdict a history entry's status gives, where it gives enough to act on. A partial success gives none: what it
 * releases depends on which segments failed, which only the indexer reports, so the poller settles it.
 */
const inclusionVerdictOf = (
  status: TransactionHistoryStorage.TransactionHistoryStatus | undefined,
): Option.Option<InclusionVerdict> =>
  status === 'SUCCESS'
    ? Option.some({ status: 'SUCCESS' })
    : status === 'FAILURE'
      ? Option.some({ status: 'FAILURE', segments: [] })
      : Option.none();

/**
 * `storage`, with every inclusion a wallet's sync writes also moving the transaction's lifecycle record, once the write
 * has succeeded: a record must not show an inclusion the history failed to keep.
 */
const feedingInclusions = (
  storage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>,
  lifecycle: TransactionLifecycleService<LifecycleTx>,
): TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry> => ({
  getAll: () => storage.getAll(),
  get: (hash) => storage.get(hash),
  serialize: () => storage.serialize(),
  gotPending: (entry) => storage.gotPending(entry),
  gotRejected: (entry) => storage.gotRejected(entry),
  gotFinalized: async (entry) => {
    await storage.gotFinalized(entry);
    await Option.match(inclusionVerdictOf(entry.status), {
      onNone: () => Promise.resolve(),
      onSome: (verdict) => lifecycle.included(entry.identifiers, verdict),
    });
  },
});
import {
  type DustAddress,
  type ShieldedAddress,
  type UnshieldedAddress,
} from '@midnightntwrk/wallet-sdk-address-format';

/**
 * Full entry schema for transaction history. The common entry data and wallet-specific sections (`shielded`,
 * `unshielded`, `dust`) live on every entry regardless of lifecycle; the `lifecycle` field is the only discriminator.
 * Pass this to `InMemoryTransactionHistoryStorage` to enable serialize/restore.
 */
export const WalletEntrySchema = TransactionHistoryStorage.extendEntrySchema({
  shielded: Schema.optional(ShieldedSectionSchema),
  unshielded: Schema.optional(UnshieldedSectionSchema),
  dust: Schema.optional(DustSectionSchema),
});

export type WalletEntry = Schema.Schema.Type<typeof WalletEntrySchema>;

/** A `WalletEntry` whose lifecycle is `pending`. */
export type PendingWalletEntry = WalletEntry & { readonly lifecycle: TransactionHistoryStorage.PendingLifecycle };

/** A `WalletEntry` whose lifecycle is `finalized`. */
export type FinalizedWalletEntry = WalletEntry & { readonly lifecycle: TransactionHistoryStorage.FinalizedLifecycle };

export const isPendingWalletEntry = (entry: WalletEntry): entry is PendingWalletEntry =>
  entry.lifecycle.status === 'pending';

export const isFinalizedWalletEntry = (entry: WalletEntry): entry is FinalizedWalletEntry =>
  entry.lifecycle.status === 'finalized';

/**
 * Combine two optional values under a merge function: if both sides have it, delegate to `merge`; otherwise return
 * whichever side is present (or `undefined` if neither). Encapsulates the four-way pattern used for every wallet
 * section in {@link mergeWalletEntries}.
 */
const mergeOptionalSection = <T>(
  existing: T | undefined,
  incoming: T | undefined,
  merge: (a: T, b: T) => T,
): T | undefined => {
  if (existing !== undefined && incoming !== undefined) return merge(existing, incoming);
  return existing ?? incoming;
};

/**
 * Merge two wallet entries arriving under the same hash. Treats the entry as `T × lifecycle` per the storage model:
 *
 * - **Shared scalar facts about the tx** (`protocolVersion`, `status`, `timestamp`, `fees`) — first writer wins. Once any
 *   wallet has set the value, later writes are no-ops for these fields. This is correct because the value is the same
 *   across all wallets (it's a property of the on-chain tx, not the wallet's view of it).
 * - **`identifiers`** — unioned (each wallet may surface a different identifier subset).
 * - **`lifecycle`** — incoming wins, except that a late rejection cannot overwrite recorded on-chain inclusion.
 * - **Wallet sections** (`shielded`, `unshielded`, `dust`) — combined via per-section merge when both sides have them;
 *   otherwise whichever side is present is used.
 * - **Fields this build does not declare** — kept from both sides, incoming winning a shared name. A storage that keeps
 *   such fields on the entry value itself hands them to this merge on every later write to the same transaction, so
 *   dropping them here would lose them as surely as a reader ignoring them.
 */
export function mergeWalletEntries(existing: WalletEntry, incoming: WalletEntry): WalletEntry {
  // identifiers: each wallet may surface a different subset, so union them
  const identifiers = Array.from(new Set([...existing.identifiers, ...incoming.identifiers]));

  // wallet sections: per-section merge when both sides have it; whichever side is present otherwise
  const shielded = mergeOptionalSection(existing.shielded, incoming.shielded, mergeShieldedSections);
  const unshielded = mergeOptionalSection(existing.unshielded, incoming.unshielded, mergeUnshieldedSections);
  const dust = mergeOptionalSection(existing.dust, incoming.dust, mergeDustSections);

  return {
    // fields this build does not declare: both sides spread first, so every declared field below overrides them
    ...existing,
    ...incoming,
    hash: existing.hash,
    identifiers,
    // shared scalar facts about the on-chain tx — first writer wins (same value across all wallets)
    protocolVersion: existing.protocolVersion ?? incoming.protocolVersion,
    status: existing.status ?? incoming.status,
    timestamp: existing.timestamp ?? incoming.timestamp,
    fees: existing.fees ?? incoming.fees,
    lifecycle:
      existing.lifecycle.status === 'finalized' && incoming.lifecycle.status === 'rejected'
        ? existing.lifecycle
        : incoming.lifecycle,
    ...(shielded !== undefined ? { shielded } : {}),
    ...(unshielded !== undefined ? { unshielded } : {}),
    ...(dust !== undefined ? { dust } : {}),
  };
}

/**
 * What the facade itself does to a transaction, stated structurally rather than by ledger version.
 *
 * @remarks
 *   The facade merges, binds and reads identifiers off transactions, and both ledger versions do all of that with the
 *   same member names — the types are nominally distinct only because of what is _inside_ them. So once the handle's
 *   stamp has settled which epoch a transaction belongs to, one code path serves both, and the epoch check is the whole
 *   of the guarantee. Naming either ledger version's class here instead would be naming the thing that breaks when the
 *   chain moves on.
 *
 *   Deliberately the minimum: every member below is one the facade actually calls. Nothing here can mix epochs, because
 *   the only way to obtain one of these is to unwrap a handle within a single epoch's range.
 */
type Carried = Readonly<{
  identifiers: () => readonly string[];
  transactionHash: () => unknown;
  serialize: () => Uint8Array;
  eraseProofs: () => { serialize: () => Uint8Array };
}>;

/** An intent as the facade reads it, for finding and signing a dust registration. */
type CarriedIntent = Readonly<{
  dustActions?: Readonly<{ registrations?: readonly unknown[] }> | undefined;
  signatureData: (segment: number) => Uint8Array;
}>;

/** An unproven transaction the facade can merge with another of the same epoch, and inspect for a registration. */
type CarriedUnproven = Carried &
  Readonly<{
    merge: (other: CarriedUnproven) => CarriedUnproven;
    mockProve: () => CarriedUnbound;
    intents?: Readonly<{ get: (segment: number) => CarriedIntent | undefined }> | undefined;
  }>;

/** A proven transaction that has not yet been bound to its own contents. */
type CarriedUnbound = Carried & Readonly<{ bind: () => CarriedFinalized }>;

/** A finalized transaction, which the facade merges with the balancing transaction it finalized alongside it. */
type CarriedFinalized = Carried & Readonly<{ merge: (other: CarriedFinalized) => CarriedFinalized }>;

/**
 * Every transaction shape the facade will take from a caller.
 *
 * @remarks
 *   Now a handle: what an application carries between facade calls is sealed together with the protocol version it was
 *   built at, so it can be routed rather than guessed about. The name is kept because it is what these signatures have
 *   always been stated in terms of.
 */
export type AnyTransaction = AnyTx;

/**
 * Storage key for a tx we're about to submit (record as pending). The hash comes from {@link txHistoryHash}, which the
 * revert side uses too — so a tx keyed here while pending resolves to the same key when later confirmed or reverted.
 */
const submitTxHistoryKey = (tx: Carried): { readonly hash: string; readonly identifiers: readonly string[] } => ({
  hash: txHistoryHash(tx),
  identifiers: tx.identifiers(),
});

/**
 * Storage key for a tx we're about to revert (record as rejected). Shares {@link txHistoryHash} with the submit side so
 * the rejected entry lands on the pending entry in place. Returns `undefined` only when the tx has no identifiers at
 * all (nothing to revert).
 */
const revertTxHistoryKey = (
  tx: Carried,
): { readonly hash: string; readonly identifiers: readonly string[] } | undefined => {
  const identifiers = tx.identifiers();
  if (identifiers.length === 0) return undefined;
  return { hash: txHistoryHash(tx), identifiers };
};

/**
 * How a stage's bytes are read, one entry per stage a handle can be at.
 *
 * @remarks
 *   A stage is the wallet layer's word for a combination of the ledger's own markers — which signatures, proofs and
 *   binding the bytes carry — and those markers are part of what the ledger checks as it reads. Stating the three
 *   combinations here is what lets a caller name a stage instead of a marker triple, and is why bytes at another stage
 *   are refused rather than misread. The ledger's other marker combinations are deliberately absent: a handle has no
 *   stage for signature-erased transactions, so the facade cannot be asked for one.
 */
type StageDeserializers = Readonly<
  Record<WalletTransaction.Stage, (bytes: Uint8Array) => { serialize: () => Uint8Array }>
>;

/**
 * The ledger operations the facade performs for itself rather than through a wallet, per protocol epoch.
 *
 * @remarks
 *   Two of them. Estimating what a dust registration will cost needs a signature over a transaction nobody will submit,
 *   and a signature comes from a ledger version's own primitives; what those hand back is in the ledger-v9's shape — a
 *   scheme and its bytes — so the ledger-v8 entries lift what their ledger version writes as bare hex. Reading bytes an
 *   application hands in needs the deserializer of the ledger version that wrote them, and hands back nothing that
 *   names a version: what it returns goes straight into a handle, which erases the type.
 */
type EpochAuthoring = Readonly<{
  sampleSigningKey: () => unknown;
  signatureVerifyingKey: (signingKey: never) => ledgerV9.SignatureVerifyingKey;
  signData: (signingKey: never, data: Uint8Array) => ledgerV9.Signature;
  deserializers: StageDeserializers;
}>;

const v9Authoring: EpochAuthoring = {
  sampleSigningKey: () => ledgerV9.sampleSigningKey(),
  signatureVerifyingKey: (signingKey: never) => ledgerV9.signatureVerifyingKey(signingKey),
  signData: (signingKey: never, data: Uint8Array) => ledgerV9.signData(signingKey, data),
  deserializers: {
    Unproven: (bytes) => ledgerV9.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes),
    Unbound: (bytes) => ledgerV9.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes),
    Finalized: (bytes) => ledgerV9.Transaction.deserialize('signature', 'proof', 'binding', bytes),
  },
};

const v8Authoring: EpochAuthoring = {
  sampleSigningKey: () => ledgerV8.sampleSigningKey(),
  signatureVerifyingKey: (signingKey: never) =>
    Signatures.liftSignatureVerifyingKey(ledgerV8.signatureVerifyingKey(signingKey)),
  signData: (signingKey: never, data: Uint8Array) => Signatures.liftSignature(ledgerV8.signData(signingKey, data)),
  deserializers: {
    Unproven: (bytes) => ledgerV8.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes),
    Unbound: (bytes) => ledgerV8.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes),
    Finalized: (bytes) => ledgerV8.Transaction.deserialize('signature', 'proof', 'binding', bytes),
  },
};

type TokenKind = 'dust' | 'shielded' | 'unshielded';

type TokenKindsToBalance = 'all' | TokenKind[];

const TokenKindsToBalance = new (class {
  allTokenKinds = ['shielded', 'unshielded', 'dust'];
  toFlags = (tokenKinds: TokenKindsToBalance) => {
    return pipe(
      tokenKinds,
      (kinds) => (kinds === 'all' ? this.allTokenKinds : kinds),
      (kinds) => ({
        shouldBalanceUnshielded: kinds.includes('unshielded'),
        shouldBalanceShielded: kinds.includes('shielded'),
        shouldBalanceDust: kinds.includes('dust'),
      }),
    );
  };
})();

export type FinalizedTransactionRecipe = {
  type: 'FINALIZED_TRANSACTION';
  /** The protocol version this recipe was built for, and so the version its parts have to be proved at. */
  protocolVersion: ProtocolVersion.ProtocolVersion;
  originalTransaction: FinalizedTx;
  balancingTransaction: UnprovenTx;
  blockData?: BlockData<AnyLedgerParameters>;
};

export type UnboundTransactionRecipe = {
  type: 'UNBOUND_TRANSACTION';
  /** The protocol version this recipe was built for, and so the version its parts have to be proved at. */
  protocolVersion: ProtocolVersion.ProtocolVersion;
  baseTransaction: UnboundTx;
  // balancingTransaction is optional because if the user decides to balance only the unshielded part,
  // it occurs "in place" so the baseTransaction is modified
  balancingTransaction?: UnprovenTx | undefined;
  blockData?: BlockData<AnyLedgerParameters>;
};

export type UnprovenTransactionRecipe = {
  type: 'UNPROVEN_TRANSACTION';
  /** The protocol version this recipe was built for, and so the version its parts have to be proved at. */
  protocolVersion: ProtocolVersion.ProtocolVersion;
  transaction: UnprovenTx;
  blockData?: BlockData<AnyLedgerParameters>;
};

export type BalancingRecipe = FinalizedTransactionRecipe | UnboundTransactionRecipe | UnprovenTransactionRecipe;

/**
 * The block a fee was priced against, as a recipe carries it to validation.
 *
 * @remarks
 *   The dust wallet hands that block back with parameters it leaves untyped, because they are its pricing variant's own
 *   ledger object. Parameters neither ledger version recognises leave the recipe without block data, and validation
 *   then fetches a block of its own.
 */
const pricedBlockOf = (
  dustResult: Readonly<{ blockData: BlockData<unknown> }> | undefined,
): { blockData?: BlockData<AnyLedgerParameters> } =>
  pipe(
    Option.fromNullable(dustResult),
    Option.flatMap(({ blockData }) => withLedgerParameters(blockData)),
    Option.match({ onNone: () => ({}), onSome: (blockData) => ({ blockData }) }),
  );

export const BalancingRecipe = {
  isRecipe: (value: unknown): value is BalancingRecipe => {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      typeof value.type === 'string' &&
      ['FINALIZED_TRANSACTION', 'UNBOUND_TRANSACTION', 'UNPROVEN_TRANSACTION'].includes(value.type)
    );
  },
  getTransactions: (recipe: BalancingRecipe): readonly AnyTx[] => {
    switch (recipe.type) {
      case 'FINALIZED_TRANSACTION': {
        return [recipe.originalTransaction, recipe.balancingTransaction];
      }
      case 'UNBOUND_TRANSACTION': {
        const balancingPart = recipe.balancingTransaction ? [recipe.balancingTransaction] : [];
        return [recipe.baseTransaction, ...balancingPart];
      }
      case 'UNPROVEN_TRANSACTION': {
        return [recipe.transaction];
      }
    }
  },
};

export interface TokenTransfer<AddressType extends ShieldedAddress | UnshieldedAddress> {
  type: ledgerV9.RawTokenType;
  receiverAddress: AddressType;
  amount: bigint;
}

export type ShieldedTokenTransfer = {
  type: 'shielded';
  outputs: TokenTransfer<ShieldedAddress>[];
};

export type UnshieldedTokenTransfer = {
  type: 'unshielded';
  outputs: TokenTransfer<UnshieldedAddress>[];
};

export type CombinedTokenTransfer = ShieldedTokenTransfer | UnshieldedTokenTransfer;

export type CombinedSwapInputs = {
  shielded?: Record<ledgerV9.RawTokenType, bigint>;
  unshielded?: Record<ledgerV9.RawTokenType, bigint>;
};

export type CombinedSwapOutputs = CombinedTokenTransfer;

export type TransactionIdentifier = string;

export type UtxoWithMeta = {
  utxo: ledgerV9.Utxo;
  meta: {
    ctime: Date;
    registeredForDustGeneration: boolean;
  };
};

/** The protocol version each of the three wallets has reached. */
export type WalletProtocolVersions = Readonly<{
  shielded: ProtocolVersion.ProtocolVersion;
  unshielded: ProtocolVersion.ProtocolVersion;
  dust: ProtocolVersion.ProtocolVersion;
}>;

/**
 * The lowest of the protocol versions the three wallets have reached.
 *
 * @remarks
 *   The three wallets follow the same chain but not in lock-step: each recognises a protocol version change when its own
 *   synchronization reaches it, so around a fork they disagree for a while. A transaction spans all three, so the one
 *   still behind is what bounds the facade as a whole — the highest version every wallet is known to be at.
 * @param versions The version each wallet has reached.
 * @returns The lowest of the three.
 */
export const lowestProtocolVersion = (versions: WalletProtocolVersions): ProtocolVersion.ProtocolVersion =>
  [versions.shielded, versions.unshielded, versions.dust].reduce((lowest, candidate) =>
    candidate < lowest ? candidate : lowest,
  );

/**
 * One ledger version's key objects per side of a protocol boundary.
 *
 * @remarks
 *   The escape hatch for a caller that holds key objects rather than a seed. Both sides are required: key objects belong
 *   to one ledger version's runtime and neither can be derived from the other, so a facade given one side alone would
 *   hold wallets that cannot read half the chain. That is the shape seeds exist to avoid, and a product with one side
 *   optional would reintroduce it.
 */
export type FacadeKeysByEpoch = Readonly<{
  /** The ledger-v8's key objects. */
  v8: Readonly<{ shielded: ledgerV8.ZswapSecretKeys; dust: ledgerV8.DustSecretKey }>;
  /** The ledger-v9's key objects. */
  v9: Readonly<{ shielded: ledgerV9.ZswapSecretKeys; dust: ledgerV9.DustSecretKey }>;
}>;

/** What the facade will start its wallets from: seeds, or both ledger versions' key objects. */
export type FacadeStartMaterial = WalletSeeds | FacadeKeysByEpoch;

/** How the wallets are started. */
export type FacadeStartOptions = Readonly<{
  /**
   * Leaves the dust wallet unstarted in the background, to be driven a step at a time with `doSync`.
   *
   * @remarks
   *   Requires a dust wallet built with the projections sync service; see `makeEventLessSyncService`. That service needs
   *   ledger-v9, so while the dust wallet is below `forks.v9` `start` refuses this option, before starting anything:
   *   start without it there, and the dust wallet synchronizes in the background.
   */
  manualSync?: boolean;
}>;

/**
 * One ledger version's shielded keys per side of the boundary, from whichever material the caller supplied.
 *
 * @remarks
 *   What the shielded wallet is started with, whatever its composition: one spanning the boundary takes both sides, one
 *   composed for ledger-v9 alone takes the `v9` side. A seed is turned into keys here, with each ledger version's own
 *   derivation, because a wallet takes keys and never a seed.
 */
const shieldedKeysOf = (material: FacadeStartMaterial): ShieldedKeysByEpoch =>
  'v9' in material
    ? { v8: material.v8.shielded, v9: material.v9.shielded }
    : {
        v8: ledgerV8.ZswapSecretKeys.fromSeed(material.shielded),
        v9: ledgerV9.ZswapSecretKeys.fromSeed(material.shielded),
      };

/**
 * One ledger version's dust key per side of the boundary, from whichever material the caller supplied.
 *
 * @remarks
 *   What the dust wallet is started and stepped with, whatever its composition, for the same reasons as
 *   {@link shieldedKeysOf}.
 */
const dustKeysOf = (material: FacadeStartMaterial): DustKeysByEpoch =>
  'v9' in material
    ? { v8: material.v8.dust, v9: material.v9.dust }
    : { v8: ledgerV8.DustSecretKey.fromSeed(material.dust), v9: ledgerV9.DustSecretKey.fromSeed(material.dust) };

/** Which of the three wallets a reading is about. */
export type WalletKind = keyof WalletProtocolVersions;

/**
 * Whether the three wallets agree about which side of a protocol boundary the chain is on.
 *
 * @remarks
 *   `Settled` is the ordinary state, and says which protocol version the facade is acting at. `Crossing` is the window
 *   around a fork during which the wallets disagree: each one learns of the change when its own synchronization reaches
 *   it, so for a while some have crossed and some have not. Nothing the facade builds during that window can span the
 *   boundary, so it stays bound to the version the laggards are still on — which is what `from` reports, and what
 *   `activeProtocolVersion` answers.
 *
 *   A difference in version _within_ one epoch is not a crossing: two versions on the same side of the boundary are the
 *   same ledger version, and a wallet lagging there is ordinary synchronization.
 */
export type ProtocolPhase =
  | Readonly<{ _tag: 'Settled'; version: ProtocolVersion.ProtocolVersion }>
  | Readonly<{
      _tag: 'Crossing';
      /** The version the facade is still bound to: the epoch the wallets that have not crossed are in. */
      from: ProtocolVersion.ProtocolVersion;
      /** The version the wallets that have crossed have reached. */
      to: ProtocolVersion.ProtocolVersion;
      /** The wallets still on the near side, in a fixed order, so an application can say what it is waiting for. */
      behind: readonly WalletKind[];
    }>;

/** The three wallets in a fixed order, so {@link protocolPhaseOf} reports them the same way every time. */
const walletKinds = ['shielded', 'unshielded', 'dust'] as const satisfies readonly WalletKind[];

/**
 * Reads whether the wallets are settled on one side of a protocol boundary, or still crossing it.
 *
 * @remarks
 *   Derived entirely from the version each wallet has reported and where the boundary lies — the same two facts every
 *   other version-routing decision in the SDK is made from, so this reading cannot disagree with them.
 * @param versions The version each wallet has reached.
 * @param forkVersion The version at which the chain hands over to the next ledger version.
 * @returns The reading. See {@link ProtocolPhase}.
 */
export const protocolPhaseOf = (
  versions: WalletProtocolVersions,
  forkVersion: ProtocolVersion.ProtocolVersion,
): ProtocolPhase => {
  const reported = walletKinds.map((kind) => [kind, versions[kind]] as const);
  const from = lowestProtocolVersion(versions);
  const epoch = ProtocolVersion.epochOf(from, forkVersion);
  const crossed = reported.filter(([, version]) => !ProtocolVersion.withinRange(version, epoch));

  if (crossed.length === 0) return { _tag: 'Settled', version: from };

  return {
    _tag: 'Crossing',
    from,
    to: crossed.reduce((highest, [, version]) => (version > highest ? version : highest), crossed[0][1]),
    behind: reported.filter(([, version]) => ProtocolVersion.withinRange(version, epoch)).map(([kind]) => kind),
  };
};

/**
 * What has become of a transaction the wallet keeps a lifecycle record for.
 *
 * @remarks
 *   Tagged rather than a status string, and deliberately: each tag is a different fact about the transaction, and the
 *   difference matters to what an application does next.
 *
 *   - `Balanced`, `Finalized` and `Submitted` still await an answer (see {@link isAwaiting}): the coins stay booked, and the
 *       transaction may yet be included.
 *   - `Confirmed`: the chain included it.
 *   - `PartialSuccess`: the chain included it but applied only some of its segments, listed in `segments`. What it applied
 *       happened: the fees were paid and the guaranteed segment ran. Re-submitting would repeat that.
 *   - `Rejected`: it will never be included. `Refused` is the chain's verdict — the node saw the transaction and failed it
 *       as a whole, so none of it happened. `TTLPassed` means it was submitted and its TTL passed with no inclusion
 *       seen.
 *   - `Orphaned`: no verdict at all, and there never will be one. Its bytes were authored under a protocol version the
 *       chain has moved past, and nothing can include them afterwards; re-submitting the same bytes could never help.
 *   - `Expired`: its TTL passed before it was submitted.
 *   - `Reverted`: the wallet gave its coins back, so no chain will be asked to include it.
 */
export type LifecycleStatus =
  | Readonly<{ _tag: 'Balanced' }>
  | Readonly<{ _tag: 'Finalized' }>
  | Readonly<{ _tag: 'Submitted' }>
  | Readonly<{ _tag: 'Confirmed' }>
  | Readonly<{
      _tag: 'PartialSuccess';
      /** The segments the chain reported, each with whether it was applied. */
      segments: readonly Readonly<{ id: number; success: boolean }>[];
    }>
  | Readonly<{
      _tag: 'Rejected';
      /** Why it will never be included: the chain's refusal, with the segments it reported, or its TTL passing. */
      reason:
        | Readonly<{ _tag: 'Refused'; segments: readonly Readonly<{ id: number; success: boolean }>[] }>
        | Readonly<{ _tag: 'TTLPassed' }>;
    }>
  | Readonly<{
      _tag: 'Orphaned';
      /** The protocol version the transaction was authored for. */
      authoredFor: ProtocolVersion.ProtocolVersion;
      /** The protocol version the chain had reached when the wallet gave up on it. */
      chainNow: ProtocolVersion.ProtocolVersion;
    }>
  | Readonly<{ _tag: 'Expired' }>
  | Readonly<{ _tag: 'Reverted' }>;

/**
 * A transaction the wallet keeps a lifecycle record for, from the moment it is balanced until its TTL has passed.
 *
 * @remarks
 *   An entry stays after its transaction has ended, until its TTL passes, so an application can read how it ended. Tell
 *   the ones still awaiting an answer from the rest with {@link isAwaiting}, not by the list being empty.
 */
export type LifecycleEntry = Readonly<{
  /**
   * What ties the entry to its transaction. Proving and binding leave identifiers unchanged. The one exception is
   * balancing a transaction that is already finalized: until the recipe is finalized, the entry names only the
   * balancing part's identifiers, and finalizing adds the finalized transaction's.
   */
  identifiers: readonly string[];
  /**
   * The finalized transaction, as the handle an application carries.
   *
   * @remarks
   *   `Option.none()` while it is only balanced, since the wallet holds it with its proofs erased until it is finalized;
   *   for one that ended without ever being finalized (expired, reverted, orphaned, or confirmed after it was proven
   *   elsewhere), which the wallet still holds erased; and for a record kept from an older format that did not hold its
   *   transaction.
   */
  transaction: Option.Option<FinalizedTx>;
  /** When it was submitted, once it was. */
  submittedAt: Option.Option<DateTime.Utc>;
  /**
   * The protocol version it was authored for, when the wallet had observed one.
   *
   * @remarks
   *   `Option.none()` means the wallet never learned which version it was authored against. Such a transaction is never
   *   orphaned — an unobserved version is not evidence of anything.
   */
  authoredFor: Option.Option<ProtocolVersion.ProtocolVersion>;
  /** What has become of it. See {@link LifecycleStatus}. */
  status: LifecycleStatus;
}>;

/** Reads what has become of a transaction off its record's state. */
const lifecycleStatusOf = (state: Lifecycle.LifecycleState): LifecycleStatus =>
  Lifecycle.LifecycleState.$match(state, {
    Balanced: (): LifecycleStatus => ({ _tag: 'Balanced' }),
    Finalized: (): LifecycleStatus => ({ _tag: 'Finalized' }),
    Submitted: (): LifecycleStatus => ({ _tag: 'Submitted' }),
    Confirmed: (): LifecycleStatus => ({ _tag: 'Confirmed' }),
    Rejected: ({ verdict }): LifecycleStatus => {
      switch (verdict.status) {
        case 'TTL_PASSED':
          return { _tag: 'Rejected', reason: { _tag: 'TTLPassed' } };
        case 'PARTIAL_SUCCESS':
          return { _tag: 'PartialSuccess', segments: verdict.segments };
        case 'FAILURE':
          return { _tag: 'Rejected', reason: { _tag: 'Refused', segments: verdict.segments } };
      }
    },
    Orphaned: ({ authoredFor, chainNow }): LifecycleStatus => ({ _tag: 'Orphaned', authoredFor, chainNow }),
    Expired: (): LifecycleStatus => ({ _tag: 'Expired' }),
    Reverted: (): LifecycleStatus => ({ _tag: 'Reverted' }),
  });

/**
 * The lifecycle records as an application reads them.
 *
 * @remarks
 *   A projection over the lifecycle records the wallet keeps, not a second copy of them: the same facts, stated as a list
 *   of transactions with a status each.
 * @example
 *   const entries = lifecycleEntriesOf(await firstValueFrom(facade.transactionLifecycleService.state()));
 *
 * @param lifecycle The lifecycle records.
 * @returns One entry per record, in the order the wallet keeps them.
 */
export const lifecycleEntriesOf = (lifecycle: Lifecycle.TransactionLifecycle<LifecycleTx>): readonly LifecycleEntry[] =>
  lifecycle.records.map((record) => ({
    identifiers: record.identifiers,
    transaction: finalizedHeldBy(record),
    submittedAt: record.submittedAt,
    authoredFor: record.protocolVersion,
    status: lifecycleStatusOf(record.state),
  }));

const AWAITING: ReadonlyArray<LifecycleStatus['_tag']> = ['Balanced', 'Finalized', 'Submitted'];

/**
 * Whether a transaction still awaits an answer: balanced, finalized or submitted, so it may yet be included and its
 * coins stay booked. Every other status is an end.
 *
 * @example
 *   const settled = await firstValueFrom(facade.state().pipe(filter((state) => !state.lifecycle.some(isAwaiting))));
 *
 * @param entry The lifecycle entry.
 * @returns `true` while it awaits one.
 */
export const isAwaiting = (entry: LifecycleEntry): boolean => AWAITING.includes(entry.status._tag);

export class FacadeState {
  public readonly shielded: ShieldedWalletState;
  public readonly unshielded: UnshieldedWalletState;
  public readonly dust: DustWalletState;
  public readonly lifecycle: readonly LifecycleEntry[];

  /** The protocol version each of the three wallets has reached. */
  public get protocolVersion(): WalletProtocolVersions {
    return {
      shielded: this.shielded.protocolVersion,
      unshielded: this.unshielded.protocolVersion,
      dust: this.dust.protocolVersion,
    };
  }

  /**
   * The protocol version the facade as a whole can act at: the lowest the three wallets have reached.
   *
   * @remarks
   *   Around a protocol boundary the three wallets cross at slightly different moments, and a transaction needs all
   *   three. This is the version every one of them is known to understand.
   */
  public get activeProtocolVersion(): ProtocolVersion.ProtocolVersion {
    return lowestProtocolVersion(this.protocolVersion);
  }

  /**
   * Whether the three wallets are settled on one side of the protocol boundary, or still crossing it.
   *
   * @remarks
   *   Additive, and the reading `protocolVersion` alone cannot give: three versions that differ tell an application
   *   nothing about whether the difference matters. See {@link ProtocolPhase}.
   */
  public get protocol(): ProtocolPhase {
    return protocolPhaseOf(this.protocolVersion, this.#forkVersion);
  }

  public get isSynced(): boolean {
    return (
      this.shielded.progress.isStrictlyComplete() &&
      this.dust.progress.isStrictlyComplete() &&
      this.unshielded.progress.isStrictlyComplete()
    );
  }

  /** Where the chain hands over from one ledger version to the next, which is what {@link protocol} is read against. */
  readonly #forkVersion: ProtocolVersion.ProtocolVersion;

  constructor(
    shielded: ShieldedWalletState,
    unshielded: UnshieldedWalletState,
    dust: DustWalletState,
    lifecycle: Lifecycle.TransactionLifecycle<LifecycleTx>,
    forkVersion: ProtocolVersion.ProtocolVersion = ProtocolVersion.MinSupportedVersion,
  ) {
    this.shielded = shielded;
    this.unshielded = unshielded;
    this.dust = dust;
    this.lifecycle = lifecycleEntriesOf(lifecycle);
    this.#forkVersion = forkVersion;
  }
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * What a transaction of either ledger version says about its own identity.
 *
 * @remarks
 *   Structural on purpose: both ledger versions name a transaction the same way, and a transaction submitted before a
 *   crossing is still read after it, so reading one must not depend on which version wrote it.
 */
type IdentifiedTransaction = Readonly<{
  identifiers(): string[];
  intents: ReadonlyMap<number, { intentHash(segmentId: number): string }> | undefined;
}>;

/** Undoes one booking a builder took, in the wallet that took it. */
type Release = () => Promise<void>;

/**
 * Releases every booking in `booked` after `error` ended a build, then rejects.
 *
 * A failed release is never silent. When every release settles, the rejection is `error` itself, unchanged, so a caller
 * matching on it is unaffected. When any release rejects, a booking may remain until it expires, and `error` alone
 * would tell the caller the opposite: the rejection is then an `AggregateError` whose `errors` hold `error` first and
 * each release's rejection after it, in the order the releases were given.
 */
const releaseAndRethrow = async (error: unknown, booked: readonly Release[]): Promise<never> => {
  const settled = await Promise.allSettled(booked.map((release) => release()));
  const releaseFailures = Arr.filterMap(settled, (result) =>
    result.status === 'rejected' ? Option.some<unknown>(result.reason) : Option.none(),
  );
  if (releaseFailures.length === 0) {
    throw error;
  }
  throw new AggregateError(
    [error, ...releaseFailures],
    'The build failed, and releasing the coins it had booked failed too: a booking may remain until it expires.',
  );
};

/**
 * Clock abstraction for obtaining the current time. By default, the facade uses the system clock
 * ({@link Clock.systemClock}); for testing with a simulator, inject a custom clock (e.g. one backed by the simulator's
 * time).
 *
 * Re-exported from `@midnightntwrk/wallet-sdk-utilities` as a namespace so the type is `Clock.Clock` and the default is
 * `Clock.systemClock`. Forwarding the same symbol — rather than re-declaring its members individually — keeps the
 * umbrella `wallet-sdk` package's star-exports unambiguous and lets lower-level packages (e.g. dust-wallet) share it
 * without a circular dependency.
 */
export { Clock };

/**
 * The asynchronous signer callback used by every signing entry point. A `Promise`-returning callback so out-of-process
 * signers (MPC, HSM) can be plugged in directly; an in-process keystore resolves immediately.
 */
export type { SignSegment };

/**
 * The Terms and Conditions returned by the indexer, containing a URL for display and a SHA-256 hash for content
 * verification.
 */
export type TermsAndConditions = {
  /** The hex-encoded SHA-256 hash of the Terms and Conditions document. */
  hash: string;
  /** The URL pointing to the Terms and Conditions document. */
  url: string;
};

/**
 * Minimal configuration required for {@link WalletFacade.fetchTermsAndConditions}. Accepts the shared
 * `indexerClientConnection` sub-object found on all wallet configurations, so callers can pass the full wallet
 * configuration directly without any adaptation.
 */
export type FetchTermsAndConditionsConfiguration = {
  indexerClientConnection: {
    indexerHttpUrl: string;
    indexerWsUrl?: string;
  };
};

/**
 * The fork schedule the facade presets when a configuration names none: {@link ProtocolVersion.V9NativeForkSchedule},
 * ledger-v9 from the version a 2.x node reports.
 *
 * @remarks
 *   Where a chain forks is a fact about the chain, which is why each wallet package requires `forks` and presets nothing.
 *   The facade is the one place a preset decides nothing the SDK has not already decided: every chain the 2.x node line
 *   runs hands over at this version, so an application copying the constant into its configuration only restates it. A
 *   chain that hands over elsewhere states its own `forks`, which wins.
 */
export const DefaultForkSchedule: ProtocolVersion.ForkSchedule = ProtocolVersion.V9NativeForkSchedule;

/** What the three wallets and the default services are built from, as the wallet packages take it. */
type WalletsConfiguration = DefaultUnshieldedConfiguration &
  DefaultShieldedConfiguration &
  DefaultDustConfiguration &
  DefaultSubmissionConfiguration &
  DefaultTransactionLifecycleServiceConfiguration &
  DefaultProvingConfiguration;

/**
 * The configuration {@link WalletFacade.init} takes: what the three wallets and the default services are built from.
 *
 * @remarks
 *   The one difference from the wallets' own configurations is that `forks` may be left out — see
 *   {@link DefaultForkSchedule} for what is then preset, and {@link ResolvedConfiguration} for what a factory is handed.
 */
export type DefaultConfiguration = Omit<WalletsConfiguration, 'forks'> & {
  /**
   * Where each ledger version begins on this chain — see {@link ProtocolVersion.ForkSchedule}. Left out, the facade
   * presets {@link DefaultForkSchedule}.
   */
  forks?: ProtocolVersion.ForkSchedule;
};

/**
 * A {@link DefaultConfiguration} with what the facade presets filled in: `forks` is always present, the schedule the
 * configuration named or {@link DefaultForkSchedule}.
 *
 * @remarks
 *   What every factory in {@link InitParams} is handed, so that a wallet can be built from it directly: the wallet
 *   packages require `forks`, and this is what lets `shielded: (config) => ShieldedWallet(config)` compile. Code
 *   outside a factory gets the same from {@link WalletFacade.resolveConfiguration}.
 * @typeParam TConfig The configuration as given, which may extend {@link DefaultConfiguration} with settings of its own.
 */
export type ResolvedConfiguration<TConfig extends DefaultConfiguration = DefaultConfiguration> = TConfig & {
  forks: ProtocolVersion.ForkSchedule;
};

type MaybePromise<T> = T | Promise<T>;

/**
 * Parameters object for {@link WalletFacade.init}. It features configuration and bunch of initializers for the wallets
 * and services, all of them are in a form of a function that takes the configuration and returns proper implementation,
 * either synchronously or wrapped in a Promise. Services are optional to provide ({@link WalletFacade.init} will provide
 * default implementations), but all 3 wallets: shielded, unshielded and Dust one need to be present.
 */
export type InitParams<TConfig extends DefaultConfiguration> = {
  configuration: TConfig;
  /** Optional factory for the clock abstraction. Defaults to system clock (`() => new Date()`). */
  clock?: (config: ResolvedConfiguration<TConfig>) => MaybePromise<Clock.Clock>;
  submissionService?: (config: ResolvedConfiguration<TConfig>) => MaybePromise<SubmissionService<FinalizedTx>>;
  /**
   * Optional factory for the service holding one lifecycle record per transaction. Defaults to one polling
   * `configuration.indexerClientConnection`.
   *
   * @remarks
   *   This is where an application hands back the store it kept: `facade.transactionLifecycleService.serializeState()`
   *   writes it, with the traits the service reads it with, and the factory restores it with
   *   `TransactionLifecycleServiceImpl.restore(stored, lifecycleTransactionTraits(config.forks.v9), config, clock)`.
   *   `clock` is the facade's own, so a restored service stamps and expires its records by the time the facade keeps,
   *   as the default service does.
   */
  transactionLifecycleService?: (
    config: ResolvedConfiguration<TConfig>,
    deps: { clock: Clock.Clock },
  ) => MaybePromise<TransactionLifecycleService<LifecycleTx>>;
  provingService?: (
    config: ResolvedConfiguration<TConfig>,
  ) => MaybePromise<VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>>;
  /**
   * Optional factory for the block-data fetcher used by validation. Defaults to an HTTP indexer-backed fetcher built
   * from `configuration.indexerClientConnection`. Override for simulator-based tests with
   * `makeV9SimulatorBlockDataFetcher(simulator)` from `@midnightntwrk/wallet-sdk-capabilities/validation`.
   */
  fetchBlockData?: (config: ResolvedConfiguration<TConfig>) => MaybePromise<BlockDataFetcher>;
  validationService?: (
    config: ResolvedConfiguration<TConfig>,
    deps: { fetchBlockData: BlockDataFetcher; clock: Clock.Clock },
  ) => MaybePromise<VersionedValidationService<AnyVersionValidatableTransaction, AnyLedgerParameters>>;
  shielded: (config: ResolvedConfiguration<TConfig>) => MaybePromise<ShieldedWalletAPI<ShieldedKeysByEpoch>>;
  unshielded: (config: ResolvedConfiguration<TConfig>) => MaybePromise<UnshieldedWalletAPI>;
  dust: (config: ResolvedConfiguration<TConfig>) => MaybePromise<DustWalletAPI<DustKeysByEpoch>>;
};

// `BlockData` is not re-exported from the facade to avoid a name collision with the
// `@midnightntwrk/wallet-sdk-dust-wallet` export. The two are structurally identical; users can name the type via
// `@midnightntwrk/wallet-sdk-dust-wallet` or `@midnightntwrk/wallet-sdk-capabilities/validation`.
export {
  type AnyLedgerParameters,
  type AnyVersionValidatableTransaction,
  type BlockDataFetcher,
  LedgerParametersMismatchError,
  type ValidateTxOptions,
  type VersionedValidationService,
  ValidationFetchError,
  WellFormedError,
  type WellFormedStrictnessFlags,
};

// What `start` with `manualSync`, and `doSync`, reject with below `forks.v9`, so a caller can recognise it without
// depending on the dust wallet package. The dust wallet's own, so `instanceof` agrees with what is thrown.
export { ManualSyncUnsupportedError, isManualSyncUnsupportedError } from '@midnightntwrk/wallet-sdk-dust-wallet';

export class WalletFacade {
  private static makeDefaultSubmissionService<TConfig extends DefaultSubmissionConfiguration>(
    config: TConfig,
  ): SubmissionService<FinalizedTx> {
    // A handle serializes itself, which is all submission needs of a transaction — and the one thing every ledger
    // version's transaction does identically.
    return makeDefaultSubmissionService<FinalizedTx>(config);
  }

  private static makeDefaultTransactionLifecycleService<
    TConfig extends DefaultTransactionLifecycleServiceConfiguration & { forks: ProtocolVersion.ForkSchedule },
  >(config: TConfig, clock: Clock.Clock): Promise<TransactionLifecycleServiceImpl<LifecycleTx>> {
    return TransactionLifecycleServiceImpl.init<LifecycleTx>({
      configuration: config,
      txTraits: lifecycleTransactionTraits(config.forks.v9),
      clock,
    });
  }

  /**
   * Builds the proving service a configuration describes.
   *
   * @remarks
   *   Handed the same fork schedule the wallets are built with, because a proving backend is chosen by the epoch a
   *   transaction belongs to and the two ends of that question must not be able to compute the boundary differently.
   */
  private static makeDefaultProvingService<TConfig extends DefaultConfiguration>(
    config: ResolvedConfiguration<TConfig>,
  ): VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction> {
    return Either.getOrThrowWith(
      makeDefaultVersionedProvingService(config, config.forks),
      (error) => new Error(error.message),
    );
  }

  /**
   * Fills in what the facade presets — `forks`, as {@link DefaultForkSchedule} — so that the result is a configuration a
   * wallet package can be built from.
   *
   * @remarks
   *   {@link WalletFacade.init} does this itself, once and before anything is built, so the wallets, the default services
   *   and the facade's own boundary cannot be given different schedules, and no factory needs to call it. It is public
   *   for code outside a factory that needs the configuration the facade will use: an application building a wallet
   *   package directly, or reading `forks` back to author a transaction for the right ledger version. Resolving twice
   *   is the same as resolving once, so `init` may be handed the result.
   * @example
   *   ```typescript
   *   const configuration = WalletFacade.resolveConfiguration({ networkId: 'undeployed', ... });
   *   const facade = await WalletFacade.init({ configuration, shielded: (config) => ShieldedWallet(config), ... });
   *   const authoredForV9 = protocolVersion >= configuration.forks.v9;
   *   ```;
   *
   * @param configuration The configuration as given, with or without `forks`.
   * @returns The same configuration with `forks` present: the schedule it named, or {@link DefaultForkSchedule}.
   */
  static resolveConfiguration<TConfig extends DefaultConfiguration>(
    configuration: TConfig,
  ): ResolvedConfiguration<TConfig> {
    return { ...configuration, forks: configuration.forks ?? DefaultForkSchedule };
  }

  /**
   * Fetches the current Terms and Conditions from the network indexer.
   *
   * This is a static, pre-initialization utility — no wallet instance is required. Wallet builders should call this
   * before or independently of wallet initialization to display the current T&C to end users and obtain the hash for
   * content verification.
   *
   * The returned `hash` is the hex-encoded SHA-256 hash of the document at `url`. Wallet builders are responsible for
   * fetching and rendering the document content via `url` in whatever manner suits their application.
   *
   * @param configuration - An object with an `indexerClientConnection.indexerHttpUrl`. Any wallet configuration that
   *   satisfies {@link FetchTermsAndConditionsConfiguration} can be passed directly.
   * @returns A promise resolving to the current {@link TermsAndConditions}, or rejecting if no Terms and Conditions have
   *   been set on the network yet.
   */
  static async fetchTermsAndConditions(
    configuration: FetchTermsAndConditionsConfiguration,
  ): Promise<TermsAndConditions> {
    const result = await QueryRunner.runPromise(
      FetchTermsAndConditionsQuery,
      {},
      {
        url: configuration.indexerClientConnection.indexerHttpUrl,
      },
    );
    const tc = result.block?.systemParameters?.termsAndConditions;
    if (!tc) {
      throw new Error('Terms and Conditions are not currently set on the network.');
    }
    return tc;
  }

  /**
   * Default initialization for {@link WalletFacade}. It is a static method, which takes an object holding configuration
   * and initialization of necessary components. Specifically - it requires following fields:
   *
   * - `configuration` - holding a configuration, which needs to extend {@link DefaultConfiguration} - this way allows to
   *   convey use-case-specific settings in the same way, as the SDK works by default. `forks` may be left out; every
   *   factory below is handed a {@link ResolvedConfiguration}, which always has it — what
   *   {@link WalletFacade.resolveConfiguration} returns
   * - `shielded` - a function taking the configuration and returning shielded wallet (or a promise with such)
   *   implementing {@link ShieldedWalletAPI} for {@link ShieldedKeysByEpoch}: the facade starts it with one ledger
   *   version's keys per side of the boundary, of which a wallet composed for ledger-v9 alone takes the `v9` side. Such
   *   a single-variant wallet (`CustomShieldedWallet`, `CustomDustWallet`) stamps what it builds at the minimum
   *   supported version, so it belongs only in a facade whose `forks.v9` is at that minimum — a chain on ledger-v9 from
   *   its genesis, such as the in-memory simulator — where that stamp reads as ledger-v9
   * - `unshielded` - a function taking the configuration and returning unshielded wallet (or a promise with such)
   *   implementing {@link UnshieldedWalletAPI}
   * - `dust` - a function taking the configuration and returning Dust wallet (or a promise with such) implementing
   *   {@link DustWalletAPI} for {@link DustKeysByEpoch}, started and stepped like the shielded one. There are some
   *   optional services/abstractions to provide, too. If not provided - default implementations will be used, each of
   *   them is initialized by a function taking the configuration and returning proper implementation (wrapped in a
   *   {@link Promise} or not).
   * - `submissionService` - needs to implement {@link SubmissionService} for a {@link FinalizedTx} handle, of either ledger
   *   version, to submit transactions to the network; the default uses a Node RPC connection
   * - `transactionLifecycleService` - needs to implement {@link TransactionLifecycleService} for a {@link LifecycleTx} to
   *   keep one lifecycle record per transaction, default polls `configuration.indexerClientConnection`
   * - `provingService` - needs to implement {@link VersionedProvingService} to prove it, default uses proving server
   * - `clock` - needs to implement {@link Clock.Clock} for getting current time, default uses system clock
   */
  static async init<TConfig extends DefaultConfiguration>(initParams: InitParams<TConfig>): Promise<WalletFacade> {
    const configuration = WalletFacade.resolveConfiguration(initParams.configuration);
    const submissionService = await Promise.resolve(
      initParams.submissionService
        ? initParams.submissionService(configuration)
        : WalletFacade.makeDefaultSubmissionService(configuration),
    );
    // Resolved first: the lifecycle service, the default or one the application builds, stamps its records with the
    // clock the facade keeps.
    const clock = await Promise.resolve(initParams.clock ? initParams.clock(configuration) : Clock.systemClock);
    const transactionLifecycleService = await Promise.resolve(
      initParams.transactionLifecycleService
        ? initParams.transactionLifecycleService(configuration, { clock })
        : WalletFacade.makeDefaultTransactionLifecycleService(configuration, clock),
    );
    const provingService = await Promise.resolve(
      initParams.provingService
        ? initParams.provingService(configuration)
        : WalletFacade.makeDefaultProvingService(configuration),
    );
    // The wallets write what their sync saw included into the storage they are handed, so handing them one that also
    // moves the lifecycle records confirms a transaction even when no poll saw it land.
    const walletsConfiguration = {
      ...configuration,
      txHistoryStorage: feedingInclusions(configuration.txHistoryStorage, transactionLifecycleService),
    };
    const shielded = await Promise.resolve(initParams.shielded(walletsConfiguration));
    const unshielded = await Promise.resolve(initParams.unshielded(walletsConfiguration));
    const dust = await Promise.resolve(initParams.dust(walletsConfiguration));
    const fetchBlockData: BlockDataFetcher = await Promise.resolve(
      initParams.fetchBlockData ? initParams.fetchBlockData(configuration) : makeDefaultBlockDataFetcher(configuration),
    );
    const validationService = await Promise.resolve(
      initParams.validationService
        ? initParams.validationService(configuration, { fetchBlockData, clock })
        : makeDefaultVersionedValidationService(
            {
              fetchBlockData,
              networkId: configuration.networkId,
              clock,
            },
            configuration.forks.v9,
          ),
    );
    return new WalletFacade(
      shielded,
      unshielded,
      dust,
      submissionService,
      provingService,
      validationService,
      configuration.txHistoryStorage,
      configuration.forks.v9,
      clock,
      transactionLifecycleService,
    );
  }

  readonly shielded: ShieldedWalletAPI<ShieldedKeysByEpoch>;
  readonly unshielded: UnshieldedWalletAPI;
  readonly dust: DustWalletAPI<DustKeysByEpoch>;
  readonly submissionService: SubmissionService<FinalizedTx>;
  /** One lifecycle record per transaction the facade balanced, finalized or submitted. */
  readonly transactionLifecycleService: TransactionLifecycleService<LifecycleTx>;
  readonly provingService: VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>;
  readonly validationService: VersionedValidationService<AnyVersionValidatableTransaction, AnyLedgerParameters>;
  #txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>;
  readonly clock: Clock.Clock;
  #pendingSubscription: Subscription;
  #restoredBookingSubscription: Subscription;
  #protocolVersionSubscription: Subscription;
  /**
   * The protocol version the wallets have all reached, as last observed.
   *
   * @remarks
   *   `Option.none()` until the three wallets have each emitted once. It decides the version the facade acts at, never
   *   the stamp a pending transaction is booked with: that comes from the transaction's own bytes.
   */
  #observedProtocolVersion = new BehaviorSubject<Option.Option<ProtocolVersion.ProtocolVersion>>(Option.none());

  /** Where the chain hands over from one ledger version to the next, which is what divides the two epochs. */
  readonly #forkVersion: ProtocolVersion.ProtocolVersion;

  /** The traits lifecycle records are read with, split at {@link #forkVersion}. */
  readonly #lifecycleTraits: TransactionTraits.VersionedTransactionTrait<LifecycleTx>;

  /**
   * Constructor is private on purpose - much of initialization of the facade is potentially asynchronous, and adding
   * new parameters is a breaking change to the users Use {@link WalletFacade.init} instead
   *
   * @private
   */
  private constructor(
    shieldedWallet: ShieldedWalletAPI<ShieldedKeysByEpoch>,
    unshieldedWallet: UnshieldedWalletAPI,
    dustWallet: DustWalletAPI<DustKeysByEpoch>,
    submissionService: SubmissionService<FinalizedTx>,
    provingService: VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
    validationService: VersionedValidationService<AnyVersionValidatableTransaction, AnyLedgerParameters>,
    txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>,
    forkVersion: ProtocolVersion.ProtocolVersion,
    clock: Clock.Clock,
    transactionLifecycleService: TransactionLifecycleService<LifecycleTx>,
  ) {
    this.transactionLifecycleService = transactionLifecycleService;
    this.shielded = shieldedWallet;
    this.unshielded = unshieldedWallet;
    this.dust = dustWallet;
    this.submissionService = submissionService;
    this.provingService = provingService;
    this.validationService = validationService;
    this.#txHistoryStorage = txHistoryStorage;
    this.#forkVersion = forkVersion;
    this.#lifecycleTraits = lifecycleTransactionTraits(forkVersion);
    this.clock = clock;
    // Releases react to a record's end, not to its state: a final record stays until its TTL and is published on every
    // tick, and releasing it again could free coins booked since for another transaction. The first emission is the
    // baseline, so a record restored already ended was released by the session that saw it end.
    this.#pendingSubscription = this.transactionLifecycleService
      .state()
      .pipe(
        map((lifecycle) => lifecycle.records),
        pairwise(),
        concatMap(([previous, current]): ReadonlyArray<Release> => [
          ...newlyEnded(previous, current).map(
            ({ tx, result }) =>
              () =>
                this.#releaseEnded(tx, result),
          ),
          ...newlyExpired(previous, current).map((tx) => () => this.dust.revertTransaction(tx)),
        ]),
        // One end that cannot be handled is logged and left, never let through: an error here would end the
        // subscription, and no record ending after it would ever be released. Coins it leaves booked are not lost:
        // the shielded and unshielded wallets sweep them once the transaction's TTL passes, and the dust wallet once
        // its grace period does.
        concatMap((release) =>
          release().catch((error: unknown) =>
            Effect.runPromise(
              Effect.logError('Could not release an ended transaction; its TTL frees its coins', Cause.die(error)),
            ),
          ),
        ),
      )
      .subscribe();

    // Coins a previous process left booked would otherwise sit until their transactions' TTLs, which can be an hour.
    // Once sync reaches the tip, every transaction this address is party to has been applied, so a coin still booked
    // was never spent, unless a live record says the spend is still out there: from balancing to its end, a record
    // names every coin its transaction spends.
    //
    // This only sees the records the service was given. A lifecycle service restored from storage covers the spends a
    // previous process recorded; one started empty covers none of them, and a restored booking whose transaction is
    // still in the mempool is released here.
    this.#restoredBookingSubscription = this.unshielded.state
      .pipe(
        filter((unshielded) => unshielded.progress.isStrictlyComplete()),
        // Only bookings restored at startup are candidates, and this releases all of them at once, so the first time
        // sync reaches the tip is the only time there is anything to do. Acting once also keeps the reaction from
        // feeding itself: releasing publishes new state, which would otherwise satisfy this same condition again.
        take(1),
        concatMap(async () => {
          const lifecycle = await firstValueFrom(this.transactionLifecycleService.state());
          await this.unshielded.releaseRestoredPending(Lifecycle.coveredUnshieldedIds(lifecycle));
        }),
      )
      .subscribe();

    // Deliberately built from the wallets' own states rather than from `state()`: `state()` includes the pending set,
    // and orphaning writes to it, so feeding that back here would be a cycle.
    this.#protocolVersionSubscription = combineLatest([this.shielded.state, this.unshielded.state, this.dust.state])
      .pipe(
        map(([shieldedState, unshieldedState, dustState]) =>
          lowestProtocolVersion({
            shielded: shieldedState.protocolVersion,
            unshielded: unshieldedState.protocolVersion,
            dust: dustState.protocolVersion,
          }),
        ),
        distinctUntilChanged(),
        tap((version) => this.#observedProtocolVersion.next(Option.some(version))),
        // Nothing fallible belongs here: this chain is the only writer of the observed version, and an orphaned
        // transaction sync already saw included is reconciled by the pending subscription like any other verdict.
        concatMap((version) => this.transactionLifecycleService.orphanBeyond(version)),
      )
      .subscribe();
  }

  /**
   * The protocol version the facade is currently acting at.
   *
   * @remarks
   *   The lowest the three wallets have reached, once they have all reported; the minimum supported version until then,
   *   which is the epoch a wallet with no history belongs to. It is what a transaction the facade builds is stamped
   *   with, and what the side of the boundary it accepts transactions from is measured against.
   */
  private currentVersion(): ProtocolVersion.ProtocolVersion {
    return Option.getOrElse(this.#observedProtocolVersion.getValue(), () => ProtocolVersion.MinSupportedVersion);
  }

  /** The range of protocol versions on the same side of the boundary as a given one. */
  private epochOf(version: ProtocolVersion.ProtocolVersion): ProtocolVersion.ProtocolVersion.Range {
    return ProtocolVersion.epochOf(version, this.#forkVersion);
  }

  /** The range of protocol versions on the facade's current side of the boundary. */
  private currentEpoch(): ProtocolVersion.ProtocolVersion.Range {
    return this.epochOf(this.currentVersion());
  }

  /**
   * Reads a transaction an application handed in, refusing one built on the other side of the boundary.
   *
   * @remarks
   *   The enforcement point for everything that enters the facade — a transaction the wallets built, or one an
   *   application authored and sealed with `WalletTransaction.adopt`. Only the current epoch is accepted, because a
   *   transaction of the other one cannot be merged, proved or submitted alongside anything the facade would build for
   *   it. Both a stranded ledger-v8 transaction after the crossing and a ledger-v9 transaction offered before it are
   *   refused here, by name, with the versions written down.
   * @param handle The handle to read.
   * @returns The carried transaction.
   * @throws {@link WalletTransactionUnwrapError} When the transaction was built on the other side of the boundary, or
   *   sealed by another copy of the abstractions package.
   */
  private accept<T>(handle: AnyTx): T {
    return Either.getOrThrowWith(
      WalletTransaction.unwrapWithin<T>(handle, this.currentEpoch()),
      (error: WalletTransactionUnwrapError) => error,
    );
  }

  /**
   * Seals a transaction the facade or a wallet produced, at the version its bytes were fixed by.
   *
   * @remarks
   *   The version is the caller's to state, never read from the facade here, because the two can differ: a crossing can
   *   land while a transaction is at the prover, and what comes back is still the bytes of the ledger version that made
   *   them. A caller sealing something it has just built passes the version it is building at; a caller sealing
   *   something that has travelled through an await passes the version stamped on the handle it started from.
   * @param stage How far along the building of the transaction the sealed handle is.
   * @param transaction The transaction to seal.
   * @param protocolVersion The version the transaction's bytes were fixed by.
   * @returns The sealed handle.
   */
  private seal<TStage extends WalletTransaction.Stage>(
    stage: TStage,
    transaction: { serialize: () => Uint8Array },
    protocolVersion: ProtocolVersion.ProtocolVersion,
  ): WalletTransaction<TStage> {
    return WalletTransaction.adopt(stage, transaction, protocolVersion);
  }

  /** The ledger primitives the facade signs with on its current side of the boundary. */
  private authoring(): EpochAuthoring {
    return this.currentVersion() < this.#forkVersion ? v8Authoring : v9Authoring;
  }

  /**
   * Reads a transaction from bytes that name no protocol version, at the version the facade is acting at.
   *
   * @remarks
   *   For bytes that reach the wallet from outside the SDK — a dApp connector's serialized transaction above all, whose
   *   contract carries no version alongside them. The bytes cannot say which ledger version wrote them, so this answers
   *   with the only version the facade could act at anyway, and reads them with that version's ledger. Bytes the other
   *   ledger version wrote are refused here rather than misread, because the markers a stage names are part of what the
   *   ledger checks as it reads.
   *
   *   The version is the facade's rather than the caller's, which is the point: a caller that reads
   *   {@link FacadeState.activeProtocolVersion} and seals a handle itself is answering the same question a moment
   *   earlier, with a crossing able to land in between. It is still only the version at the moment of the call — a
   *   crossing can land before the handle is used, and `ProtocolVersionMismatchError` from the operation that uses it
   *   is what says so.
   * @example
   *   Balancing a transaction a dApp connector handed over as hex:
   *
   *   ```typescript
   *   const handle = facade.adoptTransaction(Buffer.from(txHex, 'hex'), 'Unbound');
   *   const recipe = await facade.balanceUnboundTransaction(handle, { ttl });
   *   ```;
   *
   * @param bytes The transaction's own serialization, as the ledger version that wrote it produced it.
   * @param stage How far along the building of the transaction these bytes are, which decides the markers they are read
   *   with.
   * @returns The sealed handle, stamped with the protocol version the facade is acting at.
   * @throws {@link WireFormatError} When the bytes are not a transaction of that version at that stage — which is what
   *   a transaction authored on the other side of a protocol boundary looks like from here.
   */
  adoptTransaction<TStage extends WalletTransaction.Stage>(
    bytes: Uint8Array,
    stage: TStage,
  ): WalletTransaction<TStage> {
    const protocolVersion = this.currentVersion();
    return Either.getOrThrowWith(
      Either.try({
        try: () => this.authoring().deserializers[stage](bytes),
        catch: (cause) =>
          new WireFormatError({
            message:
              `These bytes are not a transaction of protocol version ${protocolVersion} at stage ${stage} — that is ` +
              `the version this wallet is acting at, and a transaction built for another one has to be built again ` +
              `for it.`,
            cause,
          }),
      }).pipe(Either.map((transaction) => WalletTransaction.adopt(stage, transaction, protocolVersion))),
      (error: WireFormatError) => error,
    );
  }

  /**
   * Reads the transaction a handle carries, with the ledger version the handle itself names.
   *
   * @remarks
   *   The counterpart of {@link accept}, which reads at the version the facade is acting at and refuses the rest. This one
   *   asks nothing of the facade's position: the handle was stamped by whichever ledger version built it, and that
   *   version is the one that can read its bytes. It is how a transaction tracked across a crossing can still name its
   *   coins afterwards.
   * @param handle The handle to read.
   * @returns The carried transaction.
   */
  #carried<T>(handle: AnyTx): T {
    return Either.getOrThrowWith(
      WalletTransaction.unwrapWithin<T>(handle, this.epochOf(handle.protocolVersion)),
      (error: WalletTransactionUnwrapError) => error,
    );
  }

  /**
   * The ids of this wallet's own coins that `handle` spends, read with the ledger version that built it.
   *
   * @remarks
   *   The identity is this wallet's in ledger-v9's shape; a transaction built below the boundary is read with ledger-v8,
   *   whose verifying key is the bare bytes of the one scheme it has, so the key is narrowed to match. Only a schnorr
   *   identity ever has a ledger-v8 transaction to read, because the wallet refuses to start that variant with any
   *   other, so the narrowing cannot fail here and a failure is reported as the defect it would be.
   * @param handle The transaction to read.
   * @param verifyingKey This wallet's verifying key, in the SDK's signature shape, as its state reports it.
   * @returns Every coin of this wallet's the transaction spends, each `intentHash#outputNo`.
   */
  #ownInputIds(handle: AnyTx, verifyingKey: Signatures.Signing.SignatureVerifyingKey): readonly string[] {
    const ownInputs =
      handle.protocolVersion < this.#forkVersion
        ? V1UnshieldedTransactionOps.extractOwnInputs(
            this.#carried<ledgerV8.Transaction<ledgerV8.SignatureEnabled, ledgerV8.Proofish, ledgerV8.Bindingish>>(
              handle,
            ),
            Either.getOrThrowWith(Signatures.lowerSignatureVerifyingKey(verifyingKey), (error) => error),
          )
        : V2UnshieldedTransactionOps.extractOwnInputs(
            this.#carried<ledgerV9.Transaction<ledgerV9.SignatureEnabled, ledgerV9.Proofish, ledgerV9.Bindingish>>(
              handle,
            ),
            verifyingKey,
          );

    return coinIdsOf(ownInputs);
  }

  /**
   * What the lifecycle record of `held` says about it, read off the transaction by the trait for the version it was
   * built for: its identifiers, intent hashes, every coin it spends, and its TTL as of now.
   */
  #factsOf(held: LifecycleTx): Lifecycle.TransactionFacts<LifecycleTx> {
    const trait = Option.getOrThrowWith(
      TransactionTraits.traitForVersion(this.#lifecycleTraits, Option.some(held.protocolVersion)),
      () => new Error(`No lifecycle trait is registered for protocol version ${held.protocolVersion}.`),
    );
    return {
      tx: held,
      identifiers: trait.ids(held),
      intentHashes: trait.intentHashes(held),
      inputs: trait.inputs(held),
      ttl: trait.ttl(held, DateTime.unsafeFromDate(this.clock.now())),
      protocolVersion: held.protocolVersion,
    };
  }

  /**
   * Records the whole transaction a balancing recipe finalizes into as balanced, its proofs erased: one record per
   * balancing call, naming every coin that transaction spends, since nothing else says they are spoken for until it is
   * finalized.
   *
   * A recipe that balances a finalized transaction records its balancing part alone. The finalized transaction is
   * already past balancing, and may hold a finalized record of its own, which no balancing can move; a record covering
   * both would be refused, leaving the coins the balancing part booked in no record. Finalizing the recipe folds the
   * two records into one.
   */
  async #recordBalanced(recipe: BalancingRecipe): Promise<void> {
    const unfinalizedParts =
      recipe.type === 'FINALIZED_TRANSACTION' ? [recipe.balancingTransaction] : BalancingRecipe.getTransactions(recipe);
    const parts = unfinalizedParts.map((part) => erasedOf(part, this.#forkVersion));
    if (Arr.isNonEmptyReadonlyArray(parts)) {
      await this.transactionLifecycleService.balanced(this.#factsOf(mergedLifecycleTxs(parts)));
    }
  }

  /**
   * Records a finalized transaction, folding every record it covers into one: merging a recipe's parts makes one
   * transaction, and a part finalized on its own beforehand has a record of its own.
   */
  async #recordFinalized(finalizedTx: FinalizedTx): Promise<void> {
    await this.transactionLifecycleService.finalized(this.#factsOf(lifecycleTxOf(finalizedTx, this.#forkVersion)));
  }

  /**
   * Balances a transaction in place, and says how to release only the coins the wallet itself booked doing so.
   *
   * In-place balancing hands back the caller's own transaction with the wallet's inputs added, so the result names
   * coins from two sources: the ones coin selection just took, and any the caller had already put there. Only the first
   * are this wallet's booking, and they are exactly the inputs of this wallet's that the balanced transaction carries
   * and the caller's did not.
   *
   * Read off the two transactions, not off the wallet's published state: the wallet publishes its state on its own
   * fiber, so a read taken as soon as the balancing call returns can still show the coins as available, and the release
   * would miss them.
   */
  async #balanceInPlace<T extends AnyTx | undefined>(
    tx: AnyTx,
    balance: () => Promise<T>,
  ): Promise<{ balanced: T; release: Release }> {
    const { verifyingKey } = await firstValueFrom(this.unshielded.state);
    const inputsBefore = new Set(this.#ownInputIds(tx, verifyingKey));
    const balanced = await balance();

    if (balanced === undefined) {
      return { balanced, release: () => Promise.resolve() };
    }

    const newlyBooked = this.#ownInputIds(balanced, verifyingKey).filter((id) => !inputsBefore.has(id));
    const release = this.#inPlaceUnshieldedBooking(newlyBooked);

    return { balanced, release };
  }

  /** Undoes a booking the unshielded wallet took while balancing. */
  async #revertUnshieldedBooking(tx: AnyTx): Promise<void> {
    await this.unshielded.revertTransaction(tx);
  }

  /**
   * Runs one step of a builder that has already booked coins, releasing those bookings if the step fails.
   *
   * A builder that rejects hands its caller no transaction, so the caller has nothing to revert: whatever the builder
   * booked before the failing step would stay booked. Each booking is released by the wallet that took it, and only
   * that booking is, so nothing the caller or another transaction holds is touched.
   *
   * A failed release is never silent: the step's error is rethrown unchanged only when every release settled, and
   * otherwise arrives inside an `AggregateError` with each release's rejection (see {@link releaseAndRethrow}).
   */
  async #releasingOnFailure<T>(booked: readonly Release[], step: () => Promise<T> | T): Promise<T> {
    try {
      return await step();
    } catch (error) {
      return await releaseAndRethrow(error, booked);
    }
  }

  /** Releases the coins the shielded wallet booked for `tx`, a transaction it built. */
  #shieldedBooking(tx: AnyTx | undefined): Release {
    return async () => {
      if (!tx) {
        return;
      }
      await this.shielded.revertTransaction(tx);
    };
  }

  /** Releases the coins the unshielded wallet booked for `tx`, a transaction it built. */
  #unshieldedBooking(tx: AnyTx | undefined): Release {
    return async () => (tx ? this.#revertUnshieldedBooking(tx) : undefined);
  }

  /**
   * Releases `bookedIds`, the coins the unshielded wallet booked balancing a caller's transaction in place. The coins
   * the caller had already put there are not the wallet's booking, so they stay as they were; releasing the whole
   * transaction would free them too.
   */
  #inPlaceUnshieldedBooking(bookedIds: readonly string[]): Release {
    return async () => {
      await this.unshielded.revertUtxos(bookedIds);
    };
  }

  /** Releases the Dust the dust wallet booked for `tx`, the fee-paying transaction it built. */
  #dustBooking(tx: AnyTx | undefined): Release {
    return async () => (tx ? this.dust.revertTransaction(tx) : undefined);
  }

  private defaultTtl(): Date {
    return new Date(this.clock.now().getTime() + DEFAULT_TTL_MS);
  }

  /**
   * Checks whether a transaction is structurally well-formed before passing it to a balance or submit method.
   *
   * Highly recommended in particular for transactions received from a 3rd party (e.g., a dApp or partner service)
   * before forwarding them to a balance or submit method.
   *
   * TTL expiry, Network ID mismatch, and transaction structure are always enforced regardless of `flags`. All three
   * configurable flags must be supplied explicitly — there are no defaults, so callers must be intentional about each
   * check.
   *
   * Recommended flags per call site:
   *
   * | Method                        | enforceBalancing | verifySignatures | enforceLimits |
   * | ----------------------------- | ---------------- | ---------------- | ------------- |
   * | `submitTransaction`           | `true`           | `true`           | `true`        |
   * | `balanceFinalizedTransaction` | `false`          | `true`           | `false`       |
   * | `balanceUnboundTransaction`   | `false`          | `false`          | `false`       |
   * | `balanceUnprovenTransaction`  | `false`          | `false`          | `false`       |
   *
   * Real on-chain ledger parameters are always used — `options.blockData` is used if provided, otherwise the service
   * fetches the latest block data via the configured fetcher. Pass `recipe.blockData` to reuse the fetch performed
   * during balancing and avoid a redundant network call.
   *
   * @example
   *   ```typescript
   *   // Reuse the block data captured during balancing — no extra fetch
   *   const recipe = await facade.balanceFinalizedTransaction(tx, options);
   *   const finalizedTx = await facade.finalizeRecipe(recipe);
   *   await facade.validateTransaction(finalizedTx, {
   *     flags: { enforceBalancing: true, verifySignatures: true, enforceLimits: true },
   *     blockData: recipe.blockData,
   *   });
   *   await facade.submitTransaction(finalizedTx);
   *
   *   // No recipe to source blockData from — the service fetches automatically
   *   await facade.validateTransaction(tx, {
   *     flags: { enforceBalancing: false, verifySignatures: false, enforceLimits: false },
   *   });
   *   ```;
   *
   * @param tx - The transaction to validate (`FinalizedTransaction`, `UnboundTransaction`, or `UnprovenTransaction`).
   * @param options - Strictness flags and optional `blockData` to skip the fetch.
   * @throws {@link WellFormedError} If the transaction fails any enabled check.
   * @throws {@link ValidationFetchError} If the block-data fetch fails.
   * @throws {@link LedgerParametersMismatchError} If the block checked against carries another ledger version's
   *   parameters than the one that authored the transaction: the given `blockData`, or without it the chain's latest
   *   block, which for a ledger-v8 transaction is ledger-v9's once the chain is past `forks.v9`. Passing `blockData`
   *   from before `forks.v9` then gets the transaction checked, though the chain will no longer include it.
   */
  async validateTransaction(tx: AnyTx, options: ValidateTxOptions<AnyLedgerParameters>): Promise<void> {
    // Checked at the version the transaction says it was authored for, and never at the version the chain has since
    // reached: well-formedness asks whether the ledger that produced these bytes would accept them, and a fork landing
    // afterwards does not change which ledger that is. It does change the block fetched when no `blockData` is passed,
    // which is then refused rather than checked against. The transaction is read at its own epoch for the same reason.
    return this.validationService.validateTx(
      Either.getOrThrowWith(
        WalletTransaction.unwrapWithin<AnyVersionValidatableTransaction>(
          tx,
          ProtocolVersion.epochOf(tx.protocolVersion, this.#forkVersion),
        ),
        (error: WalletTransactionUnwrapError) => error,
      ),
      tx.protocolVersion,
      options,
    );
  }

  /**
   * Merges two unproven transactions of the same epoch, or returns whichever there is.
   *
   * @remarks
   *   Both are unwrapped before merging, which is where a pair from different epochs is refused: a merge across the
   *   boundary is not a failure to compute, it is unrepresentable, and saying so is the whole point of the stamp.
   */
  private mergeUnprovenTransactions(a: UnprovenTx | undefined, b: UnprovenTx | undefined): UnprovenTx | undefined {
    if (a && b)
      return this.seal(
        'Unproven',
        this.accept<CarriedUnproven>(a).merge(this.accept<CarriedUnproven>(b)),
        this.currentVersion(),
      );
    return a ?? b;
  }

  private async createDustActionTransaction(
    action: { type: 'registration'; dustReceiverAddress: DustAddress } | { type: 'deregistration' },
    nightUtxos: readonly UtxoWithMeta[],
    nightVerifyingKey: ledgerV9.SignatureVerifyingKey,
    signDustRegistration: SignSegment,
  ): Promise<UnprovenTx> {
    const ttl = this.defaultTtl();
    const now = this.clock.now();
    const isRegistration = action.type === 'registration';
    const dustReceiverAddress = isRegistration ? action.dustReceiverAddress : undefined;

    // Step 1 — Dust decides which Night UTxO belongs in the guaranteed slot (the one whose dust
    // generation can pay the fee) and computes the fee-payment allowance.
    const nightUtxosWithMeta = nightUtxos.map(({ utxo, meta }) => ({
      ...utxo,
      ctime: meta.ctime,
      registeredForDustGeneration: meta.registeredForDustGeneration,
    }));
    const split = await this.dust.splitNightUtxosForDustRegistration(now, nightUtxosWithMeta, isRegistration);

    const toUnshieldedUtxoWithMeta = (u: DustCoinsAndBalances.UtxoWithFullDustDetails): UtxoWithMeta => ({
      utxo: {
        value: u.utxo.value,
        type: u.utxo.type,
        owner: u.utxo.owner,
        intentHash: u.utxo.intentHash,
        outputNo: u.utxo.outputNo,
      },
      meta: {
        ctime: u.utxo.ctime,
        registeredForDustGeneration: u.utxo.registeredForDustGeneration,
      },
    });
    const guaranteedForUnshielded = split.guaranteedUtxos.map(toUnshieldedUtxoWithMeta);
    const fallibleForUnshielded = split.fallibleUtxos.map(toUnshieldedUtxoWithMeta);

    // Step 2 — Unshielded books the Night UTxOs (move available -> pending) and builds the intent
    // with the two offers. After this point, a concurrent build call that wants any of these UTxOs
    // will fail fast.
    const txWithOffers = await this.unshielded.rotateUtxos(
      guaranteedForUnshielded,
      fallibleForUnshielded,
      nightVerifyingKey,
      ttl,
    );

    // Step 3 — Dust attaches its DustActions onto the intent the unshielded wallet just built.
    // If this fails we must unbook the UTxOs so the caller can retry.
    let txWithDustActions: UnprovenTx;
    try {
      txWithDustActions = await this.dust.attachDustRegistration(
        txWithOffers,
        now,
        nightVerifyingKey,
        dustReceiverAddress,
        split.feePayment,
      );
    } catch (error) {
      await this.#revertUnshieldedBooking(txWithOffers);
      throw error;
    }

    // Step 4 (first-time registration only) — Fail fast if the dust generated so far by the
    // unregistered guaranteed UTxOs is below the registration's own fee. Submitting would fail
    // on-chain with BalanceCheckOverspend. Skip for re-registration (all guaranteed UTxOs already
    // registered) since `feePayment` is 0 by design and the caller is expected to balance the fee
    // externally via `balanceUnprovenTransaction({ tokenKindsToBalance: ['dust'] })`.
    //
    // `registeredForDustGeneration` is the indexer's answer as of the chain's current dust epoch, so it is the one
    // authority on which of the two a registration is. Night carried across the v8 -> v9 fork arrives with it set to
    // `false` — the fork wipes dust generation state and the unshielded crossing carries the flag accordingly — so a
    // re-registration on ledger-v9 is correctly treated as first-time.
    const hasUnregisteredGuaranteed = split.guaranteedUtxos.some((u) => !u.utxo.registeredForDustGeneration);
    if (isRegistration && hasUnregisteredGuaranteed) {
      const fee = await this.dust.calculateFee([txWithDustActions]);
      try {
        await this.dust.ensureFeeCoverage(now, nightUtxosWithMeta, split.feePayment, fee);
      } catch (error) {
        await this.#revertUnshieldedBooking(txWithOffers);
        throw error;
      }
    }

    // Step 5 — Sign via the standard signRecipe pathway, which now stamps both the unshielded
    // offers and the dust registration. Signing failures also need to release the booking.
    try {
      const signedRecipe = await this.signRecipe(
        { type: 'UNPROVEN_TRANSACTION', protocolVersion: this.currentVersion(), transaction: txWithDustActions },
        signDustRegistration,
      );
      if (signedRecipe.type !== 'UNPROVEN_TRANSACTION') {
        throw Error('signRecipe returned unexpected recipe type for dust action transaction.');
      }
      return signedRecipe.transaction;
    } catch (error) {
      await this.#revertUnshieldedBooking(txWithOffers);
      throw error;
    }
  }

  state(): Observable<FacadeState> {
    return combineLatest([
      this.shielded.state,
      this.unshielded.state,
      this.dust.state,
      this.transactionLifecycleService.state(),
    ]).pipe(
      map(
        ([shieldedState, unshieldedState, dustState, lifecycle]) =>
          new FacadeState(shieldedState, unshieldedState, dustState, lifecycle, this.#forkVersion),
      ),
    );
  }

  async waitForSyncedState(): Promise<FacadeState> {
    const [shieldedState, unshieldedState, dustState, lifecycle] = await Promise.all([
      this.shielded.waitForSyncedState(),
      this.unshielded.waitForSyncedState(),
      this.dust.waitForSyncedState(),
      firstValueFrom(this.transactionLifecycleService.state()),
    ]);

    return new FacadeState(shieldedState, unshieldedState, dustState, lifecycle, this.#forkVersion);
  }

  /**
   * Submits a finalized transaction to the network and tracks it as pending until finalized or discarded.
   *
   * Call {@link validateTransaction} with `{ enforceBalancing: true, verifySignatures: true, enforceLimits: true }`
   * before this method to surface structural errors with a clear diagnostic instead of a cryptic network rejection.
   *
   * A failed submission releases the coins and Dust the transaction booked only when the failure proves no block holds
   * it: the node usurped, dropped, invalidated or refused it, or it was never sent. After any other failure, such as a
   * finality timeout once the transaction is in a block, they stay booked until sync or the transaction's TTL settles
   * them.
   *
   * @param tx - The finalized transaction to submit.
   * @returns The transaction identifier.
   * @throws {@link WellFormedError} — call {@link validateTransaction} first to get this error early.
   * @throws The submission service's error when the submission fails, whether or not the bookings were released.
   */
  async submitTransaction(tx: FinalizedTx): Promise<TransactionIdentifier> {
    const carried = this.accept<Carried>(tx);
    const identifiers = carried.identifiers();
    try {
      // The bytes' own version, never the wallets' reading: a crossing can land between building and submitting.
      // Recorded before it is sent, like the history entry: an inclusion can be reported before submission returns.
      await this.transactionLifecycleService.submitted(this.#factsOf(lifecycleTxOf(tx, this.#forkVersion)));
      // Insert before awaiting submission so the entry exists while the tx is in flight — the per-wallet sync
      // handlers' gotFinalized call clears the pending entry on confirmation.
      const key = submitTxHistoryKey(carried);
      await this.#txHistoryStorage.gotPending({ ...key, submittedAt: this.clock.now() });
      await this.submissionService.submitTransaction(tx, 'Finalized');

      return identifiers.at(-1)!;
    } catch (error) {
      // Releasing coins a block may have spent would offer them again, so a failure that cannot rule out inclusion
      // leaves the record live for sync or the TTL to settle.
      await SubmissionFailure.$match(classifySubmissionFailure(error), {
        NotIncluded: () => this.revert(tx),
        Undetermined: () => Promise.resolve(),
      });
      throw error;
    }
  }

  /**
   * Balances a finalized transaction by adding shielded, unshielded, and dust inputs/outputs as needed.
   *
   * Call {@link validateTransaction} with `{ enforceBalancing: false, verifySignatures: true, enforceLimits: false }`
   * before this method to surface structural errors early. `enforceBalancing` is `false` because the transaction is not
   * yet balanced at this stage; `verifySignatures` is `true` because signatures are already present and must be valid.
   *
   * @remarks
   *   Paying the fee with Dust may wait up to two minutes for the wallet's Dust trees to reach a recent block, then
   *   rejects with a `Wallet.Sync` error. Coins booked for the transaction stay booked during that wait.
   * @param tx - The finalized transaction to balance.
   * @param options - TTL for the balancing transaction, and optional subset of token kinds to balance.
   * @returns A {@link FinalizedTransactionRecipe} containing the original and balancing transactions.
   */
  async balanceFinalizedTransaction(
    tx: FinalizedTx,
    options: {
      ttl: Date;
      tokenKindsToBalance?: TokenKindsToBalance;
    },
  ): Promise<FinalizedTransactionRecipe> {
    const { ttl, tokenKindsToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenKindsToBalance);

    // Step 1: Run unshielded and shielded balancing
    const unshieldedBalancingTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceFinalizedTransaction(tx)
      : undefined;
    const afterUnshielded = [this.#unshieldedBooking(unshieldedBalancingTx)];

    const shieldedBalancingTx = await this.#releasingOnFailure(afterUnshielded, () =>
      shouldBalanceShielded ? this.shielded.balanceTransaction(tx, ttl) : undefined,
    );
    const afterShielded = [...afterUnshielded, this.#shieldedBooking(shieldedBalancingTx)];

    // Step 2: Merge unshielded and shielded balancing
    const mergedBalancingTx = await this.#releasingOnFailure(afterShielded, () =>
      this.mergeUnprovenTransactions(shieldedBalancingTx, unshieldedBalancingTx),
    );

    // Step 3: Conditionally add dust/fee balancing
    const dustResult = await this.#releasingOnFailure(afterShielded, () =>
      shouldBalanceDust
        ? this.dust.balanceTransactions(mergedBalancingTx ? [tx, mergedBalancingTx] : [tx], ttl)
        : undefined,
    );
    const feeBalancingTx = dustResult?.transaction;
    const afterDust = [...afterShielded, this.#dustBooking(feeBalancingTx)];

    // Step 4: Merge fee balancing and create final recipe
    const balancingTx = await this.#releasingOnFailure(afterDust, () =>
      this.mergeUnprovenTransactions(mergedBalancingTx, feeBalancingTx),
    );

    if (!balancingTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    const recipe: FinalizedTransactionRecipe = {
      type: 'FINALIZED_TRANSACTION',
      protocolVersion: this.currentVersion(),
      originalTransaction: tx,
      balancingTransaction: balancingTx,
      ...pricedBlockOf(dustResult),
    };
    await this.#releasingOnFailure(afterDust, () => this.#recordBalanced(recipe));
    return recipe;
  }

  /**
   * Balances an unbound (proven, pre-binding) transaction by adding shielded, unshielded, and dust inputs/outputs.
   *
   * Call {@link validateTransaction} with `{ enforceBalancing: false, verifySignatures: false, enforceLimits: false }`
   * before this method to surface structural errors early. All configurable flags are `false` because the transaction
   * is not yet balanced and signatures are not yet present.
   *
   * @remarks
   *   Paying the fee with Dust may wait up to two minutes for the wallet's Dust trees to reach a recent block, then
   *   rejects with a `Wallet.Sync` error. Coins booked for the transaction stay booked during that wait.
   * @param tx - The unbound transaction to balance.
   * @param options - TTL for the balancing transaction, and optional subset of token kinds to balance.
   * @returns An {@link UnboundTransactionRecipe} containing the base and optional balancing transactions.
   */
  async balanceUnboundTransaction(
    tx: UnboundTx,
    options: {
      ttl: Date;
      tokenKindsToBalance?: TokenKindsToBalance;
    },
  ): Promise<UnboundTransactionRecipe> {
    const { ttl, tokenKindsToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenKindsToBalance);

    // Step 1: Run unshielded and shielded balancing
    const shieldedBalancingTx = shouldBalanceShielded ? await this.shielded.balanceTransaction(tx, ttl) : undefined;
    const afterShielded = [this.#shieldedBooking(shieldedBalancingTx)];

    // For unbound transactions, unshielded balancing happens in place not with a balancing transaction
    const unshieldedBalancing = await this.#releasingOnFailure(afterShielded, () =>
      shouldBalanceUnshielded
        ? this.#balanceInPlace(tx, () => this.unshielded.balanceUnboundTransaction(tx))
        : undefined,
    );
    const balancedUnshieldedTx = unshieldedBalancing?.balanced;
    const afterUnshielded = [...afterShielded, ...(unshieldedBalancing ? [unshieldedBalancing.release] : [])];

    // Step 2: Unbound unshielded tx are balanced in place, use it as base tx if present
    const baseTx = balancedUnshieldedTx ?? tx;

    // Step 3: Conditionally add dust/fee balancing
    const dustResult = await this.#releasingOnFailure(afterUnshielded, () =>
      shouldBalanceDust
        ? this.dust.balanceTransactions(shieldedBalancingTx ? [baseTx, shieldedBalancingTx] : [baseTx], ttl)
        : undefined,
    );
    const feeBalancingTransaction = dustResult?.transaction;
    const afterDust = [...afterUnshielded, this.#dustBooking(feeBalancingTransaction)];

    // Step 4: Create the final balancing transaction
    const balancingTransaction = await this.#releasingOnFailure(afterDust, () =>
      this.mergeUnprovenTransactions(shieldedBalancingTx, feeBalancingTransaction),
    );

    // if there is no balancingTransaction and there was no unshielded tx balancing (in place) throw an error.
    if (!balancingTransaction && !balancedUnshieldedTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    const recipe: UnboundTransactionRecipe = {
      type: 'UNBOUND_TRANSACTION',
      protocolVersion: this.currentVersion(),
      baseTransaction: baseTx,
      balancingTransaction: balancingTransaction ?? undefined,
      ...pricedBlockOf(dustResult),
    };
    await this.#releasingOnFailure(afterDust, () => this.#recordBalanced(recipe));
    return recipe;
  }

  /**
   * Balances an unproven transaction by adding shielded, unshielded, and dust inputs/outputs.
   *
   * Call {@link validateTransaction} with `{ enforceBalancing: false, verifySignatures: false, enforceLimits: false }`
   * before this method to surface structural errors early. All configurable flags are `false` because the transaction
   * is not yet balanced and signatures are not yet present.
   *
   * @remarks
   *   Paying the fee with Dust may wait up to two minutes for the wallet's Dust trees to reach a recent block, then
   *   rejects with a `Wallet.Sync` error. Coins booked for the transaction stay booked during that wait.
   * @param tx - The unproven transaction to balance.
   * @param options - TTL for the balancing transaction, and optional subset of token kinds to balance.
   * @returns An {@link UnprovenTransactionRecipe} containing the balanced transaction.
   */
  async balanceUnprovenTransaction(
    tx: UnprovenTx,
    options: {
      ttl: Date;
      tokenKindsToBalance?: TokenKindsToBalance;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { ttl, tokenKindsToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenKindsToBalance);

    // Step 1: Run unshielded and shielded balancing
    const shieldedBalancingTx = shouldBalanceShielded ? await this.shielded.balanceTransaction(tx, ttl) : undefined;
    const afterShielded = [this.#shieldedBooking(shieldedBalancingTx)];

    // For unproven transactions, unshielded balancing happens in place
    const unshieldedBalancing = await this.#releasingOnFailure(afterShielded, () =>
      shouldBalanceUnshielded
        ? this.#balanceInPlace(tx, () => this.unshielded.balanceUnprovenTransaction(tx))
        : undefined,
    );
    const balancedUnshieldedTx = unshieldedBalancing?.balanced;
    const afterUnshielded = [...afterShielded, ...(unshieldedBalancing ? [unshieldedBalancing.release] : [])];

    // Step 2: Use the balanced unshielded tx if present, otherwise use the original tx
    const baseTx = balancedUnshieldedTx ?? tx;

    // Step 3: Merge shielded balancing into base tx if present
    const mergedTx = (await this.#releasingOnFailure(afterUnshielded, () =>
      this.mergeUnprovenTransactions(baseTx, shieldedBalancingTx),
    ))!;

    // Step 4: Conditionally add dust/fee balancing
    const dustResult = await this.#releasingOnFailure(afterUnshielded, () =>
      shouldBalanceDust ? this.dust.balanceTransactions([mergedTx], ttl) : undefined,
    );
    const feeBalancingTx = dustResult?.transaction;
    const afterDust = [...afterUnshielded, this.#dustBooking(feeBalancingTx)];

    // Step 5: Merge fee balancing if present
    const balancedTx = (await this.#releasingOnFailure(afterDust, () =>
      this.mergeUnprovenTransactions(mergedTx, feeBalancingTx),
    ))!;

    const recipe: UnprovenTransactionRecipe = {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: balancedTx,
      ...pricedBlockOf(dustResult),
    };
    await this.#releasingOnFailure(afterDust, () => this.#recordBalanced(recipe));
    return recipe;
  }

  /**
   * Proves and binds every part of a balancing recipe and folds them into one finalized transaction, tracked as
   * pending.
   *
   * @remarks
   *   One failure path covers every step: a failure at any of them gives back each part of the recipe once, in all three
   *   wallets, and ends the recipe's record `Reverted`. No history entry is written, because nothing was submitted. The
   *   coins are then free for other transactions to take, so balance the transaction anew rather than finalize the same
   *   recipe again.
   * @param recipe The recipe a balancing method returned.
   * @returns The finalized transaction, stamped with the version its caller's part was authored at.
   * @throws {@link WalletTransactionUnwrapError} When the wallets left a part's epoch while it was being proved, or
   *   were never in it, or when another copy of the abstractions package sealed the handle.
   * @throws {AggregateError} When giving back the recipe's bookings failed as well, so a booking may remain until it
   *   expires: `errors` holds the original failure first, then each failed release.
   */
  async finalizeRecipe(recipe: BalancingRecipe): Promise<FinalizedTx> {
    try {
      const finalizedTx = await this.#finalizeParts(recipe);
      await this.#recordFinalized(finalizedTx);
      return finalizedTx;
    } catch (error) {
      // A rejection hands the caller no transaction to submit, so the caller has nothing to revert: every part is given
      // back here, once each, as a builder that fails gives back what it booked.
      const parts = BalancingRecipe.getTransactions(recipe);
      return await releaseAndRethrow(error, [
        ...parts.map((part) => () => this.#releaseAll(part)),
        () => this.transactionLifecycleService.reverted(parts.flatMap((part) => this.#identifiersOf(part))),
      ]);
    }
  }

  /**
   * Proves and binds every part of a recipe and folds them into one finalized transaction. It releases nothing and
   * records nothing: its caller owns both, so each part is given back once whichever step fails.
   */
  async #finalizeParts(recipe: BalancingRecipe): Promise<FinalizedTx> {
    switch (recipe.type) {
      case 'FINALIZED_TRANSACTION': {
        const finalizedBalancing = await this.#proveAndSeal(recipe.balancingTransaction);
        return this.seal(
          'Finalized',
          this.accept<CarriedFinalized>(recipe.originalTransaction).merge(
            this.accept<CarriedFinalized>(finalizedBalancing),
          ),
          recipe.originalTransaction.protocolVersion,
        );
      }
      case 'UNBOUND_TRANSACTION': {
        const finalizedBalancingTx = recipe.balancingTransaction
          ? await this.#proveAndSeal(recipe.balancingTransaction)
          : undefined;
        const finalizedTransaction = this.accept<CarriedUnbound>(recipe.baseTransaction).bind();
        return this.seal(
          'Finalized',
          finalizedBalancingTx
            ? finalizedTransaction.merge(this.accept<CarriedFinalized>(finalizedBalancingTx))
            : finalizedTransaction,
          recipe.baseTransaction.protocolVersion,
        );
      }
      case 'UNPROVEN_TRANSACTION': {
        return await this.#proveAndSeal(recipe.transaction);
      }
    }
  }

  async signRecipe(recipe: BalancingRecipe, signSegment: SignSegment): Promise<BalancingRecipe> {
    switch (recipe.type) {
      case 'FINALIZED_TRANSACTION': {
        const signedBalancingTx = await this.signUnprovenTransaction(recipe.balancingTransaction, signSegment);
        const withDustSig = await this.#signDustRegistrationIfPresent(signedBalancingTx, signSegment);
        return {
          type: 'FINALIZED_TRANSACTION',
          protocolVersion: recipe.protocolVersion,
          originalTransaction: recipe.originalTransaction,
          balancingTransaction: withDustSig,
          ...(recipe.blockData ? { blockData: recipe.blockData } : {}),
        };
      }
      case 'UNBOUND_TRANSACTION': {
        const signedBalancingTx = recipe.balancingTransaction
          ? await this.signUnprovenTransaction(recipe.balancingTransaction, signSegment).then((tx) =>
              this.#signDustRegistrationIfPresent(tx, signSegment),
            )
          : undefined;
        const signedBaseTx = await this.signUnboundTransaction(recipe.baseTransaction, signSegment);
        return {
          type: 'UNBOUND_TRANSACTION',
          protocolVersion: recipe.protocolVersion,
          baseTransaction: signedBaseTx,
          balancingTransaction: signedBalancingTx,
          ...(recipe.blockData ? { blockData: recipe.blockData } : {}),
        };
      }
      case 'UNPROVEN_TRANSACTION': {
        const signedTx = await this.signUnprovenTransaction(recipe.transaction, signSegment);
        const withDustSig = await this.#signDustRegistrationIfPresent(signedTx, signSegment);
        return {
          type: 'UNPROVEN_TRANSACTION',
          protocolVersion: recipe.protocolVersion,
          transaction: withDustSig,
          ...(recipe.blockData ? { blockData: recipe.blockData } : {}),
        };
      }
    }
  }

  async #signDustRegistrationIfPresent(tx: UnprovenTx, signSegment: SignSegment): Promise<UnprovenTx> {
    const intent = this.accept<CarriedUnproven>(tx).intents?.get(1);
    const registrations = intent?.dustActions?.registrations ?? [];
    if (!intent || registrations.length === 0) {
      return tx;
    }
    const signature = await signSegment(intent.signatureData(1));
    return await this.dust.addDustRegistrationSignature(tx, signature);
  }

  async signUnprovenTransaction(tx: UnprovenTx, signSegment: SignSegment): Promise<UnprovenTx> {
    return await this.unshielded.signUnprovenTransaction(tx, signSegment);
  }

  async signUnboundTransaction(tx: UnboundTx, signSegment: SignSegment): Promise<UnboundTx> {
    return await this.unshielded.signUnboundTransaction(tx, signSegment);
  }

  /**
   * Proves and binds an unproven transaction, and records it as finalized.
   *
   * @remarks
   *   Proved at the version stamped on the transaction itself, which is the version that fixed its bytes, and sealed at
   *   that same version: proving is a long await, so the wallets can move under it, and neither the prover a
   *   transaction is routed to nor the stamp it comes back with may be decided by where they have moved to.
   *
   *   Where they have moved to decides one thing only, and it is decided again once the proof is back: a crossing while
   *   the transaction was in flight leaves it belonging to an epoch the wallets have left, and no chain they are on can
   *   include it. Such a transaction is refused rather than sealed, and no record is made for it — a record would only
   *   wait out a TTL for an inclusion that cannot happen.
   *
   *   A failure at any step after the stamp is read gives back what the transaction booked in the three wallets and ends
   *   its record `Reverted`, so it is not left awaiting an answer. No history entry is written, because nothing was
   *   submitted.
   * @param tx The unproven transaction.
   * @returns The finalized transaction, stamped with the version it was authored at.
   * @throws {@link WalletTransactionUnwrapError} When the wallets left the transaction's epoch while it was being
   *   proved, or were never in it, or when another copy of the abstractions package sealed the handle.
   * @throws {AggregateError} When giving back a booking failed as well, so it may remain until it expires: `errors`
   *   holds the original failure first, then each failed release.
   */
  async finalizeTransaction(tx: UnprovenTx): Promise<FinalizedTx> {
    // Checked before anything is attempted: a transaction refused on its stamp has been handed to nothing, so there is
    // nothing to release for it, and the wallets would refuse to revert it for the same reason. Only a failure past
    // this point can leave a booking behind.
    const accepted = this.accept<ledgerV9.UnprovenTransaction>(tx);
    try {
      const finalizedTx = await this.#proveAndSeal(tx, accepted);
      await this.#recordFinalized(finalizedTx);
      return finalizedTx;
    } catch (error) {
      return await releaseAndRethrow(error, [
        () => this.shielded.revertTransaction(tx),
        () => this.#revertUnshieldedBooking(tx),
        () => this.dust.revertTransaction(tx),
        () => this.transactionLifecycleService.reverted(this.#identifiersOf(tx)),
      ]);
    }
  }

  /**
   * Proves and binds an unproven transaction at the version stamped on it. It releases nothing and records nothing: its
   * caller owns both, so a booking is given back once whichever step fails.
   *
   * @param tx The unproven transaction.
   * @param accepted The transaction as read at its stamp; read here when not given.
   */
  async #proveAndSeal(
    tx: UnprovenTx,
    accepted: ledgerV9.UnprovenTransaction = this.accept<ledgerV9.UnprovenTransaction>(tx),
  ): Promise<FinalizedTx> {
    // Named as the prover's input rather than its output: the router hands the transaction to the prover registered
    // for the version it was authored at, and what comes back is that ledger version's unbound transaction.
    const unboundTx = await this.provingService.prove(accepted, tx.protocolVersion);
    // Read again on the far side of the proof: the epoch is the one thing about the transaction that a crossing during
    // proving can change, and this is where it is caught.
    this.accept<CarriedUnproven>(tx);
    return this.seal('Finalized', unboundTx.bind(), tx.protocolVersion);
  }

  /** Estimates the fee for the given transaction only. This lacks the fees of the balancing transaction. */
  async calculateTransactionFee(tx: AnyTx): Promise<bigint> {
    return await this.dust.calculateFee([tx]);
  }

  /** Calculates the total fee for the given transaction plus the fee of the balancing transaction. */
  async estimateTransactionFee(
    tx: AnyTx,
    options?: {
      ttl?: Date;
      currentTime?: Date;
    },
  ): Promise<bigint> {
    const ttl = options?.ttl ?? this.defaultTtl();
    return await this.dust.estimateFee([tx], ttl, options?.currentTime);
  }

  /**
   * Builds a transfer to the given shielded and unshielded outputs.
   *
   * @remarks
   *   With `payFees` (the default), paying the fee with Dust may wait up to two minutes for the wallet's Dust trees to
   *   reach a recent block, then rejects with a `Wallet.Sync` error. Coins booked for the transaction stay booked
   *   during that wait. If any step fails, every booking this call made is released before the error is rethrown.
   * @example
   *   ```ts
   *   const recipe = await wallet.transferTransaction(
   *     [{ type: 'unshielded', outputs: [{ amount: 1_000_000n, receiverAddress, type: Token.night }] }],
   *     { ttl: new Date(Date.now() + 30 * 60 * 1000) },
   *   );
   *   ```;
   *
   * @param outputs - The outputs to pay, grouped by token kind; at least one output is required.
   * @param options - `ttl` for the transfer, and `payFees` to pay its fee with Dust (default `true`).
   * @returns An {@link UnprovenTransactionRecipe} holding the transfer, fee included when `payFees` is set.
   * @throws When there are no outputs, or when building, balancing or paying the fee fails.
   */
  async transferTransaction(
    outputs: CombinedTokenTransfer[],
    options: {
      ttl: Date;
      payFees?: boolean;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { ttl, payFees = true } = options;

    const unshieldedOutputs = outputs
      .filter((output) => output.type === 'unshielded')
      .flatMap((output) => output.outputs);

    const shieldedOutputs = outputs.filter((output) => output.type === 'shielded').flatMap((output) => output.outputs);

    if (unshieldedOutputs.length === 0 && shieldedOutputs.length === 0) {
      throw Error('At least one shielded or unshielded output is required.');
    }

    const shieldedTx =
      shieldedOutputs.length > 0 ? await this.shielded.transferTransaction(shieldedOutputs, ttl) : undefined;
    const afterShielded = [this.#shieldedBooking(shieldedTx)];

    const unshieldedTx = await this.#releasingOnFailure(afterShielded, () =>
      unshieldedOutputs.length > 0 ? this.unshielded.transferTransaction(unshieldedOutputs, ttl) : undefined,
    );
    const afterUnshielded = [...afterShielded, this.#unshieldedBooking(unshieldedTx)];

    const mergedTxs = (await this.#releasingOnFailure(afterUnshielded, () =>
      this.mergeUnprovenTransactions(shieldedTx, unshieldedTx),
    ))!;

    // Add fee payment
    const dustResult = await this.#releasingOnFailure(afterUnshielded, () =>
      payFees ? this.dust.balanceTransactions([mergedTxs], ttl) : undefined,
    );
    const feeBalancingTx = dustResult?.transaction;
    const afterDust = [...afterUnshielded, this.#dustBooking(feeBalancingTx)];

    const finalTx = (await this.#releasingOnFailure(afterDust, () =>
      this.mergeUnprovenTransactions(mergedTxs, feeBalancingTx),
    ))!;

    const recipe: UnprovenTransactionRecipe = {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: finalTx,
      ...pricedBlockOf(dustResult),
    };
    await this.#releasingOnFailure(afterDust, () => this.#recordBalanced(recipe));
    return recipe;
  }

  /**
   * Provides estimate of the fee of issuing registration transaction with provided UTxOs
   *
   * @param nightUtxos - Night UTxOs to use for the registration
   * @returns And object informing about fee at the moment, as well as estimation of dust generation of the UTxO(s),
   *   that would be used for paying the fee. These include data that allows to compute when the fee could be paid
   */
  async estimateRegistration(nightUtxos: readonly UtxoWithMeta[]): Promise<{
    fee: bigint;
    dustGenerationEstimations: ReadonlyArray<DustCoinsAndBalances.UtxoWithFullDustDetails>;
  }> {
    const now = this.clock.now();
    const dustState = await this.dust.waitForSyncedState();
    const dustGenerationEstimations = pipe(
      nightUtxos,
      Arr.map(({ utxo, meta }) => ({
        ...utxo,
        ctime: meta.ctime,
        registeredForDustGeneration: meta.registeredForDustGeneration,
      })),
      (utxosWithMeta) => dustState.estimateDustGeneration(utxosWithMeta, now),
      (estimatedUtxos) => dustState.splitNightUtxos(estimatedUtxos),
      (split) => split.guaranteed,
    );
    const authoring = this.authoring();
    // Type cast required because: a signing key belongs to one ledger version's runtime and the two are nominally
    // distinct, so the epoch's own primitives are the only things that may touch it; it never leaves this block.
    const fakeSigningKey = authoring.sampleSigningKey() as never;
    const fakeVerifyingKey = authoring.signatureVerifyingKey(fakeSigningKey);

    // Use the legacy dust-only construction path here so estimation does NOT book real UTxOs in the
    // unshielded wallet state. (The race-fix path in createDustActionTransaction books on purpose;
    // estimation is meant to be observation-only.)
    const ttl = this.defaultTtl();
    const fakeUnsignedTx = await this.dust.createDustGenerationTransaction(
      undefined,
      ttl,
      nightUtxos.map(({ utxo, meta }) => ({
        ...utxo,
        ctime: meta.ctime,
        registeredForDustGeneration: meta.registeredForDustGeneration,
      })),
      fakeVerifyingKey,
      dustState.address,
    );
    const intent = this.accept<CarriedUnproven>(fakeUnsignedTx).intents?.get(1);
    if (!intent) {
      throw Error('Dust generation transaction is missing intent segment 1.');
    }
    const signature = authoring.signData(fakeSigningKey, intent.signatureData(1));
    const fakeSignedTx = await this.dust.addDustGenerationSignature(fakeUnsignedTx, signature);

    const finalizedFakeTx = this.seal(
      'Finalized',
      this.accept<CarriedUnproven>(fakeSignedTx).mockProve().bind(),
      this.currentVersion(),
    );

    const fee = await this.calculateTransactionFee(finalizedFakeTx);

    return {
      fee,
      dustGenerationEstimations,
    };
  }

  /**
   * Starts a swap offering the desired inputs for the desired outputs.
   *
   * @remarks
   *   With `payFees` (off by default), paying the fee with Dust may wait up to two minutes for the wallet's Dust trees to
   *   reach a recent block, then rejects with a `Wallet.Sync` error. Coins booked for the transaction stay booked
   *   during that wait. If any step fails, every booking this call made is released before the error is rethrown.
   * @example
   *   ```ts
   *   const recipe = await wallet.initSwap(
   *     { shielded: { [offeredToken]: 1_000_000n } },
   *     [{ type: 'shielded', outputs: [{ type: wantedToken, amount: 1_000_000n, receiverAddress }] }],
   *     { ttl: new Date(Date.now() + 30 * 60 * 1000) },
   *   );
   *   ```;
   *
   * @param desiredInputs - The shielded and unshielded amounts this wallet puts into the swap, by token type.
   * @param desiredOutputs - What this wallet wants to receive, grouped by token kind.
   * @param options - `ttl` for the swap, and `payFees` to pay its fee with Dust (default `false`).
   * @returns An {@link UnprovenTransactionRecipe} holding this wallet's half of the swap.
   * @throws When the swap has neither a shielded nor an unshielded part, or when building it or paying the fee fails.
   */
  async initSwap(
    desiredInputs: CombinedSwapInputs,
    desiredOutputs: CombinedSwapOutputs[],
    options: {
      ttl: Date;
      payFees?: boolean;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { ttl, payFees = false } = options;

    const { shielded: shieldedInputs, unshielded: unshieldedInputs } = desiredInputs;

    const shieldedOutputs = desiredOutputs
      .filter((output) => output.type === 'shielded')
      .flatMap((output) => output.outputs);

    const unshieldedOutputs = desiredOutputs
      .filter((output) => output.type === 'unshielded')
      .flatMap((output) => output.outputs);

    const hasShieldedPart = (shieldedInputs && Object.keys(shieldedInputs).length > 0) || shieldedOutputs.length > 0;

    const hasUnshieldedPart =
      (unshieldedInputs && Object.keys(unshieldedInputs).length > 0) || unshieldedOutputs.length > 0;

    if (!hasShieldedPart && !hasUnshieldedPart) {
      throw Error('At least one shielded or unshielded swap is required.');
    }

    // Build each leg if the swap involves that token kind, even when it has outputs but no inputs.
    const shieldedTx = hasShieldedPart
      ? await this.shielded.initSwap(shieldedInputs ?? {}, shieldedOutputs, ttl)
      : undefined;
    const afterShielded = [this.#shieldedBooking(shieldedTx)];

    const unshieldedTx = await this.#releasingOnFailure(afterShielded, () =>
      hasUnshieldedPart ? this.unshielded.initSwap(unshieldedInputs ?? {}, unshieldedOutputs, ttl) : undefined,
    );
    const afterUnshielded = [...afterShielded, this.#unshieldedBooking(unshieldedTx)];

    const combinedTx = await this.#releasingOnFailure(afterUnshielded, () => {
      const merged = this.mergeUnprovenTransactions(shieldedTx, unshieldedTx);
      if (!merged) {
        throw Error('Unexpected transaction state.');
      }
      return merged;
    });

    const dustResult = await this.#releasingOnFailure(afterUnshielded, () =>
      payFees ? this.dust.balanceTransactions([combinedTx], ttl) : undefined,
    );
    const feeBalancingTx = dustResult?.transaction;
    const afterDust = [...afterUnshielded, this.#dustBooking(feeBalancingTx)];

    const finalTx = (await this.#releasingOnFailure(afterDust, () =>
      this.mergeUnprovenTransactions(combinedTx, feeBalancingTx),
    ))!;

    const recipe: UnprovenTransactionRecipe = {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: finalTx,
      ...pricedBlockOf(dustResult),
    };
    await this.#releasingOnFailure(afterDust, () => this.#recordBalanced(recipe));
    return recipe;
  }

  /**
   * Builds and signs a transaction registering `nightUtxos` to generate dust for `dustReceiverAddress`.
   *
   * @remarks
   *   A first-time registration pays its own fee out of the dust its Night has generated so far. When that falls short,
   *   the Night UTxOs booked for the transaction are released before the call rejects, so it can be retried as is.
   * @example
   *   ```ts
   *   const register = () => wallet.registerNightUtxosForDustGeneration(nightUtxos, verifyingKey, signData);
   *   const recipe = await register().catch(async (error: unknown) => {
   *     // An unreachable fee will not be covered by waiting, so only a reachable one is waited out.
   *     if (!isInsufficientDustForFeeError(error) || error.estimate._tag !== 'Reachable') throw error;
   *     const timeoutMs = Number(error.estimate.seconds) * 1000 + 60_000;
   *     await wallet.waitForGeneratedDust(nightUtxos, error.fee, { timeoutMs });
   *     return register();
   *   });
   *   ```;
   *
   * @param nightUtxos - The Night UTxOs to register. Must be non-empty.
   * @param nightVerifyingKey - The verifying key that owns them.
   * @param signDustRegistration - Signs the registration and the unshielded offers.
   * @param dustReceiverAddress - Where the generated dust goes. Defaults to this wallet's own dust address.
   * @returns The unproven registration transaction, signed.
   * @throws Error if `nightUtxos` is empty.
   * @throws InsufficientDustForFeeError (`_tag` `'Wallet.InsufficientDustForFee'`, recognised by
   *   `isInsufficientDustForFeeError` from `@midnightntwrk/wallet-sdk`) when the generated dust does not yet cover the
   *   fee. It carries `claimableFeePayment`, `fee`, `shortfall` and an `estimate` of when it will; when it is
   *   reachable, wait with {@link waitForGeneratedDust} for at least that long and retry.
   */
  async registerNightUtxosForDustGeneration(
    nightUtxos: readonly UtxoWithMeta[],
    nightVerifyingKey: ledgerV9.SignatureVerifyingKey,
    signDustRegistration: SignSegment,
    dustReceiverAddress?: DustAddress,
  ): Promise<UnprovenTransactionRecipe> {
    if (nightUtxos.length === 0) {
      throw Error('At least one Night UTXO is required.');
    }

    const receiverAddress = dustReceiverAddress ?? (await this.dust.getAddress());

    const dustRegistrationTx = await this.createDustActionTransaction(
      { type: 'registration', dustReceiverAddress: receiverAddress },
      nightUtxos,
      nightVerifyingKey,
      signDustRegistration,
    );

    const recipe: UnprovenTransactionRecipe = {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: dustRegistrationTx,
    };
    await this.#releasingOnFailure([this.#unshieldedBooking(dustRegistrationTx)], () => this.#recordBalanced(recipe));
    return recipe;
  }

  /**
   * Waits until the dust projected to be generated by the given Night UTxOs reaches `requiredAmount`, re-checking every
   * second. Pair with {@link estimateRegistration} to pick `requiredAmount`, then call before
   * {@link registerNightUtxosForDustGeneration} so the registration covers its own fee.
   *
   * @param nightUtxos - Night UTxOs to project generation for; the same set passed to the registration.
   * @param requiredAmount - Dust threshold to wait for. Resolves immediately if `<= 0n`.
   * @param opts.timeoutMs - Deadline, in ms, for the threshold to be reached. Rejects otherwise. Default `300_000`.
   * @throws If `nightUtxos` is empty, or if `requiredAmount` is not reached within `opts.timeoutMs`.
   */
  async waitForGeneratedDust(
    nightUtxos: readonly UtxoWithMeta[],
    requiredAmount: bigint,
    opts?: { timeoutMs?: number },
  ): Promise<void> {
    await this.dust.waitForGeneratedDust(
      nightUtxos.map(({ utxo, meta }) => ({
        ...utxo,
        ctime: meta.ctime,
        registeredForDustGeneration: meta.registeredForDustGeneration,
      })),
      requiredAmount,
      this.clock,
      opts,
    );
  }

  async deregisterFromDustGeneration(
    nightUtxos: UtxoWithMeta[],
    nightVerifyingKey: ledgerV9.SignatureVerifyingKey,
    signDustRegistration: SignSegment,
  ): Promise<UnprovenTransactionRecipe> {
    const dustDeregistrationTx = await this.createDustActionTransaction(
      { type: 'deregistration' },
      nightUtxos,
      nightVerifyingKey,
      signDustRegistration,
    );
    const recipe: UnprovenTransactionRecipe = {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: dustDeregistrationTx,
    };
    await this.#releasingOnFailure([this.#unshieldedBooking(dustDeregistrationTx)], () => this.#recordBalanced(recipe));
    return recipe;
  }

  async revert(txOrRecipe: AnyTx | BalancingRecipe, reason?: string): Promise<void> {
    // avoid instanceof check
    const transactionsToRevert = BalancingRecipe.isRecipe(txOrRecipe)
      ? BalancingRecipe.getTransactions(txOrRecipe)
      : [txOrRecipe];

    await Promise.all(transactionsToRevert.map((tx) => this.revertTransaction(tx, reason)));
  }

  /**
   * The finalized entry recording `tx`, if sync has written one, even under the hash aggregation gave it on-chain. A
   * transaction whose stamp no epoch can read has no entry, rather than an error, so a verdict on it still resolves.
   */
  private finalizedEntryFor(tx: AnyTx, history: readonly WalletEntry[]): FinalizedWalletEntry | undefined {
    return Option.match(
      Either.getRight(WalletTransaction.unwrapWithin<Carried>(tx, this.epochOf(tx.protocolVersion))),
      {
        onNone: () => undefined,
        onSome: (carried) => {
          const key = submitTxHistoryKey(carried);
          return history.find(
            (entry): entry is FinalizedWalletEntry =>
              isFinalizedWalletEntry(entry) && TransactionHistoryStorage.coversTransaction(entry, key),
          );
        },
      },
    );
  }

  /** Sync can record inclusion before the independent pending-status poller observes it. */
  private async reconcileFinalizedTransaction(
    tx: FinalizedTx,
    result: TransactionTraits.TransactionResult,
    history: readonly WalletEntry[],
  ): Promise<boolean> {
    const entry = this.finalizedEntryFor(tx, history);
    if (entry === undefined) return false;
    // Included failures still need their unexecuted coin reservations released.
    if (entry.status === 'PARTIAL_SUCCESS') {
      await this.#revertFailedSegments(tx, failedSegmentsOf(result));
    } else if (entry.status === 'FAILURE') {
      await this.#releaseRejected(tx);
    }
    // A success needs nothing released: sync settles the coins it spent.
    return true;
  }

  async revertTransaction(tx: AnyTx, reason?: string): Promise<void> {
    await this.#releaseAll(tx)
      .then(() => this.transactionLifecycleService.reverted(this.#identifiersOf(tx)))
      .then(() => this.#recordRejection(tx, reason));
  }

  /**
   * Releases what a transaction that ended rejected or orphaned had booked, unless the history shows the chain included
   * it: then sync owns its coins, and releasing them would offer ones already spent.
   */
  async #releaseEnded(tx: FinalizedTx, result: TransactionTraits.TransactionResult): Promise<void> {
    if (!(await this.reconcileFinalizedTransaction(tx, result, await this.#txHistoryStorage.getAll()))) {
      await (result.status === 'PARTIAL_SUCCESS'
        ? this.#revertFailedSegments(tx, failedSegmentsOf(result))
        : this.#releaseRejected(tx, rejectionReason(result)));
    }
  }

  /**
   * Releases everything a transaction no chain applied had booked, and records it as rejected, leaving its record at
   * the end it reached: a rejected or orphaned transaction was not reverted.
   */
  async #releaseRejected(tx: FinalizedTx, reason?: string): Promise<void> {
    await this.#releaseAll(tx).then(() => this.#recordRejection(tx, reason));
  }

  /** Releases every coin and every Dust each wallet booked for `tx`. */
  async #releaseAll(tx: AnyTx): Promise<void> {
    await Promise.all([
      this.shielded.revertTransaction(tx),
      this.unshielded.revertTransaction(tx),
      this.dust.revertTransaction(tx),
    ]);
  }

  /**
   * The identifiers of `tx`, read at the epoch it was built for; none for a transaction no epoch can read, which no
   * record can stand for either.
   */
  #identifiersOf(tx: AnyTx): readonly string[] {
    return Either.match(WalletTransaction.unwrapWithin<IdentifiedTransaction>(tx, this.epochOf(tx.protocolVersion)), {
      onLeft: () => [],
      onRight: (carried) => carried.identifiers(),
    });
  }

  /**
   * Releases what a transaction that landed as a partial success booked in its failed segments, and records it as
   * rejected.
   *
   * @remarks
   *   Its guaranteed segment and every fallible segment that succeeded spent their coins on chain, and each wallet's sync
   *   settles those; releasing them would offer spent coins again. Every Dust spend sits in the guaranteed segment, so
   *   the dust wallet has nothing to release.
   */
  async #revertFailedSegments(tx: FinalizedTx, failedSegments: ReadonlyArray<number>): Promise<void> {
    await Promise.all([
      this.shielded.revertFailedSegments(tx, failedSegments),
      this.unshielded.revertFailedSegments(tx, failedSegments),
    ]).then(() => this.#recordRejection(tx));
  }

  /** Records a released transaction as rejected in the history. */
  async #recordRejection(tx: AnyTx, reason?: string): Promise<void> {
    // Read at the epoch the transaction was built for, not the one the facade now acts at. A verdict on a
    // transaction submitted before a protocol boundary can only arrive after it — a chain rejection, a TTL run out,
    // or the wallet giving up on bytes that can never be included — and by then the facade has crossed. The pending
    // entry that verdict has to land on was written by this same session before the crossing, and it is the only
    // record an application has that the transaction will never be included; keying it against the current epoch
    // would leave it saying `pending` for the rest of the session. The stamp is what chooses the reader, which is
    // what the stamp is for.
    const key = Option.match(
      Either.getRight(WalletTransaction.unwrapWithin<Carried>(tx, this.epochOf(tx.protocolVersion))),
      { onNone: () => undefined, onSome: revertTxHistoryKey },
    );
    if (key !== undefined) {
      await this.#txHistoryStorage.gotRejected({
        ...key,
        rejectedAt: this.clock.now(),
        ...(reason !== undefined ? { reason } : {}),
      });
    }
  }

  /**
   * Starts the wallets and their background synchronization.
   *
   * @remarks
   *   Seeds, not key objects. A seed is the only key material that crosses a protocol boundary — every ledger version
   *   derives its own keys from the same seed and arrives at the same identity — so a wallet started from seeds can
   *   follow the chain across a fork, and one started from key objects of a single ledger version cannot. Derive them
   *   once with `WalletSeeds.fromMasterSeed` and hand them over.
   *
   *   {@link FacadeKeysByEpoch} is the escape hatch for a caller that will not part with a seed. It requires **both**
   *   ledger versions' key objects, because a wallet holding one side could not read the other side of the chain, and
   *   it costs the caller an import of both ledger packages and the same derivation performed twice. A seed costs
   *   neither.
   * @example
   *   ```typescript
   *   await facade.start(WalletSeeds.fromMasterSeed(masterSeed));
   *   ```;
   *
   * @param material The three wallets' seeds, or both ledger versions' key objects.
   * @param options `manualSync` leaves the dust wallet unstarted in the background; drive it explicitly with
   *   {@link doSync} instead (requires a dust wallet built with the projections sync service, see
   *   `makeEventLessSyncService`).
   * @throws `ManualSyncUnsupportedError` When `manualSync` is asked for while the dust wallet is below `forks.v9`.
   *   Nothing has been started then, so starting again without it is a first start.
   */
  async start(material: FacadeStartMaterial, options: FacadeStartOptions = {}): Promise<void> {
    if (options.manualSync) {
      await this.#refuseManualSyncBelowFork();
    }
    await Promise.all([
      this.shielded.start(shieldedKeysOf(material)),
      this.unshielded.start(),
      !options.manualSync ? this.dust.start(dustKeysOf(material)) : undefined,
      this.transactionLifecycleService.start(),
    ]);
  }

  /**
   * Refuses manual synchronization while the dust wallet is below `forks.v9`.
   *
   * @remarks
   *   There the dust wallet is on its V1 variant, which cannot be stepped, so a dust wallet left to `doSync` would never
   *   move. Asked before any wallet is started, so a refusal leaves the facade exactly as it was.
   */
  async #refuseManualSyncBelowFork(): Promise<void> {
    const { protocolVersion } = await firstValueFrom(this.dust.state);
    if (protocolVersion < this.#forkVersion) {
      throw new ManualSyncUnsupportedError({
        message:
          `The dust wallet is at protocol version ${protocolVersion}, below forks.v9 (${this.#forkVersion}), where it ` +
          `cannot be synchronized by hand: its V1 variant has no stepped synchronization, whatever sync service it ` +
          `was built with. Start the facade without manualSync, and the dust wallet synchronizes in the background.`,
        protocolVersion,
      });
    }
  }

  /**
   * Runs a single dust synchronization pass and resolves when it completes. Only the dust wallet supports manual sync;
   * the shielded and unshielded wallets keep syncing in the background via {@link start}.
   *
   * @param material The same material {@link start} was given.
   * @returns Nothing; resolves once the pass has finished.
   * @throws `ManualSyncUnsupportedError` While the dust wallet is below `forks.v9`: its V1 variant has no stepped
   *   synchronization, whatever sync service it was built with.
   */
  async doSync(material: FacadeStartMaterial): Promise<void> {
    await this.dust.stepSync(dustKeysOf(material));
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.shielded.stop(),
      this.unshielded.stop(),
      this.dust.stop(),
      this.submissionService.close(),
      this.transactionLifecycleService.stop(),
      Promise.resolve(this.#pendingSubscription?.unsubscribe()),
      Promise.resolve(this.#protocolVersionSubscription?.unsubscribe()),
      Promise.resolve(this.#restoredBookingSubscription?.unsubscribe()),
    ]);
  }

  async queryTxHistoryByHash(hash: TransactionHistoryStorage.TransactionHash): Promise<WalletEntry | undefined> {
    return this.#txHistoryStorage.get(hash);
  }

  async getAllFromTxHistory(): Promise<WalletEntry[]> {
    const all = await this.#txHistoryStorage.getAll();
    return [...all];
  }
}
