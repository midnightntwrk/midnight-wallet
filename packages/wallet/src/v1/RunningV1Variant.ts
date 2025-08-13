import { CoreWallet, IndexerUpdate, JsOption, NetworkId } from '@midnight-ntwrk/wallet';
import { TokenTransfer } from '@midnight-ntwrk/wallet-api';
import * as zswap from '@midnight-ntwrk/zswap';
import { Array as Arr, Effect, pipe, Record, Stream, SubscriptionRef } from 'effect';
import { StateChange, VersionChangeType, ProtocolVersion } from '@midnight-ntwrk/abstractions';
import { WalletRuntimeError, Variant } from '../abstractions/index';
import { EitherOps } from '../effect/index';
import { ProvingService } from './Proving';
import { ProvingRecipe } from './ProvingRecipe';
import { SerializationCapability } from './Serialization';
import { SyncCapability, SyncService } from './Sync';
import { TransactingCapability } from './Transacting';
import { OtherWalletError, WalletError } from './WalletError';
import { CoinsAndBalancesCapability } from './CoinsAndBalances';
import { KeysCapability } from './Keys';
import { SubmissionService, SubmitTransactionMethod } from './Submission';
import { CoinSelection } from '@midnight-ntwrk/wallet-sdk-capabilities';

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
export const V1State = new (class {
  readonly #modifyLocalState = <A>(
    state: V1State,
    modifier: (s: zswap.LocalState) => [A, zswap.LocalState],
  ): [A, V1State] => {
    const [output, newState] = modifier(state.state);
    const updatedState = state.applyState(newState);
    return [output, updatedState];
  };

  readonly #updateLocalState = (state: V1State, updater: (s: zswap.LocalState) => zswap.LocalState): V1State => {
    return state.applyState(updater(state.state));
  };

  initEmpty = (keys: zswap.SecretKeys, networkId: zswap.NetworkId): V1State => {
    return CoreWallet.emptyV1(new zswap.LocalState(), keys, NetworkId.fromJs(networkId));
  };

  init = (state: zswap.LocalState, keys: zswap.SecretKeys, networkId: zswap.NetworkId): V1State => {
    return CoreWallet.emptyV1(state, keys, NetworkId.fromJs(networkId));
  };

  spendCoins = (
    state: V1State,
    coins: ReadonlyArray<zswap.QualifiedCoinInfo>,
    segment: 0 | 1,
  ): [ReadonlyArray<zswap.UnprovenOffer>, V1State] => {
    return this.#modifyLocalState(state, (localState) => {
      return pipe(
        coins,
        Arr.reduce(
          [[], localState],
          ([offers, localState]: [ReadonlyArray<zswap.UnprovenOffer>, zswap.LocalState], coinToSpend) => {
            const [newState, newInput] = localState.spend(state.secretKeys, coinToSpend, segment);
            const inputOffer = zswap.UnprovenOffer.fromInput(newInput, coinToSpend.type, coinToSpend.value);
            return [Arr.append(offers, inputOffer), newState];
          },
        ),
      );
    });
  };

  watchCoins = (state: V1State, coins: ReadonlyArray<zswap.CoinInfo>): V1State => {
    return this.#updateLocalState(state, (localState) => {
      return coins.reduce(
        (localState: zswap.LocalState, coin) => localState.watchFor(state.secretKeys.coinPublicKey, coin),
        localState,
      );
    });
  };
})();

export declare namespace RunningV1Variant {
  export type Context<TSerialized, TSyncUpdate, TTransaction> = {
    serializationCapability: SerializationCapability<V1State, zswap.SecretKeys, TSerialized>;
    syncService: SyncService<V1State, TSyncUpdate>;
    syncCapability: SyncCapability<V1State, TSyncUpdate>;
    transactingCapability: TransactingCapability<V1State, TTransaction>;
    provingService: ProvingService<TTransaction>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<V1State>;
    keysCapability: KeysCapability<V1State>;
    submissionService: SubmissionService<TTransaction>;
    coinSelection: CoinSelection<zswap.QualifiedCoinInfo>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyContext = Context<any, any, any>;
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

  startSync(initialState: V1State): Stream.Stream<void, WalletError> {
    return this.#v1Context.syncService.updates(initialState).pipe(
      Stream.mapEffect((update) => {
        return SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
          Effect.try({
            try: () => this.#v1Context.syncCapability.applyUpdate(state, update),
            catch: (err) =>
              new OtherWalletError({
                message: 'Error while applying sync update',
                cause: err,
              }),
          }),
        );
      }),
    );
  }

  balanceTransaction(
    tx: TTransaction,
    newCoins: readonly zswap.CoinInfo[],
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

  initSwap(
    desiredInputs: Record<zswap.TokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Effect.Effect<ProvingRecipe<TTransaction>, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.initSwap(state, desiredInputs, desiredOutputs),
        EitherOps.toEffect,
        Effect.map(({ recipe, newState }) => [recipe, newState] as const),
      );
    });
  }

  finalizeTransaction(recipe: ProvingRecipe<TTransaction>): Effect.Effect<TTransaction, WalletError> {
    return this.#v1Context.provingService
      .prove(recipe)
      .pipe(
        Effect.tapError(() =>
          SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
            EitherOps.toEffect(this.#v1Context.transactingCapability.revertRecipe(state, recipe)),
          ),
        ),
      );
  }

  submitTransaction: SubmitTransactionMethod<TTransaction> = ((
    transaction: TTransaction,
    waitForStatus: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
  ) => {
    return this.#v1Context.submissionService
      .submitTransaction(transaction, waitForStatus)
      .pipe(
        Effect.tapError(() =>
          SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
            EitherOps.toEffect(this.#v1Context.transactingCapability.revert(state, transaction)),
          ),
        ),
      );
  }) as SubmitTransactionMethod<TTransaction>;

  serializeState(state: V1State): TSerialized {
    return this.#v1Context.serializationCapability.serialize(state);
  }
}
