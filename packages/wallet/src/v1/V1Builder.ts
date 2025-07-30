import { CoreWallet, IndexerUpdate, NetworkId } from '@midnight-ntwrk/wallet';
import * as zswap from '@midnight-ntwrk/zswap';
import { Console, Effect, Either, Scope, Sink, Stream, Types } from 'effect';
import { WalletSeed, Expect, ItemType } from '@midnight-ntwrk/abstractions';
import { Variant, VariantBuilder, WalletRuntimeError } from '../abstractions/index';
import { DefaultProvingConfiguration, makeDefaultProvingService, ProvingService } from './Proving';
import { RunningV1Variant, V1State, V1Tag } from './RunningV1Variant';
import { makeDefaultV1SerializationCapability, SerializationCapability } from './Serialization';
import {
  DefaultSyncConfiguration,
  makeDefaultSyncCapability,
  makeDefaultSyncService,
  SyncCapability,
  SyncService,
} from './Sync';
import {
  DefaultTransactingConfiguration,
  DefaultTransactingContext,
  makeDefaultTransactingCapability,
  TransactingCapability,
} from './Transacting';
import { WalletError } from './WalletError';
import { CoinsAndBalancesCapability, makeDefaultCoinsAndBalancesCapability } from './CoinsAndBalances';
import { KeysCapability, makeDefaultKeysCapability } from './Keys';
import { DefaultSubmissionConfiguration, makeDefaultSubmissionService, SubmissionService } from './Submission';
import { CoinSelection, chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';

export type BaseV1Configuration = {
  networkId: zswap.NetworkId;
};

export type DefaultV1Configuration = BaseV1Configuration &
  DefaultSyncConfiguration &
  DefaultProvingConfiguration &
  DefaultTransactingConfiguration &
  DefaultSubmissionConfiguration;

const V1BuilderSymbol: {
  readonly typeId: unique symbol;
} = {
  typeId: Symbol('@midnight-ntwrk/wallet#V1Builder') as (typeof V1BuilderSymbol)['typeId'],
} as const;

export type DefaultV1Variant = V1Variant<string, IndexerUpdate, zswap.Transaction>;
export type V1Variant<TSerialized, TSyncUpdate, TTransaction> = Variant.Variant<
  typeof V1Tag,
  V1State,
  null,
  RunningV1Variant<TSerialized, TSyncUpdate, TTransaction>
> & {
  deserializeState: (keys: zswap.SecretKeys, serialized: TSerialized) => Either.Either<V1State, WalletError>;
  coinsAndBalances: CoinsAndBalancesCapability<V1State>;
  keys: KeysCapability<V1State>;
};

export class V1Builder<
  TConfig extends BaseV1Configuration = BaseV1Configuration,
  TContext extends Partial<RunningV1Variant.AnyContext> = object,
  TSerialized = never,
  TSyncUpdate = never,
  TTransaction = never,
> implements VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction>, TConfig>
{
  #buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction>;

  constructor(buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> = {}) {
    this.#buildState = buildState;
  }

  withDefaults(): V1Builder<
    DefaultV1Configuration,
    RunningV1Variant.Context<string, IndexerUpdate, zswap.Transaction>,
    string,
    IndexerUpdate,
    zswap.Transaction
  > {
    return this.withDefaultTransactionType()
      .withSyncDefaults()
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withSubmissionDefaults()
      .withProvingDefaults()
      .withCoinSelectionDefaults() as V1Builder<
      DefaultV1Configuration,
      RunningV1Variant.Context<string, IndexerUpdate, zswap.Transaction>,
      string,
      IndexerUpdate,
      zswap.Transaction
    >;
  }

  withTransactionType<Transaction>(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction> {
    return new V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction>({
      ...this.#buildState,
      provingService: undefined,
      transactingCapability: undefined,
      submissionService: undefined,
    });
  }

  withDefaultTransactionType(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, zswap.Transaction> {
    return this.withTransactionType<zswap.Transaction>();
  }

  withSyncDefaults(): V1Builder<
    TConfig & DefaultSyncConfiguration,
    TContext,
    TSerialized,
    IndexerUpdate,
    TTransaction
  > {
    return this.withSync(makeDefaultSyncService, makeDefaultSyncCapability);
  }

  withSync<TSyncConfig, TSyncContext extends Partial<RunningV1Variant.AnyContext>, TSyncUpdate>(
    syncService: (configuration: TSyncConfig, getContext: () => TSyncContext) => SyncService<V1State, TSyncUpdate>,
    syncCapability: (
      configuration: TSyncConfig,
      getContext: () => TSyncContext,
    ) => SyncCapability<V1State, TSyncUpdate>,
  ): V1Builder<TConfig & TSyncConfig, TContext & TSyncContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TSyncConfig, TContext & TSyncContext, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      syncService,
      syncCapability,
    });
  }

  withSerializationDefaults(): V1Builder<TConfig, TContext, string, TSyncUpdate, TTransaction> {
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
    ) => SerializationCapability<V1State, zswap.SecretKeys, TSerialized>,
  ): V1Builder<
    TConfig & TSerializationConfig,
    TContext & TSerializationContext,
    TSerialized,
    TSyncUpdate,
    TTransaction
  > {
    return new V1Builder<
      TConfig & TSerializationConfig,
      TContext & TSerializationContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      serializationCapability,
    });
  }

  withTransactingDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, zswap.Transaction>,
  ): V1Builder<
    TConfig & DefaultTransactingConfiguration,
    TContext & DefaultTransactingContext,
    TSerialized,
    TSyncUpdate,
    zswap.Transaction
  > {
    return this.withTransacting(makeDefaultTransactingCapability);
  }

  withTransacting<TTransactingConfig, TTransactingContext extends Partial<RunningV1Variant.AnyContext>>(
    transactingCapability: (
      config: TTransactingConfig,
      getContext: () => TTransactingContext,
    ) => TransactingCapability<V1State, TTransaction>,
  ): V1Builder<TConfig & TTransactingConfig, TContext & TTransactingContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<
      TConfig & TTransactingConfig,
      TContext & TTransactingContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      transactingCapability,
    });
  }

  withCoinSelection<TCoinSelectionConfig, TCoinSelectionContext extends Partial<RunningV1Variant.AnyContext>>(
    coinSelection: (config: TCoinSelectionConfig, getContext: () => TCoinSelectionContext) => CoinSelection,
  ): V1Builder<
    TConfig & TCoinSelectionConfig,
    TContext & TCoinSelectionContext,
    TSerialized,
    TSyncUpdate,
    TTransaction
  > {
    return new V1Builder<
      TConfig & TCoinSelectionConfig,
      TContext & TCoinSelectionContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      coinSelection,
    });
  }

  withCoinSelectionDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> {
    return this.withCoinSelection(() => chooseCoin);
  }

  withProving<TProvingConfig, TProvingContext extends Partial<RunningV1Variant.AnyContext>>(
    provingService: (config: TProvingConfig, getContext: () => TProvingContext) => ProvingService<TTransaction>,
  ): V1Builder<TConfig & TProvingConfig, TContext & TProvingContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TProvingConfig, TContext & TProvingContext, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      provingService,
    });
  }

  withProvingDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, zswap.Transaction>,
  ): V1Builder<TConfig & DefaultProvingConfiguration, TContext, TSerialized, TSyncUpdate, zswap.Transaction> {
    return this.withProving(makeDefaultProvingService);
  }

  withCoinsAndBalancesDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> {
    return this.withCoinsAndBalances(makeDefaultCoinsAndBalancesCapability);
  }

  withCoinsAndBalances<TBalancesConfig, TBalancesContext extends Partial<RunningV1Variant.AnyContext>>(
    coinsAndBalancesCapability: (
      configuration: TBalancesConfig,
      getContext: () => TBalancesContext,
    ) => CoinsAndBalancesCapability<V1State>,
  ): V1Builder<TConfig & TBalancesConfig, TContext & TBalancesContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<
      TConfig & TBalancesConfig,
      TContext & TBalancesContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      coinsAndBalancesCapability,
    });
  }

  withKeysDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> {
    return this.withKeys(makeDefaultKeysCapability);
  }

  withKeys<TKeysConfig, TKeysContext extends Partial<RunningV1Variant.AnyContext>>(
    keysCapability: (configuration: TKeysConfig, getContext: () => TKeysContext) => KeysCapability<V1State>,
  ): V1Builder<TConfig & TKeysConfig, TContext & TKeysContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TKeysConfig, TContext & TKeysContext, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      keysCapability,
    });
  }

  withSubmission<TSubmissionConfig, TSubmissionContext extends Partial<RunningV1Variant.AnyContext>>(
    submissionService: (
      config: TSubmissionConfig,
      getContext: () => TSubmissionContext,
    ) => SubmissionService<TTransaction>,
  ): V1Builder<TConfig & TSubmissionConfig, TContext & TSubmissionContext, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<
      TConfig & TSubmissionConfig,
      TContext & TSubmissionContext,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >({
      ...this.#buildState,
      submissionService,
    });
  }

  withSubmissionDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, zswap.Transaction>,
  ): V1Builder<TConfig & DefaultSubmissionConfiguration, TContext, TSerialized, TSyncUpdate, zswap.Transaction> {
    return this.withSubmission(makeDefaultSubmissionService);
  }

  build(
    this: V1Builder<
      TConfig,
      RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction>,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >,
    configuration: TConfig,
  ): V1Variant<TSerialized, TSyncUpdate, TTransaction> {
    const v1Context = this.#buildContextFromBuildState(configuration);
    const { networkId } = configuration;

    return {
      __polyTag__: V1Tag,
      coinsAndBalances: v1Context.coinsAndBalancesCapability,
      keys: v1Context.keysCapability,
      start(
        context: Variant.VariantContext<V1State>,
        initialState: V1State,
      ): Effect.Effect<RunningV1Variant<TSerialized, TSyncUpdate, TTransaction>, WalletRuntimeError, Scope.Scope> {
        return Effect.gen(function* () {
          yield* Effect.addFinalizer(() => v1Context.submissionService.close());
          const variantInstance = new RunningV1Variant(context, initialState, v1Context);
          yield* variantInstance
            .startSync(initialState)
            .pipe(Stream.tapError(Console.error), Stream.runScoped(Sink.drain), Effect.forkScoped);
          return variantInstance;
        });
      },
      migrateState() {
        const seed = WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001');

        return Effect.succeed(
          CoreWallet.emptyV1(new zswap.LocalState(), zswap.SecretKeys.fromSeed(seed), NetworkId.fromJs(networkId)),
        );
      },

      deserializeState: (keys: zswap.SecretKeys, serialized: TSerialized): Either.Either<V1State, WalletError> => {
        return v1Context.serializationCapability.deserialize(keys, serialized);
      },
    };
  }

  #buildContextFromBuildState(
    this: V1Builder<
      TConfig,
      RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction>,
      TSerialized,
      TSyncUpdate,
      TTransaction
    >,
    configuration: TConfig,
  ): RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction> {
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

    const getContext = (): RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction> => context;

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
  type HasSync<TConfig, TContext, TSyncUpdate> = {
    readonly syncService: (configuration: TConfig, getContext: () => TContext) => SyncService<V1State, TSyncUpdate>;
    readonly syncCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SyncCapability<V1State, TSyncUpdate>;
  };

  type HasTransacting<TConfig, TContext, TTransaction> = {
    readonly transactingCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactingCapability<V1State, TTransaction>;
  };

  type HasCoinSelection<TConfig, TContext> = {
    readonly coinSelection: (configuration: TConfig, getContext: () => TContext) => CoinSelection;
  };

  type HasSerialization<TConfig, TContext, TSerialized> = {
    readonly serializationCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => SerializationCapability<V1State, zswap.SecretKeys, TSerialized>;
  };

  type HasProving<TConfig, TContext, TTransaction> = {
    readonly provingService: (configuration: TConfig, getContext: () => TContext) => ProvingService<TTransaction>;
  };

  type HasCoinsAndBalances<TConfig, TContext> = {
    readonly coinsAndBalancesCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => CoinsAndBalancesCapability<V1State>;
  };

  type HasKeys<TConfig, TContext> = {
    readonly keysCapability: (configuration: TConfig, getContext: () => TContext) => KeysCapability<V1State>;
  };

  type HasSubmission<TConfig, TContext, TTransaction> = {
    readonly submissionService: (configuration: TConfig, getContext: () => TContext) => SubmissionService<TTransaction>;
  };

  /**
   * The internal build state of {@link V1Builder}.
   */
  type FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> = Types.Simplify<
    HasSync<TConfig, TContext, TSyncUpdate> &
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
  > = {
    [K in keyof FullBuildState<never, never, never, never, never>]?:
      | FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction>[K]
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

const isBuildStateFull = <TConfig, TContext, TSerialized, TSyncUpdate, TTransaction>(
  buildState: V1Builder.PartialBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction>,
): buildState is V1Builder.FullBuildState<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction> => {
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
    Types.Equals<keyof V1Builder.FullBuildState<never, never, never, never, never>, ItemType<typeof allBuildStateKeys>>
  >;
  return allBuildStateKeys.every((key) => typeof buildState[key] == 'function');
};

/** @internal */
declare namespace _V1BuilderMethods {
  type WithSyncDefaults = 'withSyncDefaults';
  type WithSyncMethod = 'withSync';
  type WithTransactingMethod = 'withTransacting';
  type WithSerializationMethod = 'withSerialization';
  type WithSerializationDefaults = 'withSerializationDefaults';
  type WithCoinsAndBalancesDefaults = 'withCoinsAndBalancesDefaults';
  type WithKeysDefaults = 'withKeysDefaults';
  type AllSyncMethods = WithSyncDefaults | WithSyncMethod;
  type AllTransactingMethods = WithTransactingMethod;
  type AllSerializationMethods = WithSerializationMethod | WithSerializationDefaults;
  type AllProvingMethods = 'withProving' | 'withProvingDefaults';
  type AllSubmissionMethods = 'withSubmission' | 'withSubmissionDefaults';
  type AllCoinsAndBalancesMethods = WithCoinsAndBalancesDefaults;
  type AllKeysMethods = WithKeysDefaults;
  type AllMethods =
    | AllSyncMethods
    | AllTransactingMethods
    | AllSerializationMethods
    | AllProvingMethods
    | AllSubmissionMethods
    | AllCoinsAndBalancesMethods
    | AllKeysMethods;
}
