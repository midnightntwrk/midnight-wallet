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
  TracerCarrier,
  V1Combination,
  V1EvolveState,
  V1Transaction,
  WalletError as ScalaWalletError,
  NetworkId,
} from '@midnight-ntwrk/wallet';
import { ProvingRecipe, TokenTransfer } from '@midnight-ntwrk/wallet-api';
import { ShieldedEncryptionSecretKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Either, Layer, Scope, Sink, Stream, Types } from 'effect';
import * as rx from 'rxjs';
import { Fluent, Variant, VariantBuilder, WalletRuntimeError, WalletSeed } from '../abstractions/index';
import { EitherOps, Observable } from '../effect/index';
import { SyncCapability } from './SyncCapability';
import { SyncService } from './SyncService';
import { TransactingCapability } from './Transacting';

import { TransactingCapabilityTag, V1Variant } from './V1Variant';
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

export class V1Builder<out R = V1Variant.Context>
  implements VariantBuilder<V1Variant.State, null, V1Configuration>, V1Builder.Variance<R>
{
  readonly [V1BuilderSymbol.typeId] = {
    _R: (_: never): R => _,
  };

  #buildState: V1Builder.BuildState;

  constructor() {
    this.#buildState = {};
  }

  withSyncDefaults(): Fluent.ExcludeMethod<
    V1Builder<Exclude<R, SyncService | SyncCapability>>,
    V1BuilderMethods.AllSyncMethods
  > {
    const sync = ({ indexerWsUrl, networkId }: V1Configuration, _state: V1Variant.State) => {
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
        updates(state: V1Variant.State) {
          return sync(configuration, state);
        },
      }),
      () => ({
        applyUpdate(state: V1Variant.State, update: IndexerUpdate) {
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
    syncService: (configuration: V1Configuration) => SyncService.Service<V1Variant.State, IndexerUpdate>,
    syncCapability: (configuration: V1Configuration) => SyncCapability.Service<V1Variant.State, IndexerUpdate>,
  ): Fluent.ExcludeMethod<V1Builder<Exclude<R, SyncService | SyncCapability>>, V1BuilderMethods.AllSyncMethods> {
    this.#buildState = {
      ...this.#buildState,
      syncService,
      syncCapability,
    };

    return this as V1Builder<Exclude<R, SyncService | SyncCapability>>;
  }

  withTransactingDefaults(): Fluent.ExcludeMethod<
    V1Builder<Exclude<R, TransactingCapabilityTag>>,
    V1BuilderMethods.AllTransactingMethods
  > {
    const applyTransaction = (wallet: V1Variant.State, tx: AppliedTransaction<zswap.Transaction>): V1Variant.State => {
      return wallet.applyTransaction(tx);
    };

    const getState = (wallet: V1Variant.State) => wallet.state;
    const setState = (wallet: V1Variant.State, state: zswap.LocalState): V1Variant.State => {
      return wallet.applyState(state);
    };

    const getNetworkId = (wallet: V1Variant.State): NetworkId => {
      return wallet.networkId;
    };

    const defaultTransacting = DefaultTransferCapability.createV1(applyTransaction, getState, setState, getNetworkId);
    const defaultCoins = DefaultCoinsCapability.createV1<V1Variant.State>(
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
      res: Either.Either<{ wallet: V1Variant.State; result: ProvingRecipe }, ScalaWalletError>,
    ) => Either.Either<{ recipe: ProvingRecipe; newState: V1Variant.State }, WalletError> = Either.mapBoth({
      onLeft: (err) => WalletError.fromScala(err),
      onRight: (result) => ({ recipe: result.result, newState: result.wallet }),
    });

    const capability: TransactingCapability.Service<V1Variant.State> = {
      balanceTransaction(
        state: V1Variant.State,
        tx: zswap.Transaction,
        newCoins: zswap.CoinInfo[],
      ): Either.Either<{ recipe: ProvingRecipe; newState: V1Variant.State }, WalletError> {
        return EitherOps.fromScala(defaultBalancing.balanceTransaction(state, JsEither.left(tx), newCoins)).pipe(
          resultFromScala,
        );
      },
      makeTransfer(
        state: V1Variant.State,
        outputs: TokenTransfer[],
      ): Either.Either<{ recipe: ProvingRecipe; newState: V1Variant.State }, WalletError> {
        return EitherOps.fromScala(defaultTransacting.prepareTransferRecipe(state, outputs)).pipe(
          Either.flatMap((unprovenTx: zswap.UnprovenTransaction) =>
            EitherOps.fromScala(defaultBalancing.balanceTransaction(state, JsEither.right(unprovenTx), [])),
          ),
          resultFromScala,
        );
      },

      //These functions below do not exactly match here, but also seem to be somewhat good place to put
      //The reason is that they primarily make sense in a wallet flavour only able to issue transactions
      applyFailedTransaction(
        state: V1Variant.State,
        tx: zswap.Transaction,
      ): Either.Either<V1Variant.State, WalletError> {
        return EitherOps.fromScala(defaultTransacting.applyFailedTransaction(state, tx)).pipe(
          Either.mapLeft((err) => WalletError.fromScala(err)),
        );
      },

      applyFailedUnprovenTransaction(
        state: V1Variant.State,
        tx: zswap.UnprovenTransaction,
      ): Either.Either<V1Variant.State, WalletError> {
        return EitherOps.fromScala(defaultTransacting.applyFailedUnprovenTransaction(state, tx)).pipe(
          Either.mapLeft((err) => WalletError.fromScala(err)),
        );
      },
    };
    return this.withTransacting(capability);
  }

  withTransacting(
    transactingCapability: TransactingCapability.Service<V1Variant.State>,
  ): Fluent.ExcludeMethod<V1Builder<Exclude<R, TransactingCapabilityTag>>, V1BuilderMethods.AllTransactingMethods> {
    this.#buildState = {
      ...this.#buildState,
      transactingCapability,
    };

    return this as V1Builder<Exclude<R, TransactingCapabilityTag>>;
  }

  build(this: V1Builder<never>, configuration: V1Configuration): Variant.Variant<V1Variant.State> {
    const layer = this.#buildLayersFromBuildState(configuration);
    const { networkId } = configuration;

    return {
      start(
        context: Variant.VariantContext<V1Variant.State>,
        initialState: V1Variant.State,
      ): Effect.Effect<V1Variant, WalletRuntimeError, Scope.Scope> {
        return Effect.gen(function* () {
          const variantInstance = new V1Variant(context, initialState, layer);
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
    };
  }

  #buildLayersFromBuildState(this: V1Builder<never>, configuration: V1Configuration): Layer.Layer<V1Variant.Context> {
    const { syncCapability, syncService, transactingCapability } = this.#buildState as Required<V1Builder.BuildState>;
    const syncServiceLayer = Layer.succeed(SyncService, SyncService.of(syncService(configuration)));
    const syncCapabilityLayer = Layer.succeed(SyncCapability, SyncCapability.of(syncCapability(configuration)));
    const transactingCapabilityLayer = Layer.succeed(
      TransactingCapabilityTag,
      TransactingCapabilityTag.of(transactingCapability),
    );

    return Layer.mergeAll(syncServiceLayer, syncCapabilityLayer, transactingCapabilityLayer);
  }
}

/** @internal */
declare namespace V1Builder {
  /**
   * The internal build state of {@link V1Builder}.
   */
  type BuildState = {
    readonly syncService?: (configuration: V1Configuration) => SyncService.Service<V1Variant.State, IndexerUpdate>;
    readonly syncCapability?: (
      configuration: V1Configuration,
    ) => SyncCapability.Service<V1Variant.State, IndexerUpdate>;
    readonly transactingCapability?: TransactingCapability.Service<V1Variant.State>;
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
  type AllSyncMethods = WithSyncDefaults | WithSyncMethod;
  type AllTransactingMethods = WithTransactingMethod;
}
