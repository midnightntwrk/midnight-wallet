import { CoreWallet, JsOption } from '@midnight-ntwrk/wallet';
import { ProvingRecipe, TokenTransfer, TransactionToProve } from '@midnight-ntwrk/wallet-api';
import { CoinInfo, LocalState, SecretKeys, Transaction } from '@midnight-ntwrk/zswap';
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect';
import {
  WalletRuntimeError,
  StateChange,
  VersionChangeType,
  ProtocolVersion,
  Variant,
} from '@midnight-ntwrk/wallet-ts/abstractions';
import { EitherOps } from '@midnight-ntwrk/wallet-ts/effect';
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
)<TransactingCapabilityTag, TransactingCapability.Service<V1Variant.State>>() {}

const progress = (state: V1Variant.State): StateChange.StateChange<V1Variant.State>[] => {
  if (!state.isConnected) return [];

  const appliedIndex = JsOption.asResult(state.progress.appliedIndex)?.value ?? 0n;
  const highestRelevantWalletIndex = JsOption.asResult(state.progress.highestRelevantWalletIndex)?.value ?? 0n;
  const highestIndex = JsOption.asResult(state.progress.highestIndex)?.value ?? 0n;
  const highestRelevantIndex = JsOption.asResult(state.progress.highestRelevantIndex)?.value ?? 0n;

  const sourceGap = highestIndex - highestRelevantIndex;
  const applyGap = highestRelevantWalletIndex - appliedIndex;

  return [StateChange.ProgressUpdate({ sourceGap, applyGap })];
};

const protocolVersionChange = (
  previous: V1Variant.State,
  current: V1Variant.State,
): StateChange.StateChange<V1Variant.State>[] => {
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

export declare namespace V1Variant {
  export type State = CoreWallet<LocalState, SecretKeys>;
  export type Context = SyncService | SyncCapability | TransactingCapabilityTag;
  interface API {
    balanceTransaction(tx: Transaction, newCoins: CoinInfo[]): Effect.Effect<ProvingRecipe, WalletError>;
    transferTransaction(outputs: TokenTransfer[]): Effect.Effect<TransactionToProve, WalletError>;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class V1Variant implements Variant.RunningVariant<V1Variant.State, any> {
  #context: Variant.VariantContext<V1Variant.State>;
  #layer: Layer.Layer<V1Variant.Context>;

  readonly state: Stream.Stream<StateChange.StateChange<V1Variant.State>, WalletRuntimeError>;

  constructor(
    context: Variant.VariantContext<V1Variant.State>,
    initialState: V1Variant.State,
    layer: Layer.Layer<V1Variant.Context>,
  ) {
    this.#context = context;
    this.#layer = layer;
    this.state = context.stateRef.changes.pipe(
      Stream.mapAccum(initialState, (previous: V1Variant.State, current: V1Variant.State) => {
        return [current, [previous, current]] as const;
      }),
      Stream.mapConcat(
        ([previous, current]: readonly [
          V1Variant.State,
          V1Variant.State,
        ]): StateChange.StateChange<V1Variant.State>[] => {
          // TODO: emit progress only upon actual change
          return [
            StateChange.State({ state: current }),
            ...progress(current),
            ...protocolVersionChange(previous, current),
          ];
        },
      ),
    );
  }

  startSync(initialState: V1Variant.State): Stream.Stream<void, never> {
    return Stream.Do.pipe(
      Stream.bind('syncService', () => SyncService),
      Stream.bind('syncCapability', () => SyncCapability),
      Stream.flatMap(({ syncCapability, syncService }) => {
        return syncService.updates(initialState).pipe(
          Stream.mapEffect((update) => {
            return SubscriptionRef.update(
              this.#context.stateRef,
              (state) => syncCapability.applyUpdate(state, update) as V1Variant.State, // It seems layers involve losing type information, do we need to proceed with them?
            );
          }),
        );
      }),
      Stream.provideLayer(this.#layer),
    );
  }

  balanceTransaction(tx: Transaction, newCoins: CoinInfo[]): Effect.Effect<ProvingRecipe, WalletError> {
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
}
