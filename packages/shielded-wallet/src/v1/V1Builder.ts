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
import { Effect, type Either, Scope, type Types } from 'effect';
import { type NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type Variant,
  type VariantBuilder,
  WalletRuntimeError,
  type StartMaterial,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type EmptyWalletMigrationConfiguration, type StateMigration, makeEmptyWalletMigration } from './Migration.js';
import { RunningV1Variant, V1Tag } from './RunningV1Variant.js';
import { makeDefaultV1SerializationCapability, type SerializationCapability } from './Serialization.js';
import {
  type DefaultSyncContext,
  type DefaultSyncConfiguration,
  type ChangesResult,
  type SyncCapability,
  type SyncService,
  type WalletSyncUpdate,
  makeEventsSyncService,
  makeEventsSyncCapability,
} from './Sync.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
  type TransactingCapability,
} from './Transacting.js';
import { type WalletError } from './WalletError.js';
import { type CoinsAndBalancesCapability, makeDefaultCoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { type KeysCapability, makeDefaultKeysCapability } from './Keys.js';
import { type CoinSelection, chooseCoin } from '@midnightntwrk/wallet-sdk-capabilities';
import { type CoreWallet } from './CoreWallet.js';
import {
  type DefaultTransactionHistoryConfiguration,
  makeDefaultTransactionHistoryService,
  type TransactionHistoryService,
} from './TransactionHistory.js';
import { type Expect, type Equal, type ItemType } from '@midnightntwrk/wallet-sdk-utilities/types';

export type BaseV1Configuration = {
  networkId: NetworkId.NetworkId;
};

export type DefaultV1Configuration = BaseV1Configuration &
  DefaultSyncConfiguration &
  DefaultTransactingConfiguration &
  DefaultTransactionHistoryConfiguration;

const V1BuilderSymbol: {
  readonly typeId: unique symbol;
} = {
  typeId: Symbol('@midnight-ntwrk/wallet#V1Builder') as (typeof V1BuilderSymbol)['typeId'],
} as const;

export type V1Variant<TSerialized, TSyncUpdate, TTransaction, TAuxData, TPreviousState = null> = Variant.Variant<
  typeof V1Tag,
  CoreWallet,
  TPreviousState,
  RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TAuxData>
> & {
  deserializeState: (serialized: TSerialized) => Either.Either<CoreWallet, WalletError>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
  serialization: SerializationCapability<CoreWallet, null, TSerialized>;
  transactionHistory: TransactionHistoryService;
  startAux: StartMaterial.StartAuxCapability<TAuxData>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyV1Variant = V1Variant<any, any, any, any>;
export type DefaultV1Variant = V1Variant<string, WalletSyncUpdate, ledger.FinalizedTransaction, ledger.ZswapSecretKeys>;

export type TransactionOf<T extends AnyV1Variant> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends V1Variant<any, any, infer TTransaction, any> ? TTransaction : never;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuxDataOf<T extends AnyV1Variant> = T extends V1Variant<any, any, any, infer TAuxData> ? TAuxData : never;
export type SerializedStateOf<T extends AnyV1Variant> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends V1Variant<infer TSerialized, any, any, any> ? TSerialized : never;

export type DefaultV1Builder<TPreviousState = null> = V1Builder<
  DefaultV1Configuration,
  RunningV1Variant.Context<string, WalletSyncUpdate, ledger.FinalizedTransaction, ledger.ZswapSecretKeys>,
  string,
  WalletSyncUpdate,
  ledger.FinalizedTransaction,
  ledger.ZswapSecretKeys,
  TPreviousState
>;

export class V1Builder<
  TConfig extends BaseV1Configuration = BaseV1Configuration,
  TContext extends Partial<RunningV1Variant.AnyContext> = object,
  TSerialized = never,
  TSyncUpdate = never,
  TTransaction = never,
  TStartAux extends object = object,
  TPreviousState = null,
> implements VariantBuilder.VariantBuilder<
  V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux, TPreviousState>,
  TConfig
> {
  readonly #buildState: V1Builder.PartialBuildState<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  >;

  constructor(
    buildState: V1Builder.PartialBuildState<
      TConfig,
      TContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    > = {},
  ) {
    this.#buildState = buildState;
  }

  withDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux, null>,
  ): DefaultV1Builder {
    return (
      this.withDefaultTransactionType()
        .withSyncDefaults()
        .withSerializationDefaults()
        .withTransactingDefaults()
        .withCoinsAndBalancesDefaults()
        .withTransactionHistoryDefaults()
        .withKeysDefaults()
        .withStartAuxDefaults()
        // Type cast required because: the chain accumulates `TContext` as an intersection of the individual
        // `Default*Context` fragments, which is a structurally weaker type than the complete
        // `RunningV1Variant.Context` that `DefaultV1Builder` names — the defaults do produce a full context, but the
        // chain's type cannot express that. Routing through `unknown` because the added `migration` key put the two
        // sides past what TypeScript will accept as directly comparable; the widening itself predates it.
        .withCoinSelectionDefaults() as unknown as DefaultV1Builder
    );
  }

  withTransactionType<Transaction>(): V1Builder<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    Transaction,
    TStartAux,
    TPreviousState
  > {
    return new V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction, TStartAux, TPreviousState>({
      ...this.#buildState,
      transactingCapability: undefined,
      transactionHistoryService: undefined,
    });
  }

  withDefaultTransactionType(): V1Builder<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    ledger.FinalizedTransaction,
    TStartAux,
    TPreviousState
  > {
    return this.withTransactionType<ledger.FinalizedTransaction>();
  }

  withSyncDefaults(): V1Builder<
    TConfig & DefaultSyncConfiguration,
    TContext & DefaultSyncContext,
    TSerialized,
    WalletSyncUpdate,
    TTransaction,
    ledger.ZswapSecretKeys,
    TPreviousState
  > {
    return this.withSync(makeEventsSyncService, makeEventsSyncCapability);
  }

  withSync<
    TSyncConfig,
    TSyncContext extends Partial<RunningV1Variant.AnyContext>,
    TSyncUpdate,
    TStartAux extends object,
  >(
    syncService: (
      configuration: TSyncConfig,
      getContext: () => TSyncContext,
    ) => SyncService<CoreWallet, TStartAux, TSyncUpdate>,
    syncCapability: (
      configuration: TSyncConfig,
      getContext: () => TSyncContext,
    ) => SyncCapability<CoreWallet, TSyncUpdate, ChangesResult>,
  ): V1Builder<
    TConfig & TSyncConfig,
    TContext & TSyncContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return new V1Builder<
      TConfig & TSyncConfig,
      TContext & TSyncContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >({
      ...this.#buildState,
      syncService,
      syncCapability,
      // The derivation is typed against the *old* start-aux parameter, so it cannot ride along into a builder whose
      // sync service expects something else — exactly as the migration cannot ride along through `withMigration`.
      startAux: undefined,
    });
  }

  withSerializationDefaults(): V1Builder<
    TConfig,
    TContext,
    string,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return this.withSerialization(makeDefaultV1SerializationCapability);
  }

  withSerialization<
    TSerializationConfig,
    TSerializationContext extends Partial<RunningV1Variant.AnyContext>,
    TSerialized,
  >(
    serializationCapability: (
      configuration: TSerializationConfig,
      getContext: () => TSerializationContext,
    ) => SerializationCapability<CoreWallet, null, TSerialized>,
  ): V1Builder<
    TConfig & TSerializationConfig,
    TContext & TSerializationContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return new V1Builder<
      TConfig & TSerializationConfig,
      TContext & TSerializationContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >({
      ...this.#buildState,
      serializationCapability,
    });
  }

  withTransactingDefaults(
    this: V1Builder<
      TConfig,
      TContext,
      TSerialized,
      TSyncUpdate,
      ledger.FinalizedTransaction,
      TStartAux,
      TPreviousState
    >,
  ): V1Builder<
    TConfig & DefaultTransactingConfiguration,
    TContext & DefaultTransactingContext,
    TSerialized,
    TSyncUpdate,
    ledger.FinalizedTransaction,
    TStartAux,
    TPreviousState
  > {
    return this.withTransacting(makeDefaultTransactingCapability);
  }

  withTransacting<TTransactingConfig, TTransactingContext extends Partial<RunningV1Variant.AnyContext>>(
    transactingCapability: (
      config: TTransactingConfig,
      getContext: () => TTransactingContext,
    ) => TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, TTransaction>,
  ): V1Builder<
    TConfig & TTransactingConfig,
    TContext & TTransactingContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return new V1Builder<
      TConfig & TTransactingConfig,
      TContext & TTransactingContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >({
      ...this.#buildState,
      transactingCapability,
    });
  }

  withCoinSelection<TCoinSelectionConfig, TCoinSelectionContext extends Partial<RunningV1Variant.AnyContext>>(
    coinSelection: (
      config: TCoinSelectionConfig,
      getContext: () => TCoinSelectionContext,
    ) => CoinSelection<ledger.QualifiedShieldedCoinInfo>,
  ): V1Builder<
    TConfig & TCoinSelectionConfig,
    TContext & TCoinSelectionContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return new V1Builder<
      TConfig & TCoinSelectionConfig,
      TContext & TCoinSelectionContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >({
      ...this.#buildState,
      coinSelection,
    });
  }

  withCoinSelectionDefaults(): V1Builder<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return this.withCoinSelection(() => chooseCoin);
  }

  withCoinsAndBalancesDefaults(): V1Builder<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return this.withCoinsAndBalances(makeDefaultCoinsAndBalancesCapability);
  }

  withCoinsAndBalances<TBalancesConfig, TBalancesContext extends Partial<RunningV1Variant.AnyContext>>(
    coinsAndBalancesCapability: (
      configuration: TBalancesConfig,
      getContext: () => TBalancesContext,
    ) => CoinsAndBalancesCapability<CoreWallet>,
  ): V1Builder<
    TConfig & TBalancesConfig,
    TContext & TBalancesContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return new V1Builder<
      TConfig & TBalancesConfig,
      TContext & TBalancesContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >({
      ...this.#buildState,
      coinsAndBalancesCapability,
    });
  }

  withTransactionHistoryDefaults(
    this: V1Builder<
      TConfig,
      TContext,
      TSerialized,
      TSyncUpdate,
      ledger.FinalizedTransaction,
      TStartAux,
      TPreviousState
    >,
  ): V1Builder<
    TConfig & DefaultTransactionHistoryConfiguration,
    TContext,
    TSerialized,
    TSyncUpdate,
    ledger.FinalizedTransaction,
    TStartAux,
    TPreviousState
  > {
    return this.withTransactionHistory(makeDefaultTransactionHistoryService);
  }

  withTransactionHistory<
    TTransactionHistoryConfig,
    TTransactionHistoryContext extends Partial<RunningV1Variant.AnyContext>,
  >(
    transactionHistoryService: (
      configuration: TTransactionHistoryConfig,
      getContext: () => TTransactionHistoryContext,
    ) => TransactionHistoryService,
  ): V1Builder<
    TConfig & TTransactionHistoryConfig,
    TContext & TTransactionHistoryContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return new V1Builder<
      TConfig & TTransactionHistoryConfig,
      TContext & TTransactionHistoryContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >({
      ...this.#buildState,
      transactionHistoryService,
    });
  }

  withKeysDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux, TPreviousState> {
    return this.withKeys(makeDefaultKeysCapability);
  }

  /**
   * Uses the default start-aux derivation: this ledger version's Zswap secret keys, derived from the seed.
   *
   * @remarks
   *   The seed is the only key material that crosses a protocol boundary, so every variant must be able to produce its
   *   own from one. This is that derivation for this ledger version; a builder whose sync service expects something
   *   else supplies its own with {@link V1Builder.withStartAux}.
   */
  withStartAuxDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, ledger.ZswapSecretKeys, TPreviousState>,
  ): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, ledger.ZswapSecretKeys, TPreviousState> {
    return this.withStartAux({ fromSeed: (seed) => ledger.ZswapSecretKeys.fromSeed(seed) });
  }

  /**
   * Chooses how this variant derives the key material its synchronization is started with from a seed.
   *
   * @param startAux The derivation.
   * @returns A builder that produces a variant able to start sync from a seed alone.
   */
  withStartAux(
    startAux: StartMaterial.StartAuxCapability<TStartAux>,
  ): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux, TPreviousState> {
    return new V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux, TPreviousState>({
      ...this.#buildState,
      startAux,
    });
  }

  /**
   * Uses the default migration: an empty wallet built from nothing.
   *
   * @remarks
   *   This is what an unconfigured builder already does, so calling it changes no behaviour — it states the choice rather
   *   than inheriting it. Registering this variant as the target of a real fork means calling
   *   {@link V1Builder.withMigration} with {@link makeCrossLedgerMigration} instead.
   */
  withMigrationDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux, null>,
  ): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux, null> {
    return this.withMigration((configuration: EmptyWalletMigrationConfiguration) =>
      makeEmptyWalletMigration(configuration),
    );
  }

  /**
   * Chooses how this variant produces its first state from the state that preceded it.
   *
   * @remarks
   *   The strategy's input type becomes the variant's `TPreviousState`, which is what the runtime type-checks a
   *   registration against: a variant declaring it migrates from a ledger-v8 wallet cannot be registered after one that
   *   produces something else.
   * @example
   *   ```typescript
   *   const forkTarget = new V1Builder().withDefaults().withMigration(makeCrossLedgerMigration);
   *   ```;
   *
   * @param migration Builds the migration from the configuration and the sibling capabilities.
   */
  withMigration<TMigrationConfig, TPrevious>(
    migration: (configuration: TMigrationConfig, getContext: () => TContext) => StateMigration<TPrevious>,
  ): V1Builder<TConfig & TMigrationConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux, TPrevious> {
    const capabilities: V1Builder.CapabilityBuildState<
      TConfig,
      TContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    > = this.#buildState;

    return new V1Builder<
      TConfig & TMigrationConfig,
      TContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPrevious
    >({
      // Only the capability half crosses: the strategy being replaced is typed against the *old* previous-state
      // parameter, so it cannot ride along even though it is about to be overwritten.
      ...capabilities,
      migration,
    });
  }

  withKeys<TKeysConfig, TKeysContext extends Partial<RunningV1Variant.AnyContext>>(
    keysCapability: (configuration: TKeysConfig, getContext: () => TKeysContext) => KeysCapability<CoreWallet>,
  ): V1Builder<
    TConfig & TKeysConfig,
    TContext & TKeysContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  > {
    return new V1Builder<
      TConfig & TKeysConfig,
      TContext & TKeysContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >({
      ...this.#buildState,
      keysCapability,
    });
  }

  build(
    this: V1Builder<
      TConfig,
      RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >,
    configuration: TConfig,
  ): V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux, TPreviousState> {
    const v1Context = this.#buildContextFromBuildState(configuration);
    const migration = this.#resolveMigration(configuration, () => v1Context);

    return {
      __polyTag__: V1Tag,
      coinsAndBalances: v1Context.coinsAndBalancesCapability,
      keys: v1Context.keysCapability,
      serialization: v1Context.serializationCapability,
      transactionHistory: v1Context.transactionHistoryService,
      startAux: this.#resolveStartAux(),
      start(
        context: Variant.VariantContext<CoreWallet>,
      ): Effect.Effect<
        RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
        WalletRuntimeError,
        Scope.Scope
      > {
        return Effect.gen(function* () {
          const scope = yield* Scope.Scope;
          return new RunningV1Variant(scope, context, v1Context);
        });
      },
      // An unconfigured builder keeps producing an empty wallet, which is what `startEmpty` has always relied on.
      // Anything else — carrying state within a ledger version, or projecting it across one — is the injected
      // strategy's business, and its failures are reported on the runtime's state stream rather than thrown.
      migrateState: (previousState: TPreviousState) =>
        migration.migrate(previousState).pipe(
          Effect.mapError(
            (error) =>
              new WalletRuntimeError({
                message: 'Failed to migrate shielded wallet state into this variant',
                cause: error,
              }),
          ),
        ),

      deserializeState: (serialized: TSerialized): Either.Either<CoreWallet, WalletError> => {
        return v1Context.serializationCapability.deserialize(null, serialized);
      },
    };
  }

  /**
   * Resolves the configured migration, or the empty-wallet fallback when none was configured.
   *
   * @remarks
   *   The fallback is written as a nullary function on purpose. It ignores whatever preceded it — it builds an empty
   *   wallet from nothing — which makes it a valid migration from _any_ previous state, but a `StateMigration<null>`
   *   value could only be widened to `StateMigration<TPreviousState>` through a cast. Declaring no parameter says the
   *   same thing to the type system without one.
   */
  /**
   * Resolves the configured start-aux derivation.
   *
   * @remarks
   *   Unlike the migration there is no sensible fallback: the default derivation produces this ledger version's secret
   *   keys, which is only correct for a builder that kept a sync service expecting them. A builder that replaced sync
   *   and did not say how to derive its own key material is misconfigured, and is told so at build time rather than
   *   silently handed key objects of the wrong shape at the first migration.
   */
  #resolveStartAux(): StartMaterial.StartAuxCapability<TStartAux> {
    const configured = this.#buildState.startAux;
    if (configured === undefined) {
      throw new Error('Not all components are configured in V1 Builder: startAux');
    }
    return configured;
  }

  #resolveMigration(configuration: TConfig, getContext: () => TContext): StateMigration<TPreviousState> {
    const configured = this.#buildState.migration;
    return configured === undefined
      ? { migrate: () => makeEmptyWalletMigration(configuration).migrate(null) }
      : configured(configuration, getContext);
  }

  #buildContextFromBuildState(
    this: V1Builder<
      TConfig,
      RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux,
      TPreviousState
    >,
    configuration: TConfig,
  ): RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux> {
    if (!isBuildStateFull(this.#buildState)) {
      throw new Error('Not all components are configured in V1 Builder');
    }

    const {
      syncCapability,
      syncService,
      transactingCapability,
      serializationCapability,
      coinSelection,
      coinsAndBalancesCapability,
      keysCapability,
      transactionHistoryService,
    } = this.#buildState;

    const getContext = (): RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux> => context;

    const context = {
      serializationCapability: serializationCapability(configuration, getContext),
      syncCapability: syncCapability(configuration, getContext),
      syncService: syncService(configuration, getContext),
      transactingCapability: transactingCapability(configuration, getContext),
      coinsAndBalancesCapability: coinsAndBalancesCapability(configuration, getContext),
      keysCapability: keysCapability(configuration, getContext),
      coinSelection: coinSelection(configuration, getContext),
      transactionHistoryService: transactionHistoryService(configuration, getContext),
    };

    return context;
  }
}

