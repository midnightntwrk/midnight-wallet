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
} from '@midnightntwrk/wallet-sdk-capabilities';
import {
  type DefaultProvingConfiguration,
  makeDefaultProvingService,
  type ProvingService,
  type UnboundTransaction,
} from '@midnightntwrk/wallet-sdk-capabilities/proving';
import {
  type DefaultDustConfiguration,
  type DustWalletAPI,
  type DustWalletState,
} from '@midnightntwrk/wallet-sdk-dust-wallet';
import {
  type AnyTransaction,
  type CoinsAndBalances as DustCoinsAndBalances,
} from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import {
  type DefaultShieldedConfiguration,
  type ShieldedWalletAPI,
  type ShieldedWalletState,
  ShieldedSectionSchema,
  mergeShieldedSections,
} from '@midnightntwrk/wallet-sdk-shielded';
import type { DefaultUnshieldedConfiguration, UnshieldedWalletAPI } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import {
  type UnshieldedWalletState,
  UnshieldedSectionSchema,
  mergeUnshieldedSections,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustSectionSchema, mergeDustSections } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { FetchTermsAndConditions as FetchTermsAndConditionsQuery } from '@midnightntwrk/wallet-sdk-indexer-client';
import { QueryRunner } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { Array as Arr, pipe, Schema } from 'effect';
import { TransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { combineLatest, map, type Observable, firstValueFrom, type Subscription, concatMap } from 'rxjs';
import {
  type DefaultPendingTransactionsServiceConfiguration,
  PendingTransactions,
  type PendingTransactionsService,
  PendingTransactionsServiceImpl,
} from '@midnightntwrk/wallet-sdk-capabilities';
import {
  type BlockData,
  type BlockDataFetcher,
  makeDefaultBlockDataFetcher,
  makeDefaultValidationService,
  type ValidateTxOptions,
  ValidationFetchError,
  type ValidationService,
  WellFormedError,
  type WellFormedStrictnessFlags,
} from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { finalizedTransactionTrait, txHistoryHash } from './transaction.js';
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
 * Storage key for a tx we're about to submit (record as pending). The hash comes from {@link txHistoryHash}, which the
 * revert side uses too — so a tx keyed here while pending resolves to the same key when later confirmed or reverted.
 */
const submitTxHistoryKey = (
  tx: ledger.FinalizedTransaction,
): { readonly hash: string; readonly identifiers: readonly string[] } => ({
  hash: txHistoryHash(tx),
  identifiers: tx.identifiers(),
});

/**
 * Storage key for a tx we're about to revert (record as rejected). Shares {@link txHistoryHash} with the submit side so
 * the rejected entry lands on the pending entry in place. Returns `undefined` only when the tx has no identifiers at
 * all (nothing to revert).
 */
const revertTxHistoryKey = (
  tx: AnyTransaction,
): { readonly hash: string; readonly identifiers: readonly string[] } | undefined => {
  const identifiers = tx.identifiers();
  if (identifiers.length === 0) return undefined;
  return { hash: txHistoryHash(tx), identifiers };
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
  blockData?: BlockData;
};

export type UnboundTransactionRecipe = {
  type: 'UNBOUND_TRANSACTION';
  baseTransaction: UnboundTransaction;
  // balancingTransaction is optional because if the user decides to balance only the unshielded part,
  // it occurs "in place" so the baseTransaction is modified
  balancingTransaction?: ledger.UnprovenTransaction | undefined;
  blockData?: BlockData;
};

export type UnprovenTransactionRecipe = {
  type: 'UNPROVEN_TRANSACTION';
  transaction: ledger.UnprovenTransaction;
  blockData?: BlockData;
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
  submissionService?: (config: TConfig) => MaybePromise<SubmissionService<ledger.FinalizedTransaction>>;
  pendingTransactionsService?: (
    config: TConfig,
  ) => MaybePromise<PendingTransactionsService<ledger.FinalizedTransaction>>;
  provingService?: (config: TConfig) => MaybePromise<ProvingService<UnboundTransaction>>;
  /**
   * Optional factory for the block-data fetcher used by validation. Defaults to an HTTP indexer-backed fetcher built
   * from `configuration.indexerClientConnection`. Override for simulator-based tests with
   * `makeSimulatorBlockDataFetcher(simulator)` from `@midnightntwrk/wallet-sdk-capabilities/validation`.
   */
  fetchBlockData?: (config: TConfig) => MaybePromise<BlockDataFetcher>;
  validationService?: (
    config: TConfig,
    deps: { fetchBlockData: BlockDataFetcher; clock: Clock.Clock },
  ) => MaybePromise<ValidationService>;
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
  type ValidationService,
  ValidationFetchError,
  WellFormedError,
  type WellFormedStrictnessFlags,
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
   * - `submissionService` - needs to implement {@link SubmissionService} for a {@link ledger.FinalizedTransaction} to
   *   submit transactions to the network, default uses Node RPC connection
   * - `pendingTransactionsService` - needs to implement {@link PendingTransactionsService} for a
   *   {@link ledger.FinalizedTransaction} to keep track of pending transactions, default uses in-memory implementation
   * - `provingService` - needs to implement {@link ProvingService} to prove it, default uses proving server
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
        : makeDefaultValidationService({
            fetchBlockData,
            networkId: initParams.configuration.networkId,
            clock,
          }),
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
      clock,
    );
  }

  readonly shielded: ShieldedWalletAPI;
  readonly unshielded: UnshieldedWalletAPI;
  readonly dust: DustWalletAPI;
  readonly submissionService: SubmissionService<ledger.FinalizedTransaction>;
  readonly pendingTransactionsService: PendingTransactionsService<ledger.FinalizedTransaction>;
  readonly provingService: ProvingService<UnboundTransaction>;
  readonly validationService: ValidationService;
  #txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>;
  readonly clock: Clock.Clock;
  #pendingSubscription: Subscription;

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
    submissionService: SubmissionService<ledger.FinalizedTransaction>,
    pendingTransactionsService: PendingTransactionsService<ledger.FinalizedTransaction>,
    provingService: ProvingService<UnboundTransaction>,
    validationService: ValidationService,
    txHistoryStorage: TransactionHistoryStorage.TransactionHistoryStorage<WalletEntry>,
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
  async validateTransaction(
    tx: ledger.FinalizedTransaction | UnboundTransaction | ledger.UnprovenTransaction,
    options: ValidateTxOptions,
  ): Promise<void> {
    return this.validationService.validateTx(tx, options);
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
    signDustRegistration: (payload: Uint8Array) => ledger.Signature,
  ): Promise<ledger.UnprovenTransaction> {
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
    let txWithDustActions: ledger.UnprovenTransaction;
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
        { type: 'UNPROVEN_TRANSACTION', transaction: txWithDustActions },
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
  async submitTransaction(tx: ledger.FinalizedTransaction): Promise<TransactionIdentifier> {
    const identifiers = tx.identifiers();
    try {
      await this.pendingTransactionsService.addPendingTransaction(tx);
      // Insert before awaiting submission so the entry exists while the tx is in flight — the per-wallet sync
      // handlers' gotFinalized call clears the pending entry on confirmation.
      const key = submitTxHistoryKey(tx);
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
    const dustResult = shouldBalanceDust
      ? await this.dust.balanceTransactions(dustSecretKey, mergedBalancingTx ? [tx, mergedBalancingTx] : [tx], ttl)
      : undefined;
    const feeBalancingTx = dustResult?.transaction;

    // Step 4: Merge fee balancing and create final recipe
    const balancingTx = this.mergeUnprovenTransactions(mergedBalancingTx, feeBalancingTx);

    if (!balancingTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    return {
      type: 'FINALIZED_TRANSACTION',
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
    const dustResult = shouldBalanceDust
      ? await this.dust.balanceTransactions(
          dustSecretKey,
          shieldedBalancingTx ? [baseTx, shieldedBalancingTx] : [baseTx],
          ttl,
        )
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
    const dustResult = shouldBalanceDust
      ? await this.dust.balanceTransactions(dustSecretKey, [mergedTx], ttl)
      : undefined;
    const feeBalancingTx = dustResult?.transaction;

    // Step 5: Merge fee balancing if present
    const balancedTx = this.mergeUnprovenTransactions(mergedTx, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: balancedTx,
      ...(dustResult ? { blockData: dustResult.blockData } : {}),
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
        const withDustSig = await this.#signDustRegistrationIfPresent(signedBalancingTx, signSegment);
        return {
          type: 'FINALIZED_TRANSACTION',
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
          transaction: withDustSig,
          ...(recipe.blockData ? { blockData: recipe.blockData } : {}),
        };
      }
    }
  }

  async #signDustRegistrationIfPresent(
    tx: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<ledger.UnprovenTransaction> {
    const intent = tx.intents?.get(1);
    const registrations = intent?.dustActions?.registrations ?? [];
    if (!intent || registrations.length === 0) {
      return tx;
    }
    const signature = signSegment(intent.signatureData(1));
    return await this.dust.addDustRegistrationSignature(tx, signature);
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
    const dustResult = payFees ? await this.dust.balanceTransactions(dustSecretKey, [mergedTxs], ttl) : undefined;
    const feeBalancingTx = dustResult?.transaction;

    const finalTx = this.mergeUnprovenTransactions(mergedTxs, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
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
      (estimatedUtxos) => dustState.capabilities.coinsAndBalances.splitNightUtxos(estimatedUtxos),
      (split) => split.guaranteed,
    );
    const fakeSigningKey = ledger.sampleSigningKey();
    const fakeVerifyingKey = ledger.signatureVerifyingKey(fakeSigningKey);

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
    const intent = fakeUnsignedTx.intents?.get(1);
    if (!intent) {
      throw Error('Dust generation transaction is missing intent segment 1.');
    }
    const signatureData = intent.signatureData(1);
    const signature = ledger.signData(fakeSigningKey, signatureData);
    const fakeSignedTx = await this.dust.addDustGenerationSignature(fakeUnsignedTx, signature);

    const finalizedFakeTx = fakeSignedTx.mockProve().bind();

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

    const dustResult = payFees ? await this.dust.balanceTransactions(dustSecretKey, [combinedTx], ttl) : undefined;
    const feeBalancingTx = dustResult?.transaction;

    const finalTx = this.mergeUnprovenTransactions(combinedTx, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: finalTx,
      ...(dustResult ? { blockData: dustResult.blockData } : {}),
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

  /**
   * Starts the wallets and their background synchronization.
   *
   * @param shieldedSecretKeys - Secret keys for the shielded wallet
   * @param dustSecretKey - Secret key for the dust wallet
   * @param manualSync - When true, the dust wallet is not started in the background; drive it explicitly with
   *   {@link doSync} instead (requires a dust wallet built with the projections sync service, see
   *   `makeEventLessSyncService` in `@midnightntwrk/wallet-sdk-dust-fast-sync`)
   */
  async start(
    shieldedSecretKeys: ledger.ZswapSecretKeys,
    dustSecretKey: ledger.DustSecretKey,
    manualSync: boolean = false,
  ): Promise<void> {
    await Promise.all([
      this.shielded.start(shieldedSecretKeys),
      this.unshielded.start(),
      !manualSync ? this.dust.start(dustSecretKey) : undefined,
      this.pendingTransactionsService.start(),
    ]);
  }

  /**
   * Runs a single dust synchronization pass and resolves when it completes. Only the dust wallet supports manual sync;
   * the shielded and unshielded wallets keep syncing in the background via {@link start}.
   *
   * @param dustSecretKey - Secret key for the dust wallet
   */
  async doSync(dustSecretKey: ledger.DustSecretKey): Promise<void> {
    await this.dust.stepSync(dustSecretKey);
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

  async queryTxHistoryByHash(hash: TransactionHistoryStorage.TransactionHash): Promise<WalletEntry | undefined> {
    return this.#txHistoryStorage.get(hash);
  }

  async getAllFromTxHistory(): Promise<WalletEntry[]> {
    const all = await this.#txHistoryStorage.getAll();
    return [...all];
  }
}
