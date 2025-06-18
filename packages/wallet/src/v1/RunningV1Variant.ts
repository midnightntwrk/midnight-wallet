import { CoreWallet, JsOption } from '@midnight-ntwrk/wallet';
import { ProvingRecipe, TokenTransfer, TransactionToProve } from '@midnight-ntwrk/wallet-api';
import * as zswap from '@midnight-ntwrk/zswap';
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect';
import { WalletRuntimeError, StateChange, VersionChangeType, ProtocolVersion, Variant } from '../abstractions/index';
import { EitherOps } from '../effect/index';
import { SerializationCapability } from './Serialization';
import { SyncCapability } from './SyncCapability';
import { SyncService } from './SyncService';
import { TransactingCapability } from './Transacting';
import { WalletError } from './WalletError';

/*
 This makes for very questionable ergonomics of layers where type parameters need to be involved, precisely:
 - need to use a class
 - self-reference
 - opacity/lack of guidance on other ways to define tags
*/
export class TransactingCapabilityTag extends Context.Tag(
  `@midnight-ntwrk/wallet#TransactingCapability<@midnight-ntwrk/wallet-ts/v1/V1Variant.State>`,
)<TransactingCapabilityTag, TransactingCapability.Service<V1State>>() {}

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

const protocolVersionChange = (previous: V1State, current: V1State): StateChange.StateChange<V1State>[] => {
  return previous.protocolVersion.version != current.protocolVersion.version
    ? [
        StateChange.VersionChange({
          change: VersionChangeType.Version({
            version: ProtocolVersion.ProtocolVersion(current.protocolVersion.version),
          }),
        }),
      ]
    : [];
};

export type V1State = CoreWallet<zswap.LocalState, zswap.SecretKeys>;

export declare namespace RunningV1Variant {
  export type LayerContext = SyncService | SyncCapability | TransactingCapabilityTag;
  //TODO: Migrate to such record whole V1 context instead of layers
  export type Context<TSerialized> = {
    serializationCapability: SerializationCapability<V1State, zswap.SecretKeys, TSerialized>;
  };

  interface API<TSerialized> {
    balanceTransaction(tx: zswap.Transaction, newCoins: zswap.CoinInfo[]): Effect.Effect<ProvingRecipe, WalletError>;
    transferTransaction(outputs: TokenTransfer[]): Effect.Effect<TransactionToProve, WalletError>;
    serializeState(state: V1State): TSerialized;
  }
}

export const V1Tag: unique symbol = Symbol('V1');

export class RunningV1Variant<TSerialized> implements Variant.RunningVariant<typeof V1Tag, V1State> {
  __polyTag__: typeof V1Tag = V1Tag;
  #context: Variant.VariantContext<V1State>;
  #v1Context: RunningV1Variant.Context<TSerialized>;
  #layer: Layer.Layer<RunningV1Variant.LayerContext>;

  readonly state: Stream.Stream<StateChange.StateChange<V1State>, WalletRuntimeError>;

  constructor(
    context: Variant.VariantContext<V1State>,
    initialState: V1State,
    layer: Layer.Layer<RunningV1Variant.LayerContext>,
    v1Context: RunningV1Variant.Context<TSerialized>,
  ) {
    this.#context = context;
    this.#layer = layer;
    this.#v1Context = v1Context;
    this.state = context.stateRef.changes.pipe(
      Stream.mapAccum(initialState, (previous: V1State, current: V1State) => {
        return [current, [previous, current]] as const;
      }),
      Stream.mapConcat(([previous, current]: readonly [V1State, V1State]): StateChange.StateChange<V1State>[] => {
        // TODO: emit progress only upon actual change
        return [
          StateChange.State({ state: current }),
          ...progress(current),
          ...protocolVersionChange(previous, current),
        ];
      }),
    );
  }

  startSync(initialState: V1State): Stream.Stream<void, never> {
    return Stream.Do.pipe(
      Stream.bind('syncService', () => SyncService),
      Stream.bind('syncCapability', () => SyncCapability),
      Stream.flatMap(({ syncCapability, syncService }) => {
        return syncService.updates(initialState).pipe(
          Stream.mapEffect((update) => {
            return SubscriptionRef.update(
              this.#context.stateRef,
              (state) => syncCapability.applyUpdate(state, update) as V1State, // It seems layers involve losing type information, do we need to proceed with them?
            );
          }),
        );
      }),
      Stream.provideLayer(this.#layer),
    );
  }

  balanceTransaction(tx: zswap.Transaction, newCoins: zswap.CoinInfo[]): Effect.Effect<ProvingRecipe, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return TransactingCapabilityTag.pipe(
        Effect.map((transacting) => transacting.balanceTransaction(state, tx, newCoins)),
        Effect.flatMap(EitherOps.toEffect),
        Effect.map(({ recipe, newState }) => [recipe, newState] as const),
        Effect.provide(this.#layer),
      );
    });
  }

  transferTransaction(outputs: ReadonlyArray<TokenTransfer>): Effect.Effect<ProvingRecipe, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return TransactingCapabilityTag.pipe(
        Effect.map((transacting) => transacting.makeTransfer(state, outputs)),
        Effect.flatMap(EitherOps.toEffect),
        Effect.map(({ recipe, newState }) => [recipe, newState] as const),
        Effect.provide(this.#layer),
      );
    });
  }

  serializeState(state: V1State): TSerialized {
    return this.#v1Context.serializationCapability.serialize(state);
  }
}
