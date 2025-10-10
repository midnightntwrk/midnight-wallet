import { Effect, Scope, Types, Either } from 'effect';
import { Expect, ItemType } from '@midnight-ntwrk/wallet-sdk-utilities/types';
import { DustSecretKey, FinalizedTransaction } from '@midnight-ntwrk/ledger-v6';
import { WalletRuntimeError, VariantBuilder, Variant } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { Proving, WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import {
  SyncService,
  SyncCapability,
  DefaultSyncConfiguration,
  makeDefaultSyncCapability,
  makeDefaultSyncService,
  WalletSyncUpdate,
} from './Sync.js';
import { RunningV1Variant, V1Tag } from './RunningV1Variant.js';
import { DustCoreWallet } from './DustCoreWallet.js';
import { KeysCapability, makeDefaultKeysCapability } from './Keys.js';
import {
  chooseCoin,
  CoinsAndBalancesCapability,
  CoinSelection,
  makeDefaultCoinsAndBalancesCapability,
} from './CoinsAndBalances.js';
import {
  DefaultTransactingConfiguration,
  DefaultTransactingContext,
  makeDefaultTransactingCapability,
  TransactingCapability,
} from './Transacting.js';
import { NetworkId } from './types/ledger.js';
import { DefaultSubmissionConfiguration, makeDefaultSubmissionService, SubmissionService } from './Submission.js';
import { DustToken } from './types/Dust.js';
import { makeDefaultV1SerializationCapability, SerializationCapability } from './Serialization.js';

export type BaseV1Configuration = {
  networkId: NetworkId;
};

export type DefaultV1Configuration = BaseV1Configuration;

const V1BuilderSymbol: {
  readonly typeId: unique symbol;
} = {
  typeId: Symbol('@midnight-ntwrk/dustWallet#V1Builder') as (typeof V1BuilderSymbol)['typeId'],
} as const;

export type DefaultV1Variant = V1Variant<string, WalletSyncUpdate, FinalizedTransaction, DustSecretKey>;

export type V1Variant<TSerialized, TSyncUpdate, TTransaction, TAuxData> = Variant.Variant<
  typeof V1Tag,
  DustCoreWallet,
  DustCoreWallet, // null,
  RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TAuxData>
> & {
  deserializeState: (serialized: TSerialized) => Either.Either<DustCoreWallet, WalletError.WalletError>;
  coinsAndBalances: CoinsAndBalancesCapability<DustCoreWallet>;
  keys: KeysCapability<DustCoreWallet>;
  serialization: SerializationCapability<DustCoreWallet, null, TSerialized>;
};

export type DefaultV1Builder = V1Builder<
  DefaultV1Configuration,
  RunningV1Variant.Context<string, WalletSyncUpdate, FinalizedTransaction, DustSecretKey>,
  string,
  WalletSyncUpdate,
  FinalizedTransaction
>;

export class V1Builder<
  TConfig extends BaseV1Configuration = BaseV1Configuration,
  TContext extends Partial<RunningV1Variant.AnyContext> = object,
  TSerialized = never,
  TSyncUpdate = never,
  TTransaction = never,
  TStartAux extends object = object,
> implements VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>
{
  #buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux>;

  constructor(
    buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> = {},
  ) {
    this.#buildState = buildState;
  }

  withDefaults(): DefaultV1Builder {
    return this.withDefaultTransactionType()
      .withSyncDefaults()
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withSubmissionDefaults()
      .withProvingDefaults()
      .withCoinSelectionDefaults() as DefaultV1Builder;
  }

  withTransactionType<Transaction>(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction, TStartAux> {
    return new V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction, TStartAux>({
      ...this.#buildState,
      provingService: undefined,
      transactingCapability: undefined,
      submissionService: undefined,
    });
  }

  withDefaultTransactionType(): V1Builder<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    FinalizedTransaction,
    TStartAux
  > {
    return this.withTransactionType<FinalizedTransaction>();
  }

  withSyncDefaults(): V1Builder<
    TConfig & DefaultSyncConfiguration,
    TContext,
    TSerialized,
    WalletSyncUpdate,
    TTransaction,
    DustSecretKey
  > {
    return this.withSync(makeDefaultSyncService, makeDefaultSyncCapability);
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
    ) => SyncService<DustCoreWallet, TStartAux, TSyncUpdate>,
    syncCapability: (
      configuration: TSyncConfig,
      getContext: () => TSyncContext,
    ) => SyncCapability<DustCoreWallet, TSyncUpdate>,
  ): V1Builder<TConfig & TSyncConfig, TContext & TSyncContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> {
    return new V1Builder<
      TConfig & TSyncConfig,
      TContext & TSyncContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      syncService,
      syncCapability,
    });
  }

  withSerializationDefaults(): V1Builder<TConfig, TContext, string, TSyncUpdate, TTransaction, TStartAux> {
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
    ) => SerializationCapability<DustCoreWallet, null, TSerialized>,
  ): V1Builder<
    TConfig & TSerializationConfig,
    TContext & TSerializationContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux
  > {
    return new V1Builder<
      TConfig & TSerializationConfig,
      TContext & TSerializationContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      serializationCapability,
    });
  }

  withTransactingDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, FinalizedTransaction, TStartAux>,
  ): V1Builder<
    TConfig & DefaultTransactingConfiguration,
    TContext & DefaultTransactingContext,
    TSerialized,
    TSyncUpdate,
    FinalizedTransaction,
    TStartAux
  > {
    return this.withTransacting(makeDefaultTransactingCapability);
  }

  withTransacting<TTransactingConfig, TTransactingContext extends Partial<RunningV1Variant.AnyContext>>(
    transactingCapability: (
      config: TTransactingConfig,
      getContext: () => TTransactingContext,
    ) => TransactingCapability<DustSecretKey, DustCoreWallet, TTransaction>,
  ): V1Builder<
    TConfig & TTransactingConfig,
    TContext & TTransactingContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux
  > {
    return new V1Builder<
      TConfig & TTransactingConfig,
      TContext & TTransactingContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      transactingCapability,
    });
  }

  withCoinSelection<TCoinSelectionConfig, TCoinSelectionContext extends Partial<RunningV1Variant.AnyContext>>(
    coinSelection: (config: TCoinSelectionConfig, getContext: () => TCoinSelectionContext) => CoinSelection<DustToken>,
  ): V1Builder<
    TConfig & TCoinSelectionConfig,
    TContext & TCoinSelectionContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux
  > {
    return new V1Builder<
      TConfig & TCoinSelectionConfig,
      TContext & TCoinSelectionContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      coinSelection,
    });
  }

  withCoinSelectionDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> {
    return this.withCoinSelection(() => chooseCoin);
  }

  withProving<TProvingConfig, TProvingContext extends Partial<RunningV1Variant.AnyContext>>(
    provingService: (config: TProvingConfig, getContext: () => TProvingContext) => Proving.ProvingService<TTransaction>,
  ): V1Builder<
    TConfig & TProvingConfig,
    TContext & TProvingContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux
  > {
    return new V1Builder<
      TConfig & TProvingConfig,
      TContext & TProvingContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      provingService,
    });
  }

  withProvingDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, FinalizedTransaction, TStartAux>,
  ): V1Builder<
    TConfig & Proving.DefaultProvingConfiguration,
    TContext,
    TSerialized,
    TSyncUpdate,
    FinalizedTransaction,
    TStartAux
  > {
    return this.withProving(Proving.makeDefaultProvingService);
  }

  withCoinsAndBalancesDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> {
    return this.withCoinsAndBalances(makeDefaultCoinsAndBalancesCapability);
  }

  withCoinsAndBalances<TBalancesConfig, TBalancesContext extends Partial<RunningV1Variant.AnyContext>>(
    coinsAndBalancesCapability: (
      configuration: TBalancesConfig,
      getContext: () => TBalancesContext,
    ) => CoinsAndBalancesCapability<DustCoreWallet>,
  ): V1Builder<
    TConfig & TBalancesConfig,
    TContext & TBalancesContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux
  > {
    return new V1Builder<
      TConfig & TBalancesConfig,
      TContext & TBalancesContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      coinsAndBalancesCapability,
    });
  }

  withKeysDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> {
    return this.withKeys(makeDefaultKeysCapability);
  }

  withKeys<TKeysConfig, TKeysContext extends Partial<RunningV1Variant.AnyContext>>(
    keysCapability: (configuration: TKeysConfig, getContext: () => TKeysContext) => KeysCapability<DustCoreWallet>,
  ): V1Builder<TConfig & TKeysConfig, TContext & TKeysContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> {
    return new V1Builder<
      TConfig & TKeysConfig,
      TContext & TKeysContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      keysCapability,
    });
  }

  withSubmission<TSubmissionConfig, TSubmissionContext extends Partial<RunningV1Variant.AnyContext>>(
    submissionService: (
      config: TSubmissionConfig,
      getContext: () => TSubmissionContext,
    ) => SubmissionService<TTransaction>,
  ): V1Builder<
    TConfig & TSubmissionConfig,
    TContext & TSubmissionContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux
  > {
    return new V1Builder<
      TConfig & TSubmissionConfig,
      TContext & TSubmissionContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      submissionService,
    });
  }

  withSubmissionDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, FinalizedTransaction, TStartAux>,
  ): V1Builder<
    TConfig & DefaultSubmissionConfiguration,
    TContext,
    TSerialized,
    TSyncUpdate,
    FinalizedTransaction,
    TStartAux
  > {
    return this.withSubmission(makeDefaultSubmissionService);
  }

  build(
    this: V1Builder<
      TConfig,
      RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >,
    configuration: TConfig,
  ): V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux> {
    const v1Context = this.#buildContextFromBuildState(configuration);
    return {
      __polyTag__: V1Tag,
      coinsAndBalances: v1Context.coinsAndBalancesCapability,
      keys: v1Context.keysCapability,
      serialization: v1Context.serializationCapability,
      start(
        context: Variant.VariantContext<DustCoreWallet>,
      ): Effect.Effect<
        RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
        WalletRuntimeError,
        Scope.Scope
      > {
        return Effect.gen(function* () {
          yield* Effect.addFinalizer(() => v1Context.submissionService.close());
          const scope = yield* Scope.Scope;
          return new RunningV1Variant(scope, context, v1Context);
        });
      },
      migrateState(prevState) {
        // TODO: re-implement
        return Effect.succeed(prevState);
      },
      deserializeState: (serialized: TSerialized): Either.Either<DustCoreWallet, WalletError.WalletError> => {
        return v1Context.serializationCapability.deserialize(null, serialized);
      },
    };
  }

  #buildContextFromBuildState(
    this: V1Builder<
      TConfig,
      RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
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
      provingService,
      coinSelection,
      coinsAndBalancesCapability,
      keysCapability,
      submissionService,
    } = this.#buildState;

    const getContext = (): RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux> => context;

    const context = {
      serializationCapability: serializationCapability(configuration, getContext),
      syncCapability: syncCapability(configuration, getContext),
      syncService: syncService(configuration, getContext),
      transactingCapability: transactingCapability(configuration, getContext),
      coinsAndBalancesCapability: coinsAndBalancesCapability(configuration, getContext),
      keysCapability: keysCapability(configuration, getContext),
      provingService: provingService(configuration, getContext),
      coinSelection: coinSelection(configuration, getContext),
      submissionService: submissionService(configuration, getContext),
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
    ) => SyncService<DustCoreWallet, TStartAux, TSyncUpdate>;
    readonly syncCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SyncCapability<DustCoreWallet, TSyncUpdate>;
  };

  type HasTransacting<TConfig, TContext, TTransaction> = {
    readonly transactingCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactingCapability<DustSecretKey, DustCoreWallet, TTransaction>;
  };

  type HasSerialization<TConfig, TContext, TSerialized> = {
    readonly serializationCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SerializationCapability<DustCoreWallet, null, TSerialized>;
  };

  type HasCoinSelection<TConfig, TContext> = {
    readonly coinSelection: (configuration: TConfig, getContext: () => TContext) => CoinSelection<DustToken>;
  };

  type HasProving<TConfig, TContext, TTransaction> = {
    readonly provingService: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => Proving.ProvingService<TTransaction>;
  };

  type HasCoinsAndBalances<TConfig, TContext> = {
    readonly coinsAndBalancesCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => CoinsAndBalancesCapability<DustCoreWallet>;
  };

  type HasKeys<TConfig, TContext> = {
    readonly keysCapability: (configuration: TConfig, getContext: () => TContext) => KeysCapability<DustCoreWallet>;
  };

  type HasSubmission<TConfig, TContext, TTransaction> = {
    readonly submissionService: (configuration: TConfig, getContext: () => TContext) => SubmissionService<TTransaction>;
  };

  /**
   * The internal build state of {@link V1Builder}.
   */
  type FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> = Types.Simplify<
    HasSync<TConfig, TContext, TSyncUpdate, TStartAux> &
      HasSerialization<TConfig, TContext, TSerialized> &
      HasTransacting<TConfig, TContext, TTransaction> &
      HasCoinSelection<TConfig, TContext> &
      HasProving<TConfig, TContext, TTransaction> &
      HasSubmission<TConfig, TContext, TTransaction> &
      HasCoinsAndBalances<TConfig, TContext> &
      HasKeys<TConfig, TContext>
  >;
  type PartialBuildState<
    TConfig = object,
    TContext = object,
    TSerialized = never,
    TSyncUpdate = never,
    TTransaction = never,
    TStartAux = object,
  > = {
    [K in keyof FullBuildState<never, never, never, never, never, never>]?:
      | FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux>[K]
      | undefined;
  };

  /**
   * Utility interface that manages the type variance of {@link V1Builder}.
   */
  interface Variance<R> {
    readonly [V1BuilderSymbol.typeId]: {
      readonly _R: Types.Covariant<R>;
    };
  }
}

const isBuildStateFull = <TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux>(
  buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux>,
): buildState is V1Builder.FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> => {
  const allBuildStateKeys = [
    'syncService',
    'syncCapability',
    'transactingCapability',
    'coinSelection',
    'serializationCapability',
    'provingService',
    'coinsAndBalancesCapability',
    'keysCapability',
    'submissionService',
  ] as const;
  /**
   * This type will fail compilation if any key is omitted, letting the `isFull` check work properly
   */
  type _1 = Expect<
    Types.Equals<
      keyof V1Builder.FullBuildState<never, never, never, never, never, never>,
      ItemType<typeof allBuildStateKeys>
    >
  >;
  return allBuildStateKeys.every((key) => typeof buildState[key] == 'function');
};
