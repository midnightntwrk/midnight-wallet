import { CoreWallet, IndexerUpdate, NetworkId } from '@midnight-ntwrk/wallet';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Either, Scope, Sink, Stream, Types } from 'effect';
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
import { makeDefaultTransactingCapability, TransactingCapability } from './Transacting';
import { WalletError } from './WalletError';
import { CoinsAndBalancesCapability, makeDefaultCoinsAndBalancesCapability } from './CoinsAndBalances';
import { KeysCapability, makeDefaultKeysCapability } from './Keys';

export type BaseV1Configuration = {
  networkId: zswap.NetworkId;
};

export type DefaultV1Configuration = BaseV1Configuration & DefaultSyncConfiguration & DefaultProvingConfiguration;

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
  TSerialized = never,
  TSyncUpdate = never,
  TTransaction = never,
> implements VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction>, TConfig>
{
  #buildState: V1Builder.PartialBuildState<TConfig, TSerialized, TSyncUpdate, TTransaction>;

  constructor(buildState: V1Builder.PartialBuildState<TConfig, TSerialized, TSyncUpdate, TTransaction> = {}) {
    this.#buildState = buildState;
  }

  withDefaults(): V1Builder<DefaultV1Configuration, string, IndexerUpdate, zswap.Transaction> {
    return this.withDefaultTransactionType()
      .withSyncDefaults()
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withProvingDefaults() as V1Builder<DefaultV1Configuration, string, IndexerUpdate, zswap.Transaction>;
  }

  withTransactionType<Transaction>(): V1Builder<TConfig, TSerialized, TSyncUpdate, Transaction> {
    return new V1Builder<TConfig, TSerialized, TSyncUpdate, Transaction>({
      ...this.#buildState,
      provingService: undefined,
      transactingCapability: undefined,
    });
  }

  withDefaultTransactionType(): V1Builder<TConfig, TSerialized, TSyncUpdate, zswap.Transaction> {
    return this.withTransactionType<zswap.Transaction>();
  }

  withSyncDefaults(): V1Builder<TConfig & DefaultSyncConfiguration, TSerialized, IndexerUpdate, TTransaction> {
    return this.withSync(makeDefaultSyncService, makeDefaultSyncCapability);
  }

  withSync<TSyncConfig, TSyncUpdate>(
    syncService: (configuration: TSyncConfig) => SyncService<V1State, TSyncUpdate>,
    syncCapability: (configuration: TSyncConfig) => SyncCapability<V1State, TSyncUpdate>,
  ): V1Builder<TConfig & TSyncConfig, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TSyncConfig, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      syncService,
      syncCapability,
    });
  }

  withSerializationDefaults(): V1Builder<TConfig, string, TSyncUpdate, TTransaction> {
    return this.withSerialization(makeDefaultV1SerializationCapability);
  }

  withSerialization<TSerializationConfig, TSerialized>(
    serializationCapability: (
      configuration: TSerializationConfig,
    ) => SerializationCapability<V1State, zswap.SecretKeys, TSerialized>,
  ): V1Builder<TConfig & TSerializationConfig, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TSerializationConfig, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      serializationCapability,
    });
  }

  withTransactingDefaults(
    this: V1Builder<TConfig, TSerialized, TSyncUpdate, zswap.Transaction>,
  ): V1Builder<TConfig, TSerialized, TSyncUpdate, zswap.Transaction> {
    return this.withTransacting(makeDefaultTransactingCapability);
  }

  withTransacting<TTransactingConfig>(
    transactingCapability: (config: TTransactingConfig) => TransactingCapability<V1State, TTransaction>,
  ): V1Builder<TConfig & TTransactingConfig, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TTransactingConfig, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      transactingCapability,
    });
  }

  withProving<TProvingConfig>(
    provingService: (config: TProvingConfig) => ProvingService<TTransaction>,
  ): V1Builder<TConfig & TProvingConfig, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TProvingConfig, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      provingService,
    });
  }

  withProvingDefaults(
    this: V1Builder<TConfig, TSerialized, TSyncUpdate, zswap.Transaction>,
  ): V1Builder<TConfig & DefaultProvingConfiguration, TSerialized, TSyncUpdate, zswap.Transaction> {
    return this.withProving(makeDefaultProvingService);
  }

  withCoinsAndBalancesDefaults(): V1Builder<TConfig, TSerialized, TSyncUpdate, TTransaction> {
    return this.withCoinsAndBalances(makeDefaultCoinsAndBalancesCapability);
  }

  withCoinsAndBalances<TBalancesConfig>(
    coinsAndBalancesCapability: (configuration: TBalancesConfig) => CoinsAndBalancesCapability<V1State>,
  ): V1Builder<TConfig & TBalancesConfig, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TBalancesConfig, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      coinsAndBalancesCapability,
    });
  }

  withKeysDefaults(): V1Builder<TConfig, TSerialized, TSyncUpdate, TTransaction> {
    return this.withKeys(makeDefaultKeysCapability);
  }

  withKeys<TKeysConfig>(
    keysCapability: (configuration: TKeysConfig) => KeysCapability<V1State>,
  ): V1Builder<TConfig & TKeysConfig, TSerialized, TSyncUpdate, TTransaction> {
    return new V1Builder<TConfig & TKeysConfig, TSerialized, TSyncUpdate, TTransaction>({
      ...this.#buildState,
      keysCapability,
    });
  }

  build(
    this: V1Builder<TConfig, TSerialized, TSyncUpdate, TTransaction>,
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
          const variantInstance = new RunningV1Variant(context, initialState, v1Context);
          yield* variantInstance.startSync(initialState).pipe(Stream.runScoped(Sink.drain), Effect.forkScoped);
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
    this: V1Builder<TConfig, TSerialized, TSyncUpdate, TTransaction>,
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
      coinsAndBalancesCapability,
      keysCapability,
    } = this.#buildState;

    return {
      serializationCapability: serializationCapability(configuration),
      syncCapability: syncCapability(configuration),
      syncService: syncService(configuration),
      transactingCapability: transactingCapability(configuration),
      coinsAndBalancesCapability: coinsAndBalancesCapability(configuration),
      keysCapability: keysCapability(configuration),
      provingService: provingService(configuration),
    };
  }
}

