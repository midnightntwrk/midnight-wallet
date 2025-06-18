import {
  AppliedTransaction,
  CoreWallet,
  DefaultBalancingCapability,
  DefaultCoinsCapability,
  DefaultSyncCapability,
  DefaultSyncService,
  DefaultTransferCapability,
  DefaultTxHistoryCapability,
  IndexerClient,
  IndexerUpdate,
  JsEither,
  NetworkId,
  TracerCarrier,
  V1Combination,
  V1EvolveState,
  V1Transaction,
  WalletError as ScalaWalletError,
} from '@midnight-ntwrk/wallet';
import { ProvingRecipe, TokenTransfer } from '@midnight-ntwrk/wallet-api';
import { ShieldedEncryptionSecretKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Either, Layer, Scope, Sink, Stream, Types } from 'effect';
import * as rx from 'rxjs';
import { Fluent, Variant, VariantBuilder, WalletRuntimeError, WalletSeed } from '../abstractions/index';
import { EitherOps, Observable } from '../effect/index';

import { RunningV1Variant, TransactingCapabilityTag, V1State, V1Tag } from './RunningV1Variant';
import { makeDefaultV1SerializationCapability, SerializationCapability } from './Serialization';
import { SyncCapability } from './SyncCapability';
import { SyncService } from './SyncService';
import { TransactingCapability } from './Transacting';
import { WalletError } from './WalletError';

export type V1Configuration = {
  indexerWsUrl: string;
  networkId: zswap.NetworkId;
};

const V1BuilderSymbol: {
  readonly typeId: unique symbol;
} = {
  typeId: Symbol('@midnight-ntwrk/wallet#V1Builder') as (typeof V1BuilderSymbol)['typeId'],
} as const;

export type V1Variant<TSerialized> = Variant.Variant<typeof V1Tag, V1State, null, RunningV1Variant<TSerialized>> & {
  deserializeState: (keys: zswap.SecretKeys, serialized: TSerialized) => Either.Either<V1State, WalletError>;
};

