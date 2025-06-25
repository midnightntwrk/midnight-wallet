import { CoreWallet, IndexerUpdate, NetworkId } from '@midnight-ntwrk/wallet';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Either, Scope, Sink, Stream, Types } from 'effect';
import { Fluent, Variant, VariantBuilder, WalletRuntimeError, WalletSeed } from '../abstractions/index';

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

export type BaseV1Configuration = {
  networkId: zswap.NetworkId;
};

export type DefaultV1Configuration = BaseV1Configuration & DefaultSyncConfiguration;

const V1BuilderSymbol: {
  readonly typeId: unique symbol;
} = {
  typeId: Symbol('@midnight-ntwrk/wallet#V1Builder') as (typeof V1BuilderSymbol)['typeId'],
} as const;

export type DefaultV1Variant = V1Variant<string, IndexerUpdate>;
export type V1Variant<TSerialized, TSyncUpdate> = Variant.Variant<
  typeof V1Tag,
  V1State,
  null,
  RunningV1Variant<TSerialized, TSyncUpdate>
> & {
  deserializeState: (keys: zswap.SecretKeys, serialized: TSerialized) => Either.Either<V1State, WalletError>;
};

export class V1Builder<
  TConfig extends BaseV1Configuration = BaseV1Configuration,
  TSerialized = never,
  TSyncUpdate = never,
> implements VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate>, TConfig>
{
  #buildState: V1Builder.BuildState<TConfig, TSerialized, TSyncUpdate>;

  constructor(buildState: V1Builder.BuildState<TConfig, TSerialized, TSyncUpdate> = {}) {
    this.#buildState = buildState;
  }

  withDefaults(): Fluent.ExcludeMethod<
    V1Builder<DefaultV1Configuration, string, IndexerUpdate>,
    V1BuilderMethods.AllMethods
  > {
    return this.withSyncDefaults().withSerializationDefaults().withTransactingDefaults();
  }

  withSyncDefaults(): Fluent.ExcludeMethod<
    V1Builder<TConfig & DefaultSyncConfiguration, TSerialized, IndexerUpdate>,
    V1BuilderMethods.AllSyncMethods
  > {
    return this.withSync(makeDefaultSyncService, makeDefaultSyncCapability);
  }

  withSync<TSyncConfig, TSyncUpdate>(
    syncService: (configuration: TSyncConfig) => SyncService<V1State, TSyncUpdate>,
    syncCapability: (configuration: TSyncConfig) => SyncCapability<V1State, TSyncUpdate>,
  ): Fluent.ExcludeMethod<V1Builder<TConfig & TSyncConfig, TSerialized, TSyncUpdate>, V1BuilderMethods.AllSyncMethods> {
    return new V1Builder<TConfig & TSyncConfig, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      syncService,
      syncCapability,
    });
  }

  withSerialization<TSerializationConfig, TSerialized>(
    serializationCapability: (
      configuration: TSerializationConfig,
    ) => SerializationCapability<V1State, zswap.SecretKeys, TSerialized>,
  ): Fluent.ExcludeMethod<
    V1Builder<TConfig & TSerializationConfig, TSerialized, TSyncUpdate>,
    V1BuilderMethods.AllSerializationMethods
  > {
    return new V1Builder<TConfig & TSerializationConfig, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      serializationCapability,
    });
  }

  withSerializationDefaults(): Fluent.ExcludeMethod<
    V1Builder<TConfig, string, TSyncUpdate>,
    V1BuilderMethods.AllSerializationMethods
  > {
    return this.withSerialization(makeDefaultV1SerializationCapability);
  }

  withTransactingDefaults(): Fluent.ExcludeMethod<
    V1Builder<TConfig, TSerialized, TSyncUpdate>,
    V1BuilderMethods.AllTransactingMethods
  > {
    return this.withTransacting(makeDefaultTransactingCapability);
  }

  withTransacting<TTransactingConfig>(
    transactingCapability: (config: TTransactingConfig) => TransactingCapability<V1State>,
  ): Fluent.ExcludeMethod<
    V1Builder<TConfig & TTransactingConfig, TSerialized, TSyncUpdate>,
    V1BuilderMethods.AllTransactingMethods
  > {
    return new V1Builder<TConfig & TTransactingConfig, TSerialized, TSyncUpdate>({
      ...this.#buildState,
      transactingCapability,
    });
  }

  build(
    this: V1Builder<TConfig, TSerialized, TSyncUpdate>,
    configuration: TConfig,
  ): V1Variant<TSerialized, TSyncUpdate> {
    const { v1Context } = this.#buildLayersFromBuildState(configuration);
    const { networkId } = configuration;

    return {
      __polyTag__: V1Tag,
      start(
        context: Variant.VariantContext<V1State>,
        initialState: V1State,
      ): Effect.Effect<RunningV1Variant<TSerialized, TSyncUpdate>, WalletRuntimeError, Scope.Scope> {
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

  #buildLayersFromBuildState(
    this: V1Builder<TConfig, TSerialized, TSyncUpdate>,
    configuration: TConfig,
  ): {
    v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate>;
  } {
    const { syncCapability, syncService, transactingCapability, serializationCapability } = this
      .#buildState as unknown as Required<V1Builder.BuildState<TConfig, TSerialized, TSyncUpdate>>;

    return {
      v1Context: {
        serializationCapability: serializationCapability(configuration),
        syncCapability: syncCapability(configuration),
        syncService: syncService(configuration),
        transactingCapability: transactingCapability(configuration),
      },
    };
  }
}

/** @internal */
declare namespace V1Builder {
  /**
   * The internal build state of {@link V1Builder}.
   */
  type BuildState<TConfig = object, TSerialized = never, TSyncUpdate = never> = {
    readonly syncService?: (configuration: TConfig) => SyncService<V1State, TSyncUpdate>;
    readonly syncCapability?: (configuration: TConfig) => SyncCapability<V1State, TSyncUpdate>;
    readonly transactingCapability?: (configuration: TConfig) => TransactingCapability<V1State>;
    readonly serializationCapability?: (
      configuration: TConfig,
    ) => SerializationCapability<V1State, zswap.SecretKeys, TSerialized>;
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

/** @internal */
declare namespace V1BuilderMethods {
  type WithSyncDefaults = 'withSyncDefaults';
  type WithSyncMethod = 'withSync';
  type WithTransactingMethod = 'withTransacting';
  type WithSerializationMethod = 'withSerialization';
  type WithSerializationDefaults = 'withSerializationDefaults';
  type AllSyncMethods = WithSyncDefaults | WithSyncMethod;
  type AllTransactingMethods = WithTransactingMethod;
  type AllSerializationMethods = WithSerializationMethod | WithSerializationDefaults;
  type AllMethods = AllSyncMethods | AllTransactingMethods | AllSerializationMethods;
}
