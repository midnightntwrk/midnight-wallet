import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Effect, Either, Scope, Types } from 'effect';
import { WalletSeed, NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Variant, VariantBuilder, WalletRuntimeError } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { DefaultProvingConfiguration, makeDefaultProvingService, ProvingService } from './Proving';
import { RunningV1Variant, V1Tag } from './RunningV1Variant';
import { makeDefaultV1SerializationCapability, SerializationCapability } from './Serialization';
import {
  DefaultSyncContext,
  DefaultSyncConfiguration,
  SyncCapability,
  SyncService,
  WalletSyncUpdate,
  makeEventsSyncService,
  makeEventsSyncCapability,
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
import { CoreWallet, PublicKeys } from './CoreWallet';
import { makeDefaultTransactionHistoryCapability, TransactionHistoryCapability } from './TransactionHistory';
import { Expect, Equal, ItemType } from '@midnight-ntwrk/wallet-sdk-utilities/types';

export type BaseV1Configuration = {
  networkId: NetworkId.NetworkId;
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

export type V1Variant<TSerialized, TSyncUpdate, TTransaction, TAuxData> = Variant.Variant<
  typeof V1Tag,
  CoreWallet,
  null,
  RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TAuxData>
> & {
  deserializeState: (serialized: TSerialized) => Either.Either<CoreWallet, WalletError>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
  serialization: SerializationCapability<CoreWallet, null, TSerialized>;
  transactionHistory: TransactionHistoryCapability<CoreWallet, TTransaction>;
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

export type DefaultV1Builder = V1Builder<
  DefaultV1Configuration,
  RunningV1Variant.Context<string, WalletSyncUpdate, ledger.FinalizedTransaction, ledger.ZswapSecretKeys>,
  string,
  WalletSyncUpdate,
  ledger.FinalizedTransaction,
  ledger.ZswapSecretKeys
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
  readonly #buildState: V1Builder.PartialBuildState<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux
  >;

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
      .withTransactionHistoryDefaults()
      .withKeysDefaults()
      .withProvingDefaults()
      .withSubmissionDefaults()
      .withCoinSelectionDefaults() as DefaultV1Builder;
  }

  withTransactionType<Transaction>(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction, TStartAux> {
    return new V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, Transaction, TStartAux>({
      ...this.#buildState,
      provingService: undefined,
      transactingCapability: undefined,
      submissionService: undefined,
      transactionHistoryCapability: undefined,
    });
  }

  withDefaultTransactionType(): V1Builder<
    TConfig,
    TContext,
    TSerialized,
    TSyncUpdate,
    ledger.FinalizedTransaction,
    TStartAux
  > {
    return this.withTransactionType<ledger.FinalizedTransaction>();
  }

  withSyncDefaults(): V1Builder<
    TConfig & DefaultSyncConfiguration,
    TContext & DefaultSyncContext,
    TSerialized,
    WalletSyncUpdate,
    TTransaction,
    ledger.ZswapSecretKeys
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
    ) => SyncCapability<CoreWallet, TSyncUpdate>,
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
    ) => SerializationCapability<CoreWallet, null, TSerialized>,
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
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, ledger.FinalizedTransaction, TStartAux>,
  ): V1Builder<
    TConfig & DefaultTransactingConfiguration,
    TContext & DefaultTransactingContext,
    TSerialized,
    TSyncUpdate,
    ledger.FinalizedTransaction,
    TStartAux
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
    provingService: (config: TProvingConfig, getContext: () => TProvingContext) => ProvingService<TTransaction>,
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
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, ledger.FinalizedTransaction, TStartAux>,
  ): V1Builder<
    TConfig & DefaultProvingConfiguration,
    TContext,
    TSerialized,
    TSyncUpdate,
    ledger.FinalizedTransaction,
    TStartAux
  > {
    return this.withProving(makeDefaultProvingService);
  }

  withCoinsAndBalancesDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> {
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

  withTransactionHistoryDefaults(
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, ledger.FinalizedTransaction, TStartAux>,
  ): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, ledger.FinalizedTransaction, TStartAux> {
    return this.withTransactionHistory(makeDefaultTransactionHistoryCapability);
  }

  withTransactionHistory<
    TTransactionHistoryConfig,
    TTransactionHistoryContext extends Partial<RunningV1Variant.AnyContext>,
  >(
    transactionHistoryCapability: (
      configuration: TTransactionHistoryConfig,
      getContext: () => TTransactionHistoryContext,
    ) => TransactionHistoryCapability<CoreWallet, TTransaction>,
  ): V1Builder<
    TConfig & TTransactionHistoryConfig,
    TContext & TTransactionHistoryContext,
    TSerialized,
    TSyncUpdate,
    TTransaction,
    TStartAux
  > {
    return new V1Builder<
      TConfig & TTransactionHistoryConfig,
      TContext & TTransactionHistoryContext,
      TSerialized,
      TSyncUpdate,
      TTransaction,
      TStartAux
    >({
      ...this.#buildState,
      transactionHistoryCapability,
    });
  }

  withKeysDefaults(): V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, TTransaction, TStartAux> {
    return this.withKeys(makeDefaultKeysCapability);
  }

  withKeys<TKeysConfig, TKeysContext extends Partial<RunningV1Variant.AnyContext>>(
    keysCapability: (configuration: TKeysConfig, getContext: () => TKeysContext) => KeysCapability<CoreWallet>,
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
    this: V1Builder<TConfig, TContext, TSerialized, TSyncUpdate, ledger.FinalizedTransaction, TStartAux>,
  ): V1Builder<
    TConfig & DefaultSubmissionConfiguration,
    TContext,
    TSerialized,
    TSyncUpdate,
    ledger.FinalizedTransaction,
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
    const { networkId } = configuration;

    return {
      __polyTag__: V1Tag,
      coinsAndBalances: v1Context.coinsAndBalancesCapability,
      keys: v1Context.keysCapability,
      serialization: v1Context.serializationCapability,
      transactionHistory: v1Context.transactionHistoryCapability,
      start(
        context: Variant.VariantContext<CoreWallet>,
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
      migrateState(_previousState) {
        const seed = WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001');

        return Effect.succeed(
          CoreWallet.empty(PublicKeys.fromSecretKeys(ledger.ZswapSecretKeys.fromSeed(seed)), networkId),
        );
      },

      deserializeState: (serialized: TSerialized): Either.Either<CoreWallet, WalletError> => {
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
      transactionHistoryCapability,
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
      transactionHistoryCapability: transactionHistoryCapability(configuration, getContext),
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
    ) => SyncCapability<CoreWallet, TSyncUpdate>;
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

  type HasProving<TConfig, TContext, TTransaction> = {
    readonly provingService: (configuration: TConfig, getContext: () => TContext) => ProvingService<TTransaction>;
  };

  type HasCoinsAndBalances<TConfig, TContext> = {
    readonly coinsAndBalancesCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => CoinsAndBalancesCapability<CoreWallet>;
  };

  type HasTransactionHistory<TConfig, TContext, TTransaction> = {
    readonly transactionHistoryCapability: (
      configuration: TConfig,
      getContext: () => TContext,
    ) => TransactionHistoryCapability<CoreWallet, TTransaction>;
  };

  type HasKeys<TConfig, TContext> = {
    readonly keysCapability: (configuration: TConfig, getContext: () => TContext) => KeysCapability<CoreWallet>;
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
      HasKeys<TConfig, TContext> &
      HasTransactionHistory<TConfig, TContext, TTransaction>
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
    'transactionHistoryCapability',
  ] as const;
  /**
   * This type will fail compilation if any key is omitted, letting the `isFull` check work properly
   */
  type _1 = Expect<
    Equal<keyof V1Builder.FullBuildState<never, never, never, never, never, never>, ItemType<typeof allBuildStateKeys>>
  >;
  return allBuildStateKeys.every((key) => typeof buildState[key] == 'function');
};

/** @internal */
declare namespace _V1BuilderMethods {
  type WithSyncDefaults = 'withSyncDefaults';
  type WithSyncMethod = 'withSync';
  type WithTransactingMethod = 'withTransacting';
  type WithTransactingDefaults = 'withTransactingDefaults';
  type WithSerializationMethod = 'withSerialization';
  type WithSerializationDefaults = 'withSerializationDefaults';
  type WithCoinsAndBalancesDefaults = 'withCoinsAndBalancesDefaults';
  type WithKeysDefaults = 'withKeysDefaults';
  type WithTransactionHistoryDefaults = 'withTransactionHistoryDefaults';
  type AllSyncMethods = WithSyncDefaults | WithSyncMethod;
  type AllTransactingMethods = WithTransactingMethod | WithTransactingDefaults;
  type AllSerializationMethods = WithSerializationMethod | WithSerializationDefaults;
  type AllProvingMethods = 'withProving' | 'withProvingDefaults';
  type AllSubmissionMethods = 'withSubmission' | 'withSubmissionDefaults';
  type AllCoinsAndBalancesMethods = 'withCoinsAndBalancesDefaults';
  type AllKeysMethods = 'withKeysDefaults';
  type AllTransactionHistoryMethods = 'withTransactionHistoryDefaults';
  type AllMethods =
    | AllSyncMethods
    | AllTransactingMethods
    | AllSerializationMethods
    | AllProvingMethods
    | AllSubmissionMethods
    | AllCoinsAndBalancesMethods
    | AllKeysMethods
    | AllTransactionHistoryMethods;
}
