import {
  VariantBuilder,
  Variant,
  WalletSeed,
  StateChange,
  Fluent,
  ProtocolVersion,
  VersionChangeType,
  WalletRuntimeError,
} from '../abstractions/index';
import { Observable } from '../effect/index';
import { LocalState, NetworkId, SecretKeys } from '@midnight-ntwrk/zswap';
import {
  IndexerUpdate,
  DefaultSyncCapability,
  DefaultSyncService,
  DefaultTxHistoryCapability,
  TracerCarrier,
  IndexerClient,
  CoreWallet,
  V1Combination,
  V1Transaction,
  V1EvolveState,
  JsEither,
  JsOption,
} from '@midnight-ntwrk/wallet';
import { ShieldedEncryptionSecretKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { Effect, Stream, Layer, Types, SubscriptionRef, Scope } from 'effect';
import * as rx from 'rxjs';
import { SyncService } from './SyncService';
import { SyncCapability } from './SyncCapability';

export type V1State = CoreWallet<LocalState, SecretKeys>;

export type V1Configuration = {
  indexerWsUrl: string;
  networkId: NetworkId;
};

const V1BuilderSymbol: {
  readonly typeId: unique symbol;
} = {
  typeId: Symbol('@midnight-ntwrk/wallet#V1Builder') as (typeof V1BuilderSymbol)['typeId'],
} as const;

export class V1Builder<out R = V1Builder.Context>
  implements VariantBuilder<V1State, null, V1Configuration>, V1Builder.Variance<R>
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
    const sync = ({ indexerWsUrl, networkId }: V1Configuration, _state: V1State) => {
      const seed = WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001');
      const bech32mESK = ShieldedEncryptionSecretKey.codec
        .encode(
          networkId,
          new ShieldedEncryptionSecretKey(
            CoreWallet.emptyV1(new LocalState(), SecretKeys.fromSeed(seed), networkId).secretKeys.encryptionSecretKey,
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
  ): Fluent.ExcludeMethod<V1Builder<Exclude<R, SyncService | SyncCapability>>, V1BuilderMethods.AllSyncMethods> {
    this.#buildState = {
      ...this.#buildState,
      syncService,
      syncCapability,
    };

    return this as V1Builder<Exclude<R, SyncService | SyncCapability>>;
  }

  build(this: V1Builder<never>, configuration: V1Configuration): Variant.Variant<V1State, null> {
    const layer = this.#buildLayersFromBuildState(configuration);
    const { networkId } = configuration;

    const progress = (state: V1State): StateChange.StateChange<V1State>[] => {
      if (!state.isConnected) return [];

      const appliedIndex = JsOption.asResult(state.progress.appliedIndex)?.value ?? 0n;
      const highestRelevantWalletIndex = JsOption.asResult(state.progress.highestRelevantWalletIndex)?.value ?? 0n;
      const highestIndex = JsOption.asResult(state.progress.highestIndex)?.value ?? 0n;
      const highestRelevantIndex = JsOption.asResult(state.progress.highestRelevantIndex)?.value ?? 0n;

      const sourceGap = highestIndex - highestRelevantIndex;
      const applyGap = highestRelevantWalletIndex - appliedIndex;

      return [StateChange.ProgressUpdate({ sourceGap, applyGap })];
    };

    return {
      start(
        context,
        initialState,
      ): Effect.Effect<Variant.RunningVariant<V1State, object>, WalletRuntimeError, Scope.Scope> {
        return Effect.Do.pipe(
          Effect.bind('syncService', () => SyncService),
          Effect.bind('syncCapability', () => SyncCapability),
          Effect.bind('runningSync', ({ syncCapability, syncService }) => {
            return syncService.updates(initialState).pipe(
              Stream.mapEffect((update) => {
                return SubscriptionRef.update(
                  context.stateRef,
                  (state) => syncCapability.applyUpdate(state, update) as V1State, // It seems layers involve losing type information, do we need to proceed with them?
                );
              }),
              Stream.runDrain,
              Effect.forkScoped,
            );
          }),
          Effect.provide(layer),
          Effect.as({
            state: context.stateRef.changes.pipe(
              Stream.mapAccum(initialState, (previous: V1State, current: V1State) => {
                return [current, [previous, current]] as const;
              }),
              Stream.mapConcat(
                ([previous, current]: readonly [V1State, V1State]): StateChange.StateChange<V1State>[] => {
                  // TODO: emit progress only upon actual change
                  const out = [StateChange.State({ state: current }), ...progress(current)];
                  const outWithMaybeProtocolVersionChange =
                    previous.protocolVersion.version != current.protocolVersion.version
                      ? [
                          ...out,
                          StateChange.VersionChange({
                            change: VersionChangeType.Version({
                              version: ProtocolVersion.ProtocolVersion(current.protocolVersion.version),
                            }),
                          }),
                        ]
                      : out;

                  return outWithMaybeProtocolVersionChange;
                },
              ),
            ),
          }),
        );
      },

      migrateState() {
        const seed = WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001');

        return Effect.succeed(CoreWallet.emptyV1(new LocalState(), SecretKeys.fromSeed(seed), networkId));
      },
    };
  }

  #buildLayersFromBuildState(this: V1Builder<never>, configuration: V1Configuration): Layer.Layer<V1Builder.Context> {
    const { syncCapability, syncService } = this.#buildState as Required<V1Builder.BuildState>;
    const syncServiceLayer = Layer.succeed(SyncService, SyncService.of(syncService(configuration)));
    const syncCapabilityLayer = Layer.succeed(SyncCapability, SyncCapability.of(syncCapability(configuration)));

    return Layer.mergeAll(syncServiceLayer, syncCapabilityLayer);
  }
}

/** @internal */
declare namespace V1Builder {
  /**
   * The internal build state of {@link V1Builder}.
   */
  type BuildState = {
    readonly syncService?: (configuration: V1Configuration) => SyncService.Service<V1State, IndexerUpdate>;
    readonly syncCapability?: (configuration: V1Configuration) => SyncCapability.Service<V1State, IndexerUpdate>;
  };

  /**
   * Utility interface that manages the type variance of {@link V1Builder}.
   */
  interface Variance<R> {
    readonly [V1BuilderSymbol.typeId]: {
      readonly _R: Types.Covariant<R>;
    };
  }

  /**
   * The required context for {@link V1Builder}.
   */
  type Context = SyncService | SyncCapability;
}

/** @internal */
declare namespace V1BuilderMethods {
  type WithSyncDefaults = 'withSyncDefaults';
  type WithSyncMethod = 'withSync';
  type AllSyncMethods = WithSyncDefaults | WithSyncMethod;
}