export class V1Builder<out R = RunningV1Variant.LayerContext, TSerialized = never>
  implements VariantBuilder.VariantBuilder<V1Variant<TSerialized>, V1Configuration>, V1Builder.Variance<R>
{
  readonly [V1BuilderSymbol.typeId] = {
    _R: (_: never): R => _,
  };

  #buildState: V1Builder.BuildState<TSerialized>;

  constructor(buildState: V1Builder.BuildState<TSerialized> = {}) {
    this.#buildState = buildState;
  }

  withSyncDefaults(): Fluent.ExcludeMethod<
    V1Builder<Exclude<R, SyncService | SyncCapability>, TSerialized>,
    V1BuilderMethods.AllSyncMethods
  > {
    const sync = ({ indexerWsUrl, networkId }: V1Configuration, _state: V1State) => {
      const seed = WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001');
      const bech32mESK = ShieldedEncryptionSecretKey.codec
        .encode(
          networkId,
          new ShieldedEncryptionSecretKey(
            CoreWallet.emptyV1(
              new zswap.LocalState(),
              zswap.SecretKeys.fromSeed(seed),
              networkId,
            ).secretKeys.encryptionSecretKey,
          ),
        )
        .asString();
      const tracer = TracerCarrier.createLoggingTracer('debug');
      return Stream.acquireRelease(
        Effect.promise(() => IndexerClient.create(indexerWsUrl, tracer).allocate()),
        (client) => Effect.promise(() => client.deallocate()),
      ).pipe(
        Stream.flatMap((client) =>
          Stream.fromEffect(Effect.succeed(DefaultSyncService.create(client.value, bech32mESK, 0n))),
        ),
        Stream.flatMap((service) => {
          return Observable.toStream(
            service.sync$().pipe(rx.concatMap((update) => V1Combination.mapIndexerEvent(update, networkId))),
          );
        }),
      );
    };
    const syncCapability = new DefaultSyncCapability(new DefaultTxHistoryCapability(), V1Transaction, V1EvolveState);

    return this.withSync(
      (configuration) => ({
        updates(state: V1State) {
          return sync(configuration, state);
        },
      }),
      () => ({
        applyUpdate(state: V1State, update: IndexerUpdate) {
          return JsEither.fold(
            syncCapability.applyUpdate(state, update),
            (error) => {
              throw error;
            },
            (state) => state,
          );
        },
      }),
    );
  }

  withSync(
    syncService: (configuration: V1Configuration) => SyncService.Service<V1State, IndexerUpdate>,
    syncCapability: (configuration: V1Configuration) => SyncCapability.Service<V1State, IndexerUpdate>,
  ): Fluent.ExcludeMethod<
    V1Builder<Exclude<R, SyncService | SyncCapability>, TSerialized>,
    V1BuilderMethods.AllSyncMethods
  > {
    return new V1Builder({
      ...this.#buildState,
      syncService,
      syncCapability,
    });
  }

  withSerialization<TSerialized>(
    serializationCapability: (
      configuration: V1Configuration,
    ) => SerializationCapability<V1State, zswap.SecretKeys, TSerialized>,
  ): Fluent.ExcludeMethod<V1Builder<R, TSerialized>, V1BuilderMethods.AllSerializationMethods> {
    return new V1Builder({
      ...this.#buildState,
      serializationCapability,
    }) as Fluent.ExcludeMethod<V1Builder<R, TSerialized>, V1BuilderMethods.AllSerializationMethods>;
  }

  withSerializationDefaults(): Fluent.ExcludeMethod<V1Builder<R, string>, V1BuilderMethods.AllSerializationMethods> {
    return this.withSerialization(makeDefaultV1SerializationCapability);
  }

  withTransactingDefaults(): Fluent.ExcludeMethod<
    V1Builder<Exclude<R, TransactingCapabilityTag>, TSerialized>,
    V1BuilderMethods.AllTransactingMethods
  > {
    const applyTransaction = (wallet: V1State, tx: AppliedTransaction<zswap.Transaction>): V1State => {
      return wallet.applyTransaction(tx);
    };

    const getState = (wallet: V1State) => wallet.state;
    const setState = (wallet: V1State, state: zswap.LocalState): V1State => {
      return wallet.applyState(state);
    };

    const getNetworkId = (wallet: V1State): NetworkId => {
      return wallet.networkId;
    };

    const defaultTransacting = DefaultTransferCapability.createV1(applyTransaction, getState, setState, getNetworkId);
    const defaultCoins = DefaultCoinsCapability.createV1<V1State>(
      (wallet) => [...wallet.state.coins],
      (wallet) =>
        [...wallet.state.coins].map((coin) => {
          const [, input] = wallet.state.spend(wallet.secretKeys, coin, 0);
          return input.nullifier;
        }),
      (wallet) => {
        const pendingSpends = new Set([...wallet.state.pendingSpends.values()].map((coin) => coin.nonce));
        return [...wallet.state.coins].filter((coin) => !pendingSpends.has(coin.nonce));
      },
      (wallet) => [...wallet.state.pendingSpends.values()],
    );
    const defaultBalancing = DefaultBalancingCapability.createV1(
      defaultCoins,
      setState,
      (wallet) => wallet.secretKeys,
      getState,
    );

    const resultFromScala: (
      res: Either.Either<{ wallet: V1State; result: ProvingRecipe }, ScalaWalletError>,
    ) => Either.Either<{ recipe: ProvingRecipe; newState: V1State }, WalletError> = Either.mapBoth({
      onLeft: (err) => WalletError.fromScala(err),
      onRight: (result) => ({ recipe: result.result, newState: result.wallet }),
    });

    const capability: TransactingCapability.Service<V1State> = {
      balanceTransaction(
        state: V1State,
        tx: zswap.Transaction,
        newCoins: zswap.CoinInfo[],
      ): Either.Either<{ recipe: ProvingRecipe; newState: V1State }, WalletError> {
        return EitherOps.fromScala(defaultBalancing.balanceTransaction(state, JsEither.left(tx), newCoins)).pipe(
          resultFromScala,
        );
      },
      makeTransfer(
        state: V1State,
        outputs: TokenTransfer[],
      ): Either.Either<{ recipe: ProvingRecipe; newState: V1State }, WalletError> {
        return EitherOps.fromScala(defaultTransacting.prepareTransferRecipe(state, outputs)).pipe(
          Either.flatMap((unprovenTx: zswap.UnprovenTransaction) =>
            EitherOps.fromScala(defaultBalancing.balanceTransaction(state, JsEither.right(unprovenTx), [])),
          ),
          resultFromScala,
        );
      },

      //These functions below do not exactly match here, but also seem to be somewhat good place to put
      //The reason is that they primarily make sense in a wallet flavour only able to issue transactions
      applyFailedTransaction(state: V1State, tx: zswap.Transaction): Either.Either<V1State, WalletError> {
        return EitherOps.fromScala(defaultTransacting.applyFailedTransaction(state, tx)).pipe(
          Either.mapLeft((err) => WalletError.fromScala(err)),
        );
      },

      applyFailedUnprovenTransaction(
        state: V1State,
        tx: zswap.UnprovenTransaction,
      ): Either.Either<V1State, WalletError> {
        return EitherOps.fromScala(defaultTransacting.applyFailedUnprovenTransaction(state, tx)).pipe(
          Either.mapLeft((err) => WalletError.fromScala(err)),
        );
      },
    };
    return this.withTransacting(capability);
  }

  withTransacting(
    transactingCapability: TransactingCapability.Service<V1State>,
  ): Fluent.ExcludeMethod<
    V1Builder<Exclude<R, TransactingCapabilityTag>, TSerialized>,
    V1BuilderMethods.AllTransactingMethods
  > {
    return new V1Builder({
      ...this.#buildState,
      transactingCapability,
    });
  }

  build(this: V1Builder<never, TSerialized>, configuration: V1Configuration): V1Variant<TSerialized> {
    const { layer, v1Context } = this.#buildLayersFromBuildState(configuration);
    const { networkId } = configuration;

    return {
      __polyTag__: V1Tag,
      start(
        context: Variant.VariantContext<V1State>,
        initialState: V1State,
      ): Effect.Effect<RunningV1Variant<TSerialized>, WalletRuntimeError, Scope.Scope> {
        return Effect.gen(function* () {
          const variantInstance = new RunningV1Variant(context, initialState, layer, v1Context);
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
    this: V1Builder<never, TSerialized>,
    configuration: V1Configuration,
  ): { layer: Layer.Layer<RunningV1Variant.LayerContext>; v1Context: RunningV1Variant.Context<TSerialized> } {
    const { syncCapability, syncService, transactingCapability, serializationCapability } = this
      .#buildState as Required<V1Builder.BuildState>;
    const syncServiceLayer = Layer.succeed(SyncService, SyncService.of(syncService(configuration)));
    const syncCapabilityLayer = Layer.succeed(SyncCapability, SyncCapability.of(syncCapability(configuration)));
    const transactingCapabilityLayer = Layer.succeed(
      TransactingCapabilityTag,
      TransactingCapabilityTag.of(transactingCapability),
    );

    return {
      layer: Layer.mergeAll(syncServiceLayer, syncCapabilityLayer, transactingCapabilityLayer),
      v1Context: { serializationCapability: serializationCapability(configuration) },
    };
  }
}

/** @internal */
declare namespace V1Builder {
  /**
   * The internal build state of {@link V1Builder}.
   */
  type BuildState<TSerialized = never> = {
    readonly syncService?: (configuration: V1Configuration) => SyncService.Service<V1State, IndexerUpdate>;
    readonly syncCapability?: (configuration: V1Configuration) => SyncCapability.Service<V1State, IndexerUpdate>;
    readonly transactingCapability?: TransactingCapability.Service<V1State>;
    readonly serializationCapability?: (
      configuration: V1Configuration,
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
}
