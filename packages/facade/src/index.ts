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
  type DustWalletAPI,
  type DustWalletState,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import { type CoinsAndBalances as DustCoinsAndBalances } from '@midnightntwrk/wallet-sdk-dust-wallet/v2';
import {
  type DefaultShieldedConfiguration,
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
import { DustSectionSchema, mergeDustSections } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { FetchTermsAndConditions as FetchTermsAndConditionsQuery } from '@midnightntwrk/wallet-sdk-indexer-client';
import { QueryRunner } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Array as Arr, type DateTime, Either, Option, pipe, Schema } from 'effect';
import {
  type AnyTx,
  type FinalizedTx,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  TransactionHistoryStorage,
  type UnboundTx,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import { type WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import * as Signatures from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import {
  BehaviorSubject,
  combineLatest,
  concatMap,
  distinctUntilChanged,
  firstValueFrom,
  map,
  type Observable,
  type Subscription,
  tap,
} from 'rxjs';
import {
  type DefaultPendingTransactionsServiceConfiguration,
  PendingTransactions,
  type PendingTransactionsService,
  PendingTransactionsServiceImpl,
} from '@midnightntwrk/wallet-sdk-capabilities';
import {
  type AnyLedgerParameters,
  type AnyVersionValidatableTransaction,
  type BlockData,
  type BlockDataFetcher,
  makeDefaultBlockDataFetcher,
  makeDefaultVersionedValidationService,
  type ValidateTxOptions,
  ValidationFetchError,
  type VersionedValidationService,
  WellFormedError,
  type WellFormedStrictnessFlags,
} from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { finalizedTransactionTraits, txHistoryHash } from './transaction.js';

/**
 * Why the wallet gave up on a transaction, for the history entry.
 *
 * @remarks
 *   A chain rejection speaks for itself through the entry's status; an orphaned transaction has no chain verdict at all,
 *   so the entry is the only place the reason can be recorded.
 */
const rejectionReason = (result: PendingTransactions.TransactionResult): string | undefined =>
  result.status === 'ORPHANED_BY_FORK' ? 'orphaned-by-protocol-upgrade' : undefined;
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
 * Merge two wallet entries arriving under the same hash. Treats the entry as `T × lifecycle` per the storage model:
 *
 * - **Shared scalar facts about the tx** (`protocolVersion`, `status`, `timestamp`, `fees`) — first writer wins. Once any
 *   wallet has set the value, later writes are no-ops for these fields. This is correct because the value is the same
 *   across all wallets (it's a property of the on-chain tx, not the wallet's view of it).
 * - **`identifiers`** — unioned (each wallet may surface a different identifier subset).
 * - **`lifecycle`** — incoming wins (this is how `pending → finalized` transitions are recorded).
 * - **Wallet sections** (`shielded`, `unshielded`, `dust`) — combined via per-section merge when both sides have them;
 *   otherwise whichever side is present is used.
 */
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

export function mergeWalletEntries(existing: WalletEntry, incoming: WalletEntry): WalletEntry {
  // identifiers: each wallet may surface a different subset, so union them
  const identifiers = Array.from(new Set([...existing.identifiers, ...incoming.identifiers]));

  // wallet sections: per-section merge when both sides have it; whichever side is present otherwise
  const shielded = mergeOptionalSection(existing.shielded, incoming.shielded, mergeShieldedSections);
  const unshielded = mergeOptionalSection(existing.unshielded, incoming.unshielded, mergeUnshieldedSections);
  const dust = mergeOptionalSection(existing.dust, incoming.dust, mergeDustSections);

  return {
    hash: existing.hash,
    identifiers,
    // shared scalar facts about the on-chain tx — first writer wins (same value across all wallets)
    protocolVersion: existing.protocolVersion ?? incoming.protocolVersion,
    status: existing.status ?? incoming.status,
    timestamp: existing.timestamp ?? incoming.timestamp,
    fees: existing.fees ?? incoming.fees,
    // lifecycle: incoming wins — this is how pending → finalized/rejected transitions are recorded
    lifecycle: incoming.lifecycle,
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
 * The ledger operations the facade performs for itself rather than through a wallet, per protocol epoch.
 *
 * @remarks
 *   One place only: estimating what a dust registration will cost needs a signature over a transaction nobody will
 *   submit, and a signature comes from a ledger version's own primitives. Everything the facade hands back is in the
 *   ledger-v9's shape — a scheme and its bytes — so the ledger-v8 entry lifts what its ledger version writes as bare
 *   hex.
 */
type EpochAuthoring = Readonly<{
  sampleSigningKey: () => unknown;
  signatureVerifyingKey: (signingKey: never) => ledgerV9.SignatureVerifyingKey;
  signData: (signingKey: never, data: Uint8Array) => ledgerV9.Signature;
}>;

const v9Authoring: EpochAuthoring = {
  sampleSigningKey: () => ledgerV9.sampleSigningKey(),
  signatureVerifyingKey: (signingKey: never) => ledgerV9.signatureVerifyingKey(signingKey),
  signData: (signingKey: never, data: Uint8Array) => ledgerV9.signData(signingKey, data),
};

const v8Authoring: EpochAuthoring = {
  sampleSigningKey: () => ledgerV8.sampleSigningKey(),
  signatureVerifyingKey: (signingKey: never) =>
    Signatures.liftSignatureVerifyingKey(ledgerV8.signatureVerifyingKey(signingKey)),
  signData: (signingKey: never, data: Uint8Array) => Signatures.liftSignature(ledgerV8.signData(signingKey, data)),
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
   *   Requires a dust wallet built with the projections sync service; see `makeEventLessSyncService`.
   */
  manualSync?: boolean;
}>;

/**
 * The ledger-v9 key objects the wallets' own `start` takes, from whichever material the caller supplied.
 *
 * @remarks
 *   Only the ledger-v9 side is needed here: a wallet built from seeds or from both versions' keys already holds what its
 *   V1 variant needs, retained when it was built. What `start` supplies is the side the wallet's own API speaks.
 */
const v9KeysOf = (
  material: FacadeStartMaterial,
): Readonly<{ shielded: ledgerV9.ZswapSecretKeys; dust: ledgerV9.DustSecretKey }> =>
  'v9' in material
    ? material.v9
    : {
        shielded: ledgerV9.ZswapSecretKeys.fromSeed(material.shielded),
        dust: ledgerV9.DustSecretKey.fromSeed(material.dust),
      };

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
 * What has become of a transaction the wallet submitted.
 *
 * @remarks
 *   Tagged rather than a status string, and deliberately: `Orphaned` and `Rejected` are different facts about the world
 *   and the difference matters to what an application should do next. A rejection is the chain's verdict — the node saw
 *   the transaction and refused it. An orphaned transaction has no verdict at all and never will: its bytes were
 *   authored under a protocol version the chain has moved past, and nothing can include them afterwards. The wallet has
 *   already unbooked its coins and recorded the rejection either way; what differs is what an application can tell a
 *   user, and whether re-submitting the same bytes could ever help.
 */
export type PendingStatus =
  | Readonly<{ _tag: 'Submitted' }>
  | Readonly<{ _tag: 'Confirmed'; segments: readonly Readonly<{ id: number; success: boolean }>[] }>
  | Readonly<{ _tag: 'Rejected'; segments: readonly Readonly<{ id: number; success: boolean }>[] }>
  | Readonly<{
      _tag: 'Orphaned';
      /** The protocol version the transaction was authored for. */
      authoredFor: ProtocolVersion.ProtocolVersion;
      /** The protocol version the chain had reached when the wallet gave up on it. */
      chainNow: ProtocolVersion.ProtocolVersion;
    }>;

/** A transaction the wallet has submitted and the chain has not finished answering for. */
export type PendingTransaction = Readonly<{
  /** The transaction itself, as the handle an application carries. */
  transaction: FinalizedTx;
  /** When the wallet recorded it as pending. */
  submittedAt: DateTime.Utc;
  /**
   * The protocol version it was authored for, when the wallet had observed one.
   *
   * @remarks
   *   `Option.none()` means the wallet never learned which version it was authored against. Such a transaction is never
   *   orphaned — an unobserved version is not evidence of anything.
   */
  authoredFor: Option.Option<ProtocolVersion.ProtocolVersion>;
  /** What has become of it. See {@link PendingStatus}. */
  status: PendingStatus;
}>;

/** Reads what has become of a transaction from the verdict the pending set holds, if it holds one. */
const pendingStatusOf = (result: PendingTransactions.TransactionResult | undefined): PendingStatus => {
  if (result === undefined) return { _tag: 'Submitted' };
  switch (result.status) {
    case 'SUCCESS':
      return { _tag: 'Confirmed', segments: result.segments };
    case 'FAILURE':
    case 'PARTIAL_SUCCESS':
      // A transaction only some of whose segments succeeded is still not a transaction that happened as submitted.
      return { _tag: 'Rejected', segments: result.segments };
    case 'ORPHANED_BY_FORK':
      return { _tag: 'Orphaned', authoredFor: result.authoredFor, chainNow: result.chainNow };
  }
};

/**
 * The pending transactions as an application reads them.
 *
 * @remarks
 *   A projection over the pending set the services keep, not a second copy of it: the facts are the same, stated as a
 *   list of transactions with a status each rather than as the bag the machinery works in.
 * @param pending The pending set.
 * @returns One entry per transaction, in the order the wallet recorded them.
 */
export const pendingTransactionsOf = (
  pending: PendingTransactions.PendingTransactions<FinalizedTx>,
): readonly PendingTransaction[] =>
  pending.all.map((item) => ({
    transaction: item.tx,
    submittedAt: item.creationTime,
    authoredFor: item.protocolVersion,
    status: pendingStatusOf('result' in item ? item.result : undefined),
  }));

export class FacadeState {
  public readonly shielded: ShieldedWalletState;
  public readonly unshielded: UnshieldedWalletState;
  public readonly dust: DustWalletState;
  public readonly pending: readonly PendingTransaction[];

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
      this.shielded.state.progress.isStrictlyComplete() &&
      this.dust.state.progress.isStrictlyComplete() &&
      this.unshielded.progress.isStrictlyComplete()
    );
  }

  /** Where the chain hands over from one ledger version to the next, which is what {@link protocol} is read against. */
  readonly #forkVersion: ProtocolVersion.ProtocolVersion;

  constructor(
    shielded: ShieldedWalletState,
    unshielded: UnshieldedWalletState,
    dust: DustWalletState,
    pending: PendingTransactions.PendingTransactions<FinalizedTx>,
    forkVersion: ProtocolVersion.ProtocolVersion = ProtocolVersion.MinSupportedVersion,
  ) {
    this.shielded = shielded;
    this.unshielded = unshielded;
    this.dust = dust;
    this.pending = pendingTransactionsOf(pending);
    this.#forkVersion = forkVersion;
  }
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

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

export type DefaultConfiguration = DefaultUnshieldedConfiguration &
  DefaultShieldedConfiguration &
  DefaultDustConfiguration &
  DefaultSubmissionConfiguration &
  DefaultPendingTransactionsServiceConfiguration &
  DefaultProvingConfiguration;

type MaybePromise<T> = T | Promise<T>;

/**
 * Parameters object for {@link WalletFacade.init}. It features configuration and bunch of initializers for the wallets
 * and services, all of them are in a form of a function that takes the configuration and returns proper implementation,
 * either synchronously or wrapped in a Promise. Services are optional to provide ({@link WalletFacade.init} will provide
 * default implementations), but all 3 wallets: shielded, unshielded and Dust one need to be present
 */
export type InitParams<TConfig extends DefaultConfiguration> = {
  configuration: TConfig;
  /** Optional factory for the clock abstraction. Defaults to system clock (`() => new Date()`). */
  clock?: (config: TConfig) => MaybePromise<Clock.Clock>;
  submissionService?: (config: TConfig) => MaybePromise<SubmissionService<FinalizedTx>>;
  pendingTransactionsService?: (config: TConfig) => MaybePromise<PendingTransactionsService<FinalizedTx>>;
  provingService?: (
    config: TConfig,
  ) => MaybePromise<VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>>;
  /**
   * Optional factory for the block-data fetcher used by validation. Defaults to an HTTP indexer-backed fetcher built
   * from `configuration.indexerClientConnection`. Override for simulator-based tests with
   * `makeSimulatorBlockDataFetcher(simulator)` from `@midnightntwrk/wallet-sdk-capabilities/validation`.
   */
  fetchBlockData?: (config: TConfig) => MaybePromise<BlockDataFetcher>;
  validationService?: (
    config: TConfig,
    deps: { fetchBlockData: BlockDataFetcher; clock: Clock.Clock },
  ) => MaybePromise<VersionedValidationService<AnyVersionValidatableTransaction, AnyLedgerParameters>>;
  shielded: (config: TConfig) => MaybePromise<ShieldedWalletAPI>;
  unshielded: (config: TConfig) => MaybePromise<UnshieldedWalletAPI>;
  dust: (config: TConfig) => MaybePromise<DustWalletAPI>;
};

// `BlockData` is not re-exported from the facade to avoid a name collision with the
// `@midnightntwrk/wallet-sdk-dust-wallet` export. The two are structurally identical; users can name the type via
// `@midnightntwrk/wallet-sdk-dust-wallet` or `@midnightntwrk/wallet-sdk-capabilities/validation`.
export {
  type BlockDataFetcher,
  type ValidateTxOptions,
  type VersionedValidationService,
  ValidationFetchError,
  WellFormedError,
  type WellFormedStrictnessFlags,
};

export class WalletFacade {
  private static makeDefaultSubmissionService<TConfig extends DefaultSubmissionConfiguration>(
    config: TConfig,
  ): SubmissionService<FinalizedTx> {
    // A handle serializes itself, which is all submission needs of a transaction — and the one thing every ledger
    // version's transaction does identically.
    return makeDefaultSubmissionService<FinalizedTx>(config);
  }

  private static makeDefaultPendingTransactionsService<
    TConfig extends DefaultPendingTransactionsServiceConfiguration & { forks: ProtocolVersion.ForkSchedule },
  >(config: TConfig): Promise<PendingTransactionsServiceImpl<FinalizedTx>> {
    return PendingTransactionsServiceImpl.init<FinalizedTx>({
      configuration: config,
      txTraits: finalizedTransactionTraits(config.forks.v9),
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
    config: TConfig,
  ): VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction> {
    return Either.getOrThrowWith(
      makeDefaultVersionedProvingService(config, config.forks),
      (error) => new Error(error.message),
    );
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
   *   convey use-case-specific settings in the same way, as the SDK works by default
   * - `shielded` - a function taking the configuration and returning shielded wallet (or a promise with such)
   *   implementing {@link ShieldedWalletAPI}
   * - `unshielded` - a function taking the configuration and returning unshielded wallet (or a promise with such)
   *   implementing {@link UnshieldedWalletAPI}
   * - `dust` - a function taking the configuration and returning Dust wallet (or a promise with such) implementing
   *   {@link DustWalletAPI} There are some optional services/abstractions to provide, too. If not provided - default
   *   implementations will be used, each of them is initialized by a function taking the configuration and returning
   *   proper implementation (wrapped in a {@link Promise} or not).
   * - `submissionService` - needs to implement {@link SubmissionService} for a {@link ledgerV9.FinalizedTransaction} to
   *   submit transactions to the network, default uses Node RPC connection
   * - `pendingTransactionsService` - needs to implement {@link PendingTransactionsService} for a
   *   {@link ledgerV9.FinalizedTransaction} to keep track of pending transactions, default uses in-memory
   *   implementation
   * - `provingService` - needs to implement {@link VersionedProvingService} to prove it, default uses proving server
   * - `clock` - needs to implement {@link Clock.Clock} for getting current time, default uses system clock
   */
  static async init<TConfig extends DefaultConfiguration>(initParams: InitParams<TConfig>): Promise<WalletFacade> {
    const submissionService = await Promise.resolve(
      initParams.submissionService
        ? initParams.submissionService(initParams.configuration)
        : WalletFacade.makeDefaultSubmissionService(initParams.configuration),
    );
    const pendingTransactionsService = await Promise.resolve(
      initParams.pendingTransactionsService
        ? initParams.pendingTransactionsService(initParams.configuration)
        : WalletFacade.makeDefaultPendingTransactionsService(initParams.configuration),
    );
    const provingService = await Promise.resolve(
      initParams.provingService
        ? initParams.provingService(initParams.configuration)
        : WalletFacade.makeDefaultProvingService(initParams.configuration),
    );
    const shielded = await Promise.resolve(initParams.shielded(initParams.configuration));
    const unshielded = await Promise.resolve(initParams.unshielded(initParams.configuration));
    const dust = await Promise.resolve(initParams.dust(initParams.configuration));
    const clock = await Promise.resolve(
      initParams.clock ? initParams.clock(initParams.configuration) : Clock.systemClock,
    );
    const fetchBlockData: BlockDataFetcher = await Promise.resolve(
      initParams.fetchBlockData
        ? initParams.fetchBlockData(initParams.configuration)
        : makeDefaultBlockDataFetcher(initParams.configuration),
    );
    const validationService = await Promise.resolve(
      initParams.validationService
        ? initParams.validationService(initParams.configuration, { fetchBlockData, clock })
        : makeDefaultVersionedValidationService(
            {
              fetchBlockData,
              networkId: initParams.configuration.networkId,
              clock,
            },
            initParams.configuration.forks.v9,
          ),
    );
    return new WalletFacade(
      shielded,
      unshielded,
      dust,
      submissionService,
      pendingTransactionsService,
      provingService,
      validationService,
      initParams.configuration.txHistoryStorage,
      initParams.configuration.forks.v9,
      clock,
    );
  }

  readonly shielded: ShieldedWalletAPI;
  readonly unshielded: UnshieldedWalletAPI;
  readonly dust: DustWalletAPI;
  readonly submissionService: SubmissionService<FinalizedTx>;
  readonly pendingTransactionsService: PendingTransactionsService<FinalizedTx>;
  readonly provingService: VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>;
  readonly validationService: VersionedValidationService<AnyVersionValidatableTransaction, AnyLedgerParameters>;
  #txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>;
  readonly clock: Clock.Clock;
  #pendingSubscription: Subscription;
  #protocolVersionSubscription: Subscription;
  /**
   * The protocol version the wallets have all reached, as last observed.
   *
   * @remarks
   *   `Option.none()` until the three wallets have each emitted once. A transaction stamped with `none` is never
   *   orphaned, so an unobserved version costs a transaction nothing but the ability to be given up on early.
   */
  #observedProtocolVersion = new BehaviorSubject<Option.Option<ProtocolVersion.ProtocolVersion>>(Option.none());

  /** Where the chain hands over from one ledger version to the next, which is what divides the two epochs. */
  readonly #forkVersion: ProtocolVersion.ProtocolVersion;

  /**
   * Constructor is private on purpose - much of initialization of the facade is potentially asynchronous, and adding
   * new parameters is a breaking change to the users Use {@link WalletFacade.init} instead
   *
   * @private
   */
  private constructor(
    shieldedWallet: ShieldedWalletAPI,
    unshieldedWallet: UnshieldedWalletAPI,
    dustWallet: DustWalletAPI,
    submissionService: SubmissionService<FinalizedTx>,
    pendingTransactionsService: PendingTransactionsService<FinalizedTx>,
    provingService: VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>,
    validationService: VersionedValidationService<AnyVersionValidatableTransaction, AnyLedgerParameters>,
    txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>,
    forkVersion: ProtocolVersion.ProtocolVersion,
    clock: Clock.Clock = Clock.systemClock,
  ) {
    this.shielded = shieldedWallet;
    this.unshielded = unshieldedWallet;
    this.dust = dustWallet;
    this.submissionService = submissionService;
    this.pendingTransactionsService = pendingTransactionsService;
    this.provingService = provingService;
    this.validationService = validationService;
    this.#txHistoryStorage = txHistoryStorage;
    this.#forkVersion = forkVersion;
    this.clock = clock;
    this.#pendingSubscription = this.pendingTransactionsService
      .state()
      .pipe(
        concatMap((pending) => PendingTransactions.allRejected(pending)),
        concatMap((item) => this.revert(item.tx, rejectionReason(item.result))),
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
        concatMap((version) => this.pendingTransactionsService.orphanBeyond(version)),
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
   * @throws {@link ProtocolVersionMismatchError} When the transaction was built on the other side of the boundary.
   */
  private accept<T>(handle: AnyTx): T {
    return Either.getOrThrowWith(
      WalletTransaction.unwrapWithin<T>(handle, this.currentEpoch()),
      (error: ProtocolVersionMismatchError) => error,
    );
  }

  /** Seals a transaction the facade or a wallet produced, at the version the facade is acting at. */
  private seal<TStage extends WalletTransaction.Stage>(
    stage: TStage,
    transaction: { serialize: () => Uint8Array },
  ): WalletTransaction<TStage> {
    return WalletTransaction.adopt(stage, transaction, this.currentVersion());
  }

  /** The ledger primitives the facade signs with on its current side of the boundary. */
  private authoring(): EpochAuthoring {
    return this.currentVersion() < this.#forkVersion ? v8Authoring : v9Authoring;
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
   *   const recipe = await facade.balanceFinalizedTransaction(tx, secretKeys, options);
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
   */
  async validateTransaction(tx: AnyTx, options: ValidateTxOptions<AnyLedgerParameters>): Promise<void> {
    // Checked at the version the transaction says it was authored for, and never at the version the chain has since
    // reached: well-formedness asks whether the ledger that produced these bytes would accept them, and a fork landing
    // afterwards cannot change that answer. The transaction is read at its own epoch for the same reason.
    return this.validationService.validateTx(
      Either.getOrThrowWith(
        WalletTransaction.unwrapWithin<AnyVersionValidatableTransaction>(
          tx,
          ProtocolVersion.epochOf(tx.protocolVersion, this.#forkVersion),
        ),
        (error: ProtocolVersionMismatchError) => error,
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
    if (a && b) return this.seal('Unproven', this.accept<CarriedUnproven>(a).merge(this.accept<CarriedUnproven>(b)));
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
    const split = await this.dust.splitNightUtxosForDustRegistration(
      now,
      nightUtxos.map(({ utxo, meta }) => ({
        ...utxo,
        ctime: meta.ctime,
        registeredForDustGeneration: meta.registeredForDustGeneration,
      })),
      isRegistration,
    );

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
      await this.unshielded.revertTransaction(txWithOffers);
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
      if (split.feePayment < fee) {
        await this.unshielded.revertTransaction(txWithOffers);
        throw Error(
          `Insufficient generated dust to cover registration fee (have ${split.feePayment}, need ${fee}). ` +
            `Use WalletFacade.waitForGeneratedDust(utxos, ${fee}) before retrying.`,
        );
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
      await this.unshielded.revertTransaction(txWithOffers);
      throw error;
    }
  }

  state(): Observable<FacadeState> {
    return combineLatest([
      this.shielded.state,
      this.unshielded.state,
      this.dust.state,
      this.pendingTransactionsService.state(),
    ]).pipe(
      map(
        ([shieldedState, unshieldedState, dustState, pending]) =>
          new FacadeState(shieldedState, unshieldedState, dustState, pending, this.#forkVersion),
      ),
    );
  }

  async waitForSyncedState(): Promise<FacadeState> {
    const [shieldedState, unshieldedState, dustState, pending] = await Promise.all([
      this.shielded.waitForSyncedState(),
      this.unshielded.waitForSyncedState(),
      this.dust.waitForSyncedState(),
      firstValueFrom(this.pendingTransactionsService.state()),
    ]);

    return new FacadeState(shieldedState, unshieldedState, dustState, pending, this.#forkVersion);
  }

  /**
   * Submits a finalized transaction to the network and tracks it as pending until finalized or discarded.
   *
   * Call {@link validateTransaction} with `{ enforceBalancing: true, verifySignatures: true, enforceLimits: true }`
   * before this method to surface structural errors with a clear diagnostic instead of a cryptic network rejection.
   *
   * @param tx - The finalized transaction to submit.
   * @returns The transaction identifier.
   * @throws {@link WellFormedError} — call {@link validateTransaction} first to get this error early.
   */
  async submitTransaction(tx: FinalizedTx): Promise<TransactionIdentifier> {
    const carried = this.accept<Carried>(tx);
    const identifiers = carried.identifiers();
    try {
      await this.pendingTransactionsService.addPendingTransaction(tx, this.#observedProtocolVersion.getValue());
      // Insert before awaiting submission so the entry exists while the tx is in flight — the per-wallet sync
      // handlers' gotFinalized call clears the pending entry on confirmation.
      const key = submitTxHistoryKey(carried);
      await this.#txHistoryStorage.gotPending({ ...key, submittedAt: this.clock.now() });
      await this.submissionService.submitTransaction(tx, 'Finalized');

      return identifiers.at(-1)!;
    } catch (error) {
      await this.revert(tx);
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
   * @param tx - The finalized transaction to balance.
   * @param secretKeys - Secret keys for shielded and dust coin selection.
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

    const shieldedBalancingTx = shouldBalanceShielded ? await this.shielded.balanceTransaction(tx) : undefined;

    // Step 2: Merge unshielded and shielded balancing
    const mergedBalancingTx = this.mergeUnprovenTransactions(shieldedBalancingTx, unshieldedBalancingTx);

    // Step 3: Conditionally add dust/fee balancing
    const dustResult = shouldBalanceDust
      ? await this.dust.balanceTransactions(mergedBalancingTx ? [tx, mergedBalancingTx] : [tx], ttl)
      : undefined;
    const feeBalancingTx = dustResult?.transaction;

    // Step 4: Merge fee balancing and create final recipe
    const balancingTx = this.mergeUnprovenTransactions(mergedBalancingTx, feeBalancingTx);

    if (!balancingTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    return {
      type: 'FINALIZED_TRANSACTION',
      protocolVersion: this.currentVersion(),
      originalTransaction: tx,
      balancingTransaction: balancingTx,
      ...(dustResult ? { blockData: dustResult.blockData } : {}),
    };
  }

  /**
   * Balances an unbound (proven, pre-binding) transaction by adding shielded, unshielded, and dust inputs/outputs.
   *
   * Call {@link validateTransaction} with `{ enforceBalancing: false, verifySignatures: false, enforceLimits: false }`
   * before this method to surface structural errors early. All configurable flags are `false` because the transaction
   * is not yet balanced and signatures are not yet present.
   *
   * @param tx - The unbound transaction to balance.
   * @param secretKeys - Secret keys for shielded and dust coin selection.
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
    const shieldedBalancingTx = shouldBalanceShielded ? await this.shielded.balanceTransaction(tx) : undefined;

    // For unbound transactions, unshielded balancing happens in place not with a balancing transaction
    const balancedUnshieldedTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceUnboundTransaction(tx)
      : undefined;

    // Step 2: Unbound unshielded tx are balanced in place, use it as base tx if present
    const baseTx = balancedUnshieldedTx ?? tx;

    // Step 3: Conditionally add dust/fee balancing
    const dustResult = shouldBalanceDust
      ? await this.dust.balanceTransactions(shieldedBalancingTx ? [baseTx, shieldedBalancingTx] : [baseTx], ttl)
      : undefined;
    const feeBalancingTransaction = dustResult?.transaction;

    // Step 4: Create the final balancing transaction
    const balancingTransaction = this.mergeUnprovenTransactions(shieldedBalancingTx, feeBalancingTransaction);

    // if there is no balancingTransaction and there was no unshielded tx balancing (in place) throw an error.
    if (!balancingTransaction && !balancedUnshieldedTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    return {
      type: 'UNBOUND_TRANSACTION',
      protocolVersion: this.currentVersion(),
      baseTransaction: baseTx,
      balancingTransaction: balancingTransaction ?? undefined,
      ...(dustResult ? { blockData: dustResult.blockData } : {}),
    };
  }

  /**
   * Balances an unproven transaction by adding shielded, unshielded, and dust inputs/outputs.
   *
   * Call {@link validateTransaction} with `{ enforceBalancing: false, verifySignatures: false, enforceLimits: false }`
   * before this method to surface structural errors early. All configurable flags are `false` because the transaction
   * is not yet balanced and signatures are not yet present.
   *
   * @param tx - The unproven transaction to balance.
   * @param secretKeys - Secret keys for shielded and dust coin selection.
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
    const shieldedBalancingTx = shouldBalanceShielded ? await this.shielded.balanceTransaction(tx) : undefined;

    // For unproven transactions, unshielded balancing happens in place
    const balancedUnshieldedTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceUnprovenTransaction(tx)
      : undefined;

    // Step 2: Use the balanced unshielded tx if present, otherwise use the original tx
    const baseTx = balancedUnshieldedTx ?? tx;

    // Step 3: Merge shielded balancing into base tx if present
    const mergedTx = this.mergeUnprovenTransactions(baseTx, shieldedBalancingTx)!;

    // Step 4: Conditionally add dust/fee balancing
    const dustResult = shouldBalanceDust ? await this.dust.balanceTransactions([mergedTx], ttl) : undefined;
    const feeBalancingTx = dustResult?.transaction;

    // Step 5: Merge fee balancing if present
    const balancedTx = this.mergeUnprovenTransactions(mergedTx, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: balancedTx,
      ...(dustResult ? { blockData: dustResult.blockData } : {}),
    };
  }

  async finalizeRecipe(recipe: BalancingRecipe): Promise<FinalizedTx> {
    return Promise.resolve(recipe)
      .then(async (recipe): Promise<FinalizedTx> => {
        switch (recipe.type) {
          case 'FINALIZED_TRANSACTION': {
            const finalizedBalancing = await this.finalizeTransaction(recipe.balancingTransaction);
            return this.seal(
              'Finalized',
              this.accept<CarriedFinalized>(recipe.originalTransaction).merge(
                this.accept<CarriedFinalized>(finalizedBalancing),
              ),
            );
          }
          case 'UNBOUND_TRANSACTION': {
            const finalizedBalancingTx = recipe.balancingTransaction
              ? await this.finalizeTransaction(recipe.balancingTransaction)
              : undefined;
            const finalizedTransaction = this.accept<CarriedUnbound>(recipe.baseTransaction).bind();
            return this.seal(
              'Finalized',
              finalizedBalancingTx
                ? finalizedTransaction.merge(this.accept<CarriedFinalized>(finalizedBalancingTx))
                : finalizedTransaction,
            );
          }
          case 'UNPROVEN_TRANSACTION': {
            return await this.finalizeTransaction(recipe.transaction);
          }
        }
      })
      .then(async (finalizedTx) => {
        await this.pendingTransactionsService.addPendingTransaction(
          finalizedTx,
          this.#observedProtocolVersion.getValue(),
        );
        return finalizedTx;
      });
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
   * Proves and binds an unproven transaction, and records it as pending.
   *
   * @remarks
   *   Proved at the version stamped on the transaction itself, which is the version that fixed its bytes. A fork landing
   *   between building a transaction and proving it therefore cannot send it to the wrong prover — and a transaction of
   *   the epoch the facade is no longer in is refused rather than proved into something nobody can include.
   * @param tx The unproven transaction.
   * @returns The finalized transaction.
   */
  async finalizeTransaction(tx: UnprovenTx): Promise<FinalizedTx> {
    try {
      // Named as the prover's input rather than its output: the router hands the transaction to the prover registered
      // for the version it was authored at, and what comes back is that ledger version's unbound transaction.
      const unboundTx = await this.provingService.prove(
        this.accept<ledgerV9.UnprovenTransaction>(tx),
        tx.protocolVersion,
      );
      const finalizedTx = this.seal('Finalized', (unboundTx as unknown as CarriedUnbound).bind());
      await this.pendingTransactionsService.addPendingTransaction(
        finalizedTx,
        this.#observedProtocolVersion.getValue(),
      );
      return finalizedTx;
    } catch (error) {
      await Promise.allSettled([
        this.shielded.revertTransaction(tx),
        this.unshielded.revertTransaction(tx),
        this.dust.revertTransaction(tx),
      ]);
      throw error;
    }
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
      shieldedOutputs.length > 0 ? await this.shielded.transferTransaction(shieldedOutputs) : undefined;

    const unshieldedTx =
      unshieldedOutputs.length > 0 ? await this.unshielded.transferTransaction(unshieldedOutputs, ttl) : undefined;

    const mergedTxs = this.mergeUnprovenTransactions(shieldedTx, unshieldedTx)!;

    // Add fee payment
    const dustResult = payFees ? await this.dust.balanceTransactions([mergedTxs], ttl) : undefined;
    const feeBalancingTx = dustResult?.transaction;

    const finalTx = this.mergeUnprovenTransactions(mergedTxs, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: finalTx,
      ...(dustResult ? { blockData: dustResult.blockData } : {}),
    };
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

    const finalizedFakeTx = this.seal('Finalized', this.accept<CarriedUnproven>(fakeSignedTx).mockProve().bind());

    const fee = await this.calculateTransactionFee(finalizedFakeTx);

    return {
      fee,
      dustGenerationEstimations,
    };
  }

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

    const shieldedTx =
      hasShieldedPart && shieldedInputs !== undefined
        ? await this.shielded.initSwap(shieldedInputs, shieldedOutputs)
        : undefined;

    const unshieldedTx =
      hasUnshieldedPart && unshieldedInputs !== undefined
        ? await this.unshielded.initSwap(unshieldedInputs, unshieldedOutputs, ttl)
        : undefined;

    const combinedTx = this.mergeUnprovenTransactions(shieldedTx, unshieldedTx);

    if (!combinedTx) {
      throw Error('Unexpected transaction state.');
    }

    const dustResult = payFees ? await this.dust.balanceTransactions([combinedTx], ttl) : undefined;
    const feeBalancingTx = dustResult?.transaction;

    const finalTx = this.mergeUnprovenTransactions(combinedTx, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: finalTx,
      ...(dustResult ? { blockData: dustResult.blockData } : {}),
    };
  }

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

    return {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: dustRegistrationTx,
    };
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
    return {
      type: 'UNPROVEN_TRANSACTION',
      protocolVersion: this.currentVersion(),
      transaction: dustDeregistrationTx,
    };
  }

  async revert(txOrRecipe: AnyTx | BalancingRecipe, reason?: string): Promise<void> {
    // avoid instanceof check
    const transactionsToRevert = BalancingRecipe.isRecipe(txOrRecipe)
      ? BalancingRecipe.getTransactions(txOrRecipe)
      : [txOrRecipe];

    await Promise.all(transactionsToRevert.map((tx) => this.revertTransaction(tx, reason)));
  }

  async revertTransaction(tx: AnyTx, reason?: string): Promise<void> {
    await Promise.all([
      this.shielded.revertTransaction(tx),
      this.unshielded.revertTransaction(tx),
      this.dust.revertTransaction(tx),
    ]).then(async () => {
      // Reverting is total over the stages: a transaction at any of them may have booked coins, and the pending set
      // recognises only the finalized ones. Narrowing rather than casting is what says so.
      await this.pendingTransactionsService.clear(tx as FinalizedTx);
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
    });
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
   */
  async start(material: FacadeStartMaterial, options: FacadeStartOptions = {}): Promise<void> {
    const keys = v9KeysOf(material);
    await Promise.all([
      this.shielded.start(keys.shielded),
      this.unshielded.start(),
      !options.manualSync ? this.dust.start(keys.dust) : undefined,
      this.pendingTransactionsService.start(),
    ]);
  }

  /**
   * Runs a single dust synchronization pass and resolves when it completes. Only the dust wallet supports manual sync;
   * the shielded and unshielded wallets keep syncing in the background via {@link start}.
   *
   * @param material The same material {@link start} was given.
   */
  async doSync(material: FacadeStartMaterial): Promise<void> {
    await this.dust.stepSync(v9KeysOf(material).dust);
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.shielded.stop(),
      this.unshielded.stop(),
      this.dust.stop(),
      this.submissionService.close(),
      this.pendingTransactionsService.stop(),
      Promise.resolve(this.#pendingSubscription?.unsubscribe()),
      Promise.resolve(this.#protocolVersionSubscription?.unsubscribe()),
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