/** @internal */
declare namespace V1Builder {
  type HasSync<TConfig, TContext, TSyncUpdate, TStartAux> = {
    readonly syncService: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SyncService<CoreWallet, TStartAux, TSyncUpdate>;
    readonly syncCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SyncCapability<CoreWallet, TSyncUpdate, ChangesResult>;
  };

  type HasTransacting<TConfig, TContext, TTransaction> = {
    readonly transactingCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, TTransaction>;
  };

  type HasCoinSelection<TConfig, TContext> = {
    readonly coinSelection: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => CoinSelection<ledger.QualifiedShieldedCoinInfo>;
  };

  type HasSerialization<TConfig, TContext, TSerialized> = {
    readonly serializationCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SerializationCapability<CoreWallet, null, TSerialized>;
  };

  type HasCoinsAndBalances<TConfig, TContext> = {
    readonly coinsAndBalancesCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => CoinsAndBalancesCapability<CoreWallet>;
  };

  type HasTransactionHistory<TConfig, TContext> = {
    readonly transactionHistoryService: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactionHistoryService;
  };

  type HasKeys<TConfig, TContext> = {
    readonly keysCapability: (configuration: TConfig, getContext: () => TContext) => KeysCapability<CoreWallet>;
  };

  /** The internal build state of {@link V1Builder}. */
  type FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> = Types.Simplify<
    HasSync<TConfig, TContext, TSyncUpdate, TStartAux> &
      HasSerialization<TConfig, TContext, TSerialized> &
      HasTransacting<TConfig, TContext, TTransaction> &
      HasCoinSelection<TConfig, TContext> &
      HasCoinsAndBalances<TConfig, TContext> &
      HasKeys<TConfig, TContext> &
      HasTransactionHistory<TConfig, TContext>
  >;
  /**
   * The migration entry, kept out of {@link FullBuildState} on purpose: absent means "empty wallet", which is the
   * behaviour every builder had before migrations were configurable, so a builder that never mentions migration must
   * still be considered complete.
   */
  /**
   * The start-aux entry, kept out of {@link FullBuildState} because it is not one of the context-producing capabilities:
   * it takes neither configuration nor sibling capabilities, only a seed.
   */
  type HasStartAux<TStartAux> = {
    readonly startAux: StartMaterial.StartAuxCapability<TStartAux>;
  };

