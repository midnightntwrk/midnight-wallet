import { CoreWallet, IndexerUpdate, JsOption } from '@midnight-ntwrk/wallet';
import { TokenTransfer } from '@midnight-ntwrk/wallet-api';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, pipe, Stream, SubscriptionRef } from 'effect';
import { StateChange, VersionChangeType, ProtocolVersion } from '@midnight-ntwrk/abstractions';
import { WalletRuntimeError, Variant } from '../abstractions/index';
import { EitherOps } from '../effect/index';
import { ProvingService } from './Proving';
import { ProvingRecipe } from './ProvingRecipe';
import { SerializationCapability } from './Serialization';
import { SyncCapability, SyncService } from './Sync';
import { TransactingCapability } from './Transacting';
import { WalletError } from './WalletError';
import { CoinsAndBalancesCapability } from './CoinsAndBalances';
import { KeysCapability } from './Keys';

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

export const initEmptyState = (keys: zswap.SecretKeys, networkId: zswap.NetworkId): V1State => {
  return CoreWallet.emptyV1(new zswap.LocalState(), keys, networkId);
};

export declare namespace RunningV1Variant {
  export type Context<TSerialized, TSyncUpdate, TTransaction> = {
    serializationCapability: SerializationCapability<V1State, zswap.SecretKeys, TSerialized>;
    syncService: SyncService<V1State, TSyncUpdate>;
    syncCapability: SyncCapability<V1State, TSyncUpdate>;
    transactingCapability: TransactingCapability<V1State, TTransaction>;
    provingService: ProvingService<TTransaction>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<V1State>;
    keysCapability: KeysCapability<V1State>;
  };
}

export const V1Tag: unique symbol = Symbol('V1');

export type DefaultRunningV1 = RunningV1Variant<string, IndexerUpdate, zswap.Transaction>;

export class RunningV1Variant<TSerialized, TSyncUpdate, TTransaction>
  implements Variant.RunningVariant<typeof V1Tag, V1State>
{
  __polyTag__: typeof V1Tag = V1Tag;
  #context: Variant.VariantContext<V1State>;
  #v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction>;

  readonly state: Stream.Stream<StateChange.StateChange<V1State>, WalletRuntimeError>;

  constructor(
    context: Variant.VariantContext<V1State>,
    initialState: V1State,
    v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction>,
  ) {
    this.#context = context;
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

  startSync(initialState: V1State): Stream.Stream<void> {
    return this.#v1Context.syncService.updates(initialState).pipe(
      Stream.mapEffect((update) => {
        return SubscriptionRef.update(this.#context.stateRef, (state) =>
          this.#v1Context.syncCapability.applyUpdate(state, update),
        );
      }),
    );
  }

  balanceTransaction(
    tx: TTransaction,
    newCoins: zswap.CoinInfo[],
  ): Effect.Effect<ProvingRecipe<TTransaction>, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.balanceTransaction(state, tx, newCoins),
        EitherOps.toEffect,
        Effect.map(({ recipe, newState }) => [recipe, newState] as const),
      );
    });
  }

  transferTransaction(outputs: ReadonlyArray<TokenTransfer>): Effect.Effect<ProvingRecipe<TTransaction>, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.makeTransfer(state, outputs),
        EitherOps.toEffect,
        Effect.map(({ recipe, newState }) => [recipe, newState] as const),
      );
    });
  }

  finalizeTransaction(recipe: ProvingRecipe<TTransaction>): Effect.Effect<TTransaction, WalletError> {
    return this.#v1Context.provingService.prove(recipe);
  }

  serializeState(state: V1State): TSerialized {
    return this.#v1Context.serializationCapability.serialize(state);
  }
}