/** @internal */
declare namespace V1Builder {
  type HasSync<TConfig, TSyncUpdate> = {
    readonly syncService: (configuration: TConfig) => SyncService<V1State, TSyncUpdate>;
    readonly syncCapability: (configuration: TConfig) => SyncCapability<V1State, TSyncUpdate>;
  };

  type HasTransacting<TConfig, TTransaction> = {
    readonly transactingCapability: (configuration: TConfig) => TransactingCapability<V1State, TTransaction>;
  };

  type HasSerialization<TConfig, TSerialized> = {
    readonly serializationCapability: (
      configuration: TConfig,
    ) => SerializationCapability<V1State, zswap.SecretKeys, TSerialized>;
  };

  type HasProving<TConfig, TTransaction> = {
    readonly provingService: (configuration: TConfig) => ProvingService<TTransaction>;
  };

  type HasCoinsAndBalances<TConfig> = {
    readonly coinsAndBalancesCapability: (configuration: TConfig) => CoinsAndBalancesCapability<V1State>;
  };

  type HasKeys<TConfig> = {
    readonly keysCapability: (configuration: TConfig) => KeysCapability<V1State>;
  };

  /**
   * The internal build state of {@link V1Builder}.
   */
  type FullBuildState<TConfig, TSerialized, TSyncUpdate, TTransaction> = Types.Simplify<
    HasSync<TConfig, TSyncUpdate> &
      HasSerialization<TConfig, TSerialized> &
      HasTransacting<TConfig, TTransaction> &
      HasProving<TConfig, TTransaction> &
      HasCoinsAndBalances<TConfig> &
      HasKeys<TConfig>
  >;
  type PartialBuildState<TConfig = object, TSerialized = never, TSyncUpdate = never, TTransaction = never> = {
    [K in keyof FullBuildState<never, never, never, never>]?:
      | FullBuildState<TConfig, TSerialized, TSyncUpdate, TTransaction>[K]
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

const isBuildStateFull = <TConfig, TSerialized, TSyncUpdate, TTransaction>(
  buildState: V1Builder.PartialBuildState<TConfig, TSerialized, TSyncUpdate, TTransaction>,
): buildState is V1Builder.FullBuildState<TConfig, TSerialized, TSyncUpdate, TTransaction> => {
  const allBuildStateKeys = [
    'syncService',
    'syncCapability',
    'transactingCapability',
    'serializationCapability',
    'provingService',
    'coinsAndBalancesCapability',
    'keysCapability',
  ] as const;
  /**
   * This type will fail compilation if any key is omitted, letting the `isFull` check work properly
   */
  type _1 = Expect<
    Types.Equals<keyof V1Builder.FullBuildState<never, never, never, never>, ItemType<typeof allBuildStateKeys>>
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
  type AllCoinsAndBalancesMethods = WithCoinsAndBalancesDefaults;
  type AllKeysMethods = WithKeysDefaults;
  type AllMethods =
    | AllSyncMethods
    | AllTransactingMethods
    | AllSerializationMethods
    | AllProvingMethods
    | AllCoinsAndBalancesMethods
    | AllKeysMethods;
}