  type HasMigration<TConfig, TContext, TPreviousState> = {
    readonly migration: (configuration: TConfig, getContext: () => TContext) => StateMigration<TPreviousState>;
  };

  /** The capability half of the build state — everything that does not depend on the previous-state parameter. */
  type CapabilityBuildState<
    TConfig = object,
    TContext = object,
    TSerialized = never,
    TSyncUpdate = never,
    TTransaction = never,
    TStartAux = object,
  > = {
    [K in keyof FullBuildState<never, never, never, never, never, never>]?:
      FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux>[K] | undefined;
  };

  type PartialBuildState<
    TConfig = object,
    TContext = object,
    TSerialized = never,
    TSyncUpdate = never,
    TTransaction = never,
    TStartAux = object,
    TPreviousState = null,
  > = {
    [
      K in keyof (FullBuildState<never, never, never, never, never, never> &
        HasMigration<never, never, never> &
        HasStartAux<never>)
    ]?:
      | (FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> &
          HasMigration<TConfig, TContext, TPreviousState> &
          HasStartAux<TStartAux>)[K]
      | undefined;
  };

  /** Utility interface that manages the type variance of {@link V1Builder}. */
  interface Variance<R> {
    readonly [V1BuilderSymbol.typeId]: {
      readonly _R: Types.Covariant<R>;
    };
  }
}

const isBuildStateFull = <TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux, TPreviousState>(
  buildState: V1Builder.PartialBuildState<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux,
    TPreviousState
  >,
): buildState is V1Builder.FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> => {
  const allBuildStateKeys = [
    'syncService',
    'syncCapability',
    'transactingCapability',
    'coinSelection',
    'serializationCapability',
    'coinsAndBalancesCapability',
    'keysCapability',
    'transactionHistoryService',
  ] as const;
  /** This type will fail compilation if any key is omitted, letting the `isFull` check work properly */
  type _1 = Expect<
    Equal<keyof V1Builder.FullBuildState<never, never, never, never, never, never>, ItemType<typeof allBuildStateKeys>>
  >;
  return allBuildStateKeys.every((key) => typeof buildState[key] == 'function');
};
