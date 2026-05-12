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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import {
  type DefaultSubmissionConfiguration,
  makeDefaultSubmissionService,
  type SubmissionService,
} from '@midnight-ntwrk/wallet-sdk-capabilities';
import {
  type DefaultProvingConfiguration,
  makeDefaultProvingService,
  type ProvingService,
  type UnboundTransaction,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import {
  type DefaultDustConfiguration,
  type DustWalletAPI,
  type DustWalletState,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  type AnyTransaction,
  type CoinsAndBalances as DustCoinsAndBalances,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import {
  type DefaultShieldedConfiguration,
  type ShieldedWalletAPI,
  type ShieldedWalletState,
  ShieldedSectionSchema,
  mergeShieldedSections,
} from '@midnight-ntwrk/wallet-sdk-shielded';
import type { DefaultUnshieldedConfiguration, UnshieldedWalletAPI } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  type UnshieldedWalletState,
  UnshieldedSectionSchema,
  mergeUnshieldedSections,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustSectionSchema, mergeDustSections } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { FetchTermsAndConditions as FetchTermsAndConditionsQuery } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { QueryRunner } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { Array as Arr, pipe, Schema } from 'effect';
import { TransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { combineLatest, map, type Observable, firstValueFrom, type Subscription, concatMap } from 'rxjs';
import {
  type DefaultPendingTransactionsServiceConfiguration,
  PendingTransactions,
  type PendingTransactionsService,
  PendingTransactionsServiceImpl,
} from '@midnight-ntwrk/wallet-sdk-capabilities';
import { finalizedTransactionTrait } from './transaction.js';
import {
  type DustAddress,
  type ShieldedAddress,
  type UnshieldedAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';

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
 * Storage key for a tx we're about to submit. The TypeScript type promises the tx is signed + proven + bound, so
 * `transactionHash()` should succeed — but ledger-v8's phantom type parameters can't witness the actual WASM-side state
 * (the handle may have been consumed, or the caller may have cast through the type system), so we catch and return
 * `undefined` rather than fabricate a key under an arbitrary identifier. A caller that gets `undefined` should skip
 * writing the pending entry: papering over the type-contract violation here would hide a real upstream bug.
 */
const submitTxHistoryKey = (
  tx: ledger.FinalizedTransaction,
): { readonly hash: string; readonly identifiers: readonly string[] } | undefined => {
  try {
    return { hash: tx.transactionHash().toString(), identifiers: tx.identifiers() };
  } catch {
    return undefined;
  }
};

/**
 * Storage key for a tx we're about to revert. Unlike submission, the input is `AnyTransaction` and may legitimately not
 * be hashable — the union includes `UnprovenTransaction`, `ProofErasedTransaction`, and pre-binding variants whose
 * chain hash doesn't exist yet. When `transactionHash()` throws (or the tx never reached a hashable state), we fall
 * back to `identifiers[0]`, which is the same key the pending entry was inserted under by the corresponding
 * `gotPending` path. Returns `undefined` only when the tx has no identifiers at all (nothing to revert).
 */
const revertTxHistoryKey = (
  tx: AnyTransaction,
): { readonly hash: string; readonly identifiers: readonly string[] } | undefined => {
  const identifiers = tx.identifiers();
  if (identifiers.length === 0) return undefined;
  try {
    return { hash: tx.transactionHash().toString(), identifiers };
  } catch {
    return { hash: identifiers[0], identifiers };
  }
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
  originalTransaction: ledger.FinalizedTransaction;
  balancingTransaction: ledger.UnprovenTransaction;
};

export type UnboundTransactionRecipe = {
  type: 'UNBOUND_TRANSACTION';
  baseTransaction: UnboundTransaction;
  // balancingTransaction is optional because if the user decides to balance only the unshielded part,
  // it occurs "in place" so the baseTransaction is modified
  balancingTransaction?: ledger.UnprovenTransaction | undefined;
};

export type UnprovenTransactionRecipe = {
  type: 'UNPROVEN_TRANSACTION';
  transaction: ledger.UnprovenTransaction;
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
  getTransactions: (recipe: BalancingRecipe): readonly AnyTransaction[] => {
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
  type: ledger.RawTokenType;
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
  shielded?: Record<ledger.RawTokenType, bigint>;
  unshielded?: Record<ledger.RawTokenType, bigint>;
};

export type CombinedSwapOutputs = CombinedTokenTransfer;

export type TransactionIdentifier = string;

export type UtxoWithMeta = {
  utxo: ledger.Utxo;
  meta: {
    ctime: Date;
    registeredForDustGeneration: boolean;
  };
};

export class FacadeState {
  public readonly shielded: ShieldedWalletState;
  public readonly unshielded: UnshieldedWalletState;
  public readonly dust: DustWalletState;
  public readonly pending: PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>;

  public get isSynced(): boolean {
    return (
      this.shielded.state.progress.isStrictlyComplete() &&
      this.dust.state.progress.isStrictlyComplete() &&
      this.unshielded.progress.isStrictlyComplete()
    );
  }

  constructor(
    shielded: ShieldedWalletState,
    unshielded: UnshieldedWalletState,
    dust: DustWalletState,
    pending: PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>,
  ) {
    this.shielded = shielded;
    this.unshielded = unshielded;
    this.dust = dust;
    this.pending = pending;
  }
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * A clock abstraction for obtaining the current time. By default, the facade uses the system clock. For testing with a
 * simulator, inject a custom clock (e.g., one backed by the simulator's time).
 */
export type Clock = {
  readonly now: () => Date;
};

/** Default clock using real system time. */
export const systemClock: Clock = { now: () => new Date() };

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
  Partial<DefaultProvingConfiguration>;

type MaybePromise<T> = T | Promise<T>;
export type InitParams<TConfig extends DefaultConfiguration> = {
  configuration: TConfig;
  /** Optional factory for the clock abstraction. Defaults to system clock (`() => new Date()`). */
  clock?: (config: TConfig) => MaybePromise<Clock>;
  submissionService?: (config: TConfig) => MaybePromise<SubmissionService<ledger.FinalizedTransaction>>;
  pendingTransactionsService?: (
    config: TConfig,
  ) => MaybePromise<PendingTransactionsService<ledger.FinalizedTransaction>>;
  provingService?: (config: TConfig) => MaybePromise<ProvingService<UnboundTransaction>>;
  shielded: (config: TConfig) => MaybePromise<ShieldedWalletAPI>;
  unshielded: (config: TConfig) => MaybePromise<UnshieldedWalletAPI>;
  dust: (config: TConfig) => MaybePromise<DustWalletAPI>;
};

export class WalletFacade {
  private static makeDefaultSubmissionService<TConfig extends DefaultSubmissionConfiguration>(
    config: TConfig,
  ): SubmissionService<ledger.FinalizedTransaction> {
    return makeDefaultSubmissionService<ledger.FinalizedTransaction>(config);
  }

  private static makeDefaultPendingTransactionsService<TConfig extends DefaultPendingTransactionsServiceConfiguration>(
    config: TConfig,
  ): Promise<PendingTransactionsServiceImpl<ledger.FinalizedTransaction>> {
    return PendingTransactionsServiceImpl.init<ledger.FinalizedTransaction>({
      configuration: config,
      txTrait: finalizedTransactionTrait,
    });
  }

  private static makeDefaultProvingService<TConfig extends Partial<DefaultProvingConfiguration>>(
    config: TConfig,
  ): ProvingService<UnboundTransaction> {
    if (config.provingServerUrl) {
      return makeDefaultProvingService({
        provingServerUrl: config.provingServerUrl,
      });
    } else {
      throw new Error(
        "Missing required configuration: 'provingServerUrl' must be set in config, or provide a custom provingService in init parameters.",
      );
    }
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
    const clock = await Promise.resolve(initParams.clock ? initParams.clock(initParams.configuration) : systemClock);
    return new WalletFacade(
      shielded,
      unshielded,
      dust,
      submissionService,
      pendingTransactionsService,
      provingService,
      initParams.configuration.txHistoryStorage,
      clock,
    );
  }

  readonly shielded: ShieldedWalletAPI;
  readonly unshielded: UnshieldedWalletAPI;
  readonly dust: DustWalletAPI;
  readonly submissionService: SubmissionService<ledger.FinalizedTransaction>;
  readonly pendingTransactionsService: PendingTransactionsService<ledger.FinalizedTransaction>;
  readonly provingService: ProvingService<UnboundTransaction>;
  #txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>;
  readonly clock: Clock;
  #pendingSubscription: Subscription;

  private constructor(
    shieldedWallet: ShieldedWalletAPI,
    unshieldedWallet: UnshieldedWalletAPI,
    dustWallet: DustWalletAPI,
    submissionService: SubmissionService<ledger.FinalizedTransaction>,
    pendingTransactionsService: PendingTransactionsService<ledger.FinalizedTransaction>,
    provingService: ProvingService<UnboundTransaction>,
    txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>,
    clock: Clock = systemClock,
  ) {
    this.shielded = shieldedWallet;
    this.unshielded = unshieldedWallet;
    this.dust = dustWallet;
    this.submissionService = submissionService;
    this.pendingTransactionsService = pendingTransactionsService;
    this.provingService = provingService;
    this.#txHistoryStorage = txHistoryStorage;
    this.clock = clock;
    this.#pendingSubscription = this.pendingTransactionsService
      .state()
      .pipe(
        concatMap((pending) => PendingTransactions.allFailed(pending)),
        concatMap((item) => this.revert(item.tx)),
      )
      .subscribe();
  }

  private defaultTtl(): Date {
    return new Date(this.clock.now().getTime() + DEFAULT_TTL_MS);
  }

  private mergeUnprovenTransactions(
    a: ledger.UnprovenTransaction | undefined,
    b: ledger.UnprovenTransaction | undefined,
  ): ledger.UnprovenTransaction | undefined {
    if (a && b) return a.merge(b);
    return a ?? b;
  }

  private async createDustActionTransaction(
    action: { type: 'registration'; dustReceiverAddress: DustAddress } | { type: 'deregistration' },
    nightUtxos: readonly UtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    signDustRegistration: (payload: Uint8Array) => Promise<ledger.Signature> | ledger.Signature,
  ): Promise<ledger.UnprovenTransaction> {
    const ttl = this.defaultTtl();

    const transaction = await this.dust.createDustGenerationTransaction(
      undefined,
      ttl,
      nightUtxos.map(({ utxo, meta }) => ({
        ...utxo,
        ctime: meta.ctime,
        registeredForDustGeneration: meta.registeredForDustGeneration,
      })),
      nightVerifyingKey,
      action.type === 'registration' ? action.dustReceiverAddress : undefined,
    );

    const intent = transaction.intents?.get(1);
    if (!intent) {
      throw Error('Dust generation transaction is missing intent segment 1.');
    }

    const signatureData = intent.signatureData(1);
    const signature = await Promise.resolve(signDustRegistration(signatureData));

    return await this.dust.addDustGenerationSignature(transaction, signature);
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
          new FacadeState(shieldedState, unshieldedState, dustState, pending),
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

    return new FacadeState(shieldedState, unshieldedState, dustState, pending);
  }

  async submitTransaction(tx: ledger.FinalizedTransaction): Promise<TransactionIdentifier> {
    const identifiers = tx.identifiers();
    try {
      await this.pendingTransactionsService.addPendingTransaction(tx);
      // Insert before awaiting submission so the entry exists while the tx is in flight — the per-wallet sync
      // handlers' gotFinalized call clears the pending entry on confirmation.
      const key = submitTxHistoryKey(tx);
      if (key !== undefined) {
        await this.#txHistoryStorage.gotPending({ ...key, submittedAt: this.clock.now() });
      }
      await this.submissionService.submitTransaction(tx, 'Finalized');

      return identifiers.at(-1)!;
    } catch (error) {
      await this.revert(tx);
      throw error;
    }
  }

  async balanceFinalizedTransaction(
    tx: ledger.FinalizedTransaction,
    secretKeys: {
      shieldedSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      tokenKindsToBalance?: TokenKindsToBalance;
    },
  ): Promise<FinalizedTransactionRecipe> {
    const { shieldedSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, tokenKindsToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenKindsToBalance);

    // Step 1: Run unshielded and shielded balancing
    const unshieldedBalancingTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceFinalizedTransaction(tx)
      : undefined;

    const shieldedBalancingTx = shouldBalanceShielded
      ? await this.shielded.balanceTransaction(shieldedSecretKeys, tx)
      : undefined;

    // Step 2: Merge unshielded and shielded balancing
    const mergedBalancingTx = this.mergeUnprovenTransactions(shieldedBalancingTx, unshieldedBalancingTx);

    // Step 3: Conditionally add dust/fee balancing
    const feeBalancingTx = shouldBalanceDust
      ? await this.dust.balanceTransactions(dustSecretKey, mergedBalancingTx ? [tx, mergedBalancingTx] : [tx], ttl)
      : undefined;

    // Step 4: Merge fee balancing and create final recipe
    const balancingTx = this.mergeUnprovenTransactions(mergedBalancingTx, feeBalancingTx);

    if (!balancingTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    return {
      type: 'FINALIZED_TRANSACTION',
      originalTransaction: tx,
      balancingTransaction: balancingTx,
    };
  }

  async balanceUnboundTransaction(
    tx: UnboundTransaction,
    secretKeys: {
      shieldedSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      tokenKindsToBalance?: TokenKindsToBalance;
    },
  ): Promise<UnboundTransactionRecipe> {
    const { shieldedSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, tokenKindsToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenKindsToBalance);

    // Step 1: Run unshielded and shielded balancing
    const shieldedBalancingTx = shouldBalanceShielded
      ? await this.shielded.balanceTransaction(shieldedSecretKeys, tx)
      : undefined;

    // For unbound transactions, unshielded balancing happens in place not with a balancing transaction
    const balancedUnshieldedTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceUnboundTransaction(tx)
      : undefined;

    // Step 2: Unbound unshielded tx are balanced in place, use it as base tx if present
    const baseTx = balancedUnshieldedTx ?? tx;

    // Step 3: Conditionally add dust/fee balancing
    const feeBalancingTransaction = shouldBalanceDust
      ? await this.dust.balanceTransactions(
          dustSecretKey,
          shieldedBalancingTx ? [baseTx, shieldedBalancingTx] : [baseTx],
          ttl,
        )
      : undefined;

    // Step 4: Create the final balancing transaction
    const balancingTransaction = this.mergeUnprovenTransactions(shieldedBalancingTx, feeBalancingTransaction);

    // if there is no balancingTransaction and there was no unshielded tx balancing (in place) throw an error.
    if (!balancingTransaction && !balancedUnshieldedTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    return {
      type: 'UNBOUND_TRANSACTION',
      baseTransaction: baseTx,
      balancingTransaction: balancingTransaction ?? undefined,
    };
  }

  async balanceUnprovenTransaction(
    tx: ledger.UnprovenTransaction,
    secretKeys: {
      shieldedSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      tokenKindsToBalance?: TokenKindsToBalance;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { shieldedSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, tokenKindsToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenKindsToBalance);

    // Step 1: Run unshielded and shielded balancing
    const shieldedBalancingTx = shouldBalanceShielded
      ? await this.shielded.balanceTransaction(shieldedSecretKeys, tx)
      : undefined;

    // For unproven transactions, unshielded balancing happens in place
    const balancedUnshieldedTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceUnprovenTransaction(tx)
      : undefined;

    // Step 2: Use the balanced unshielded tx if present, otherwise use the original tx
    const baseTx = balancedUnshieldedTx ?? tx;

    // Step 3: Merge shielded balancing into base tx if present
    const mergedTx = this.mergeUnprovenTransactions(baseTx, shieldedBalancingTx)!;

    // Step 4: Conditionally add dust/fee balancing
    const feeBalancingTx = shouldBalanceDust
      ? await this.dust.balanceTransactions(dustSecretKey, [mergedTx], ttl)
      : undefined;

    // Step 5: Merge fee balancing if present
    const balancedTx = this.mergeUnprovenTransactions(mergedTx, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: balancedTx,
    };
  }

  async finalizeRecipe(recipe: BalancingRecipe): Promise<ledger.FinalizedTransaction> {
    return Promise.resolve(recipe)
      .then(async (recipe) => {
        switch (recipe.type) {
          case 'FINALIZED_TRANSACTION': {
            const finalizedBalancing = await this.finalizeTransaction(recipe.balancingTransaction);
            return recipe.originalTransaction.merge(finalizedBalancing);
          }
          case 'UNBOUND_TRANSACTION': {
            const finalizedBalancingTx = recipe.balancingTransaction
              ? await this.finalizeTransaction(recipe.balancingTransaction)
              : undefined;
            const finalizedTransaction = recipe.baseTransaction.bind();
            return finalizedBalancingTx ? finalizedTransaction.merge(finalizedBalancingTx) : finalizedTransaction;
          }
          case 'UNPROVEN_TRANSACTION': {
            return await this.finalizeTransaction(recipe.transaction);
          }
        }
      })
      .then(async (finalizedTx) => {
        await this.pendingTransactionsService.addPendingTransaction(finalizedTx);
        return finalizedTx;
      });
  }

  async signRecipe(
    recipe: BalancingRecipe,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<BalancingRecipe> {
    switch (recipe.type) {
      case 'FINALIZED_TRANSACTION': {
        const signedBalancingTx = await this.signUnprovenTransaction(recipe.balancingTransaction, signSegment);
        return {
          type: 'FINALIZED_TRANSACTION',
          originalTransaction: recipe.originalTransaction,
          balancingTransaction: signedBalancingTx,
        };
      }
      case 'UNBOUND_TRANSACTION': {
        const signedBalancingTx = recipe.balancingTransaction
          ? await this.signUnprovenTransaction(recipe.balancingTransaction, signSegment)
          : undefined;
        const signedBaseTx = await this.signUnboundTransaction(recipe.baseTransaction, signSegment);
        return {
          type: 'UNBOUND_TRANSACTION',
          baseTransaction: signedBaseTx,
          balancingTransaction: signedBalancingTx,
        };
      }
      case 'UNPROVEN_TRANSACTION': {
        const signedTx = await this.signUnprovenTransaction(recipe.transaction, signSegment);
        return {
          type: 'UNPROVEN_TRANSACTION',
          transaction: signedTx,
        };
      }
    }
  }

  async signUnprovenTransaction(
    tx: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<ledger.UnprovenTransaction> {
    return await this.unshielded.signUnprovenTransaction(tx, signSegment);
  }

  async signUnboundTransaction(
    tx: UnboundTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<UnboundTransaction> {
    return await this.unshielded.signUnboundTransaction(tx, signSegment);
  }

  async finalizeTransaction(tx: ledger.UnprovenTransaction): Promise<ledger.FinalizedTransaction> {
    try {
      const unboundTx = await this.provingService.prove(tx);
      const finalizedTx = unboundTx.bind();
      await this.pendingTransactionsService.addPendingTransaction(finalizedTx);
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
  async calculateTransactionFee(tx: AnyTransaction): Promise<bigint> {
    return await this.dust.calculateFee([tx]);
  }

  /** Calculates the total fee for the given transaction plus the fee of the balancing transaction. */
  async estimateTransactionFee(
    tx: AnyTransaction,
    secretKey: ledger.DustSecretKey,
    options?: {
      ttl?: Date;
      currentTime?: Date;
    },
  ): Promise<bigint> {
    const ttl = options?.ttl ?? this.defaultTtl();
    return await this.dust.estimateFee(secretKey, [tx], ttl, options?.currentTime);
  }

  async transferTransaction(
    outputs: CombinedTokenTransfer[],
    secretKeys: {
      shieldedSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      payFees?: boolean;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { shieldedSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, payFees = true } = options;

    const unshieldedOutputs = outputs
      .filter((output) => output.type === 'unshielded')
      .flatMap((output) => output.outputs);

    const shieldedOutputs = outputs.filter((output) => output.type === 'shielded').flatMap((output) => output.outputs);

    if (unshieldedOutputs.length === 0 && shieldedOutputs.length === 0) {
      throw Error('At least one shielded or unshielded output is required.');
    }

    const shieldedTx =
      shieldedOutputs.length > 0
        ? await this.shielded.transferTransaction(shieldedSecretKeys, shieldedOutputs)
        : undefined;

    const unshieldedTx =
      unshieldedOutputs.length > 0 ? await this.unshielded.transferTransaction(unshieldedOutputs, ttl) : undefined;

    const mergedTxs = this.mergeUnprovenTransactions(shieldedTx, unshieldedTx)!;

    // Add fee payment
    const feeBalancingTx = payFees ? await this.dust.balanceTransactions(dustSecretKey, [mergedTxs], ttl) : undefined;

    const finalTx = this.mergeUnprovenTransactions(mergedTxs, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: finalTx,
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
      (estimatedUtxos) => dustState.capabilities.coinsAndBalances.splitNightUtxos(estimatedUtxos),
      (split) => split.guaranteed,
    );
    const fakeSigningKey = ledger.sampleSigningKey();
    const fakeVerifyingKey = ledger.signatureVerifyingKey(fakeSigningKey);
    const fakeRegistrationRecipe = await this.registerNightUtxosForDustGeneration(
      nightUtxos,
      fakeVerifyingKey,
      (payload) => ledger.signData(fakeSigningKey, payload),
      dustState.address,
    );
    const finalizedFakeTx = fakeRegistrationRecipe.transaction.mockProve().bind();

    const fee = await this.calculateTransactionFee(finalizedFakeTx);

    return {
      fee,
      dustGenerationEstimations,
    };
  }

  async initSwap(
    desiredInputs: CombinedSwapInputs,
    desiredOutputs: CombinedSwapOutputs[],
    secretKeys: {
      shieldedSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      payFees?: boolean;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { shieldedSecretKeys, dustSecretKey } = secretKeys;
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
        ? await this.shielded.initSwap(shieldedSecretKeys, shieldedInputs, shieldedOutputs)
        : undefined;

    const unshieldedTx =
      hasUnshieldedPart && unshieldedInputs !== undefined
        ? await this.unshielded.initSwap(unshieldedInputs, unshieldedOutputs, ttl)
        : undefined;

    const combinedTx = this.mergeUnprovenTransactions(shieldedTx, unshieldedTx);

    if (!combinedTx) {
      throw Error('Unexpected transaction state.');
    }

    const feeBalancingTx = payFees ? await this.dust.balanceTransactions(dustSecretKey, [combinedTx], ttl) : undefined;

    const finalTx = this.mergeUnprovenTransactions(combinedTx, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: finalTx,
    };
  }

  async registerNightUtxosForDustGeneration(
    nightUtxos: readonly UtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    signDustRegistration: (payload: Uint8Array) => ledger.Signature,
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
      transaction: dustRegistrationTx,
    };
  }

  async deregisterFromDustGeneration(
    nightUtxos: UtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    signDustRegistration: (payload: Uint8Array) => ledger.Signature,
  ): Promise<UnprovenTransactionRecipe> {
    const dustDeregistrationTx = await this.createDustActionTransaction(
      { type: 'deregistration' },
      nightUtxos,
      nightVerifyingKey,
      signDustRegistration,
    );
    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: dustDeregistrationTx,
    };
  }

  async revert(txOrRecipe: AnyTransaction | BalancingRecipe): Promise<void> {
    // avoid instanceof check
    const transactionsToRevert = BalancingRecipe.isRecipe(txOrRecipe)
      ? BalancingRecipe.getTransactions(txOrRecipe)
      : [txOrRecipe];

    await Promise.all(transactionsToRevert.map((tx) => this.revertTransaction(tx)));
  }

  async revertTransaction(tx: AnyTransaction): Promise<void> {
    await Promise.all([
      this.shielded.revertTransaction(tx),
      this.unshielded.revertTransaction(tx),
      this.dust.revertTransaction(tx),
    ]).then(async () => {
      await this.pendingTransactionsService.clear(tx as unknown as ledger.FinalizedTransaction);
      const key = revertTxHistoryKey(tx);
      if (key !== undefined) {
        await this.#txHistoryStorage.gotRejected({ ...key, rejectedAt: this.clock.now() });
      }
    });
  }

  async start(shieldedSecretKeys: ledger.ZswapSecretKeys, dustSecretKey: ledger.DustSecretKey): Promise<void> {
    await Promise.all([
      this.shielded.start(shieldedSecretKeys),
      this.unshielded.start(),
      this.dust.start(dustSecretKey),
      this.pendingTransactionsService.start(),
    ]);
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.shielded.stop(),
      this.unshielded.stop(),
      this.dust.stop(),
      this.submissionService.close(),
      this.pendingTransactionsService.stop(),
      Promise.resolve(this.#pendingSubscription?.unsubscribe()),
    ]);
  }

  async queryTxHistoryByHash(
    hash: TransactionHistoryStorage.TransactionHash,
  ): Promise<FinalizedWalletEntry | undefined> {
    const raw = await this.#txHistoryStorage.get(hash);
    return raw && isFinalizedWalletEntry(raw) ? raw : undefined;
  }

  async getAllFromTxHistory(): Promise<WalletEntry[]> {
    const all = await this.#txHistoryStorage.getAll();
    return all.filter((entry): entry is WalletEntry => isFinalizedWalletEntry(entry) || isPendingWalletEntry(entry));
  }
}
