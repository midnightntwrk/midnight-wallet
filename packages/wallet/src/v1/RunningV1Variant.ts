import * as ledger from '@midnight-ntwrk/ledger';
import { Array as Arr, Effect, pipe, Record, Scope, Stream, SubscriptionRef, Schedule, Duration } from 'effect';
import { StateChange, VersionChangeType, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletRuntimeError, Variant } from '../abstractions/index';
import { EitherOps } from '../effect/index';
import { ProvingService } from './Proving';
import { ProvingRecipe } from './ProvingRecipe';
import { SerializationCapability } from './Serialization';
import { SyncCapability, SyncService, WalletSyncSubscription } from './Sync';
import { TransactingCapability, TokenTransfer } from './Transacting';
import { OtherWalletError, WalletError } from './WalletError';
import { CoinsAndBalancesCapability } from './CoinsAndBalances';
import { KeysCapability } from './Keys';
import { SubmissionService, SubmitTransactionMethod } from './Submission';
import { CoinSelection } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { CoreWallet } from './CoreWallet';
import { TransactionHistoryCapability } from './TransactionHistory';
import { FinalizedTransaction } from './types/ledger';

const progress = (state: V1State): StateChange.StateChange<V1State>[] => {
  if (!state.isConnected) return [];

  const appliedIndex = state.progress?.appliedIndex ?? 0n;
  const highestRelevantWalletIndex = state.progress?.highestRelevantWalletIndex ?? 0n;
  const highestIndex = state.progress?.highestIndex ?? 0n;
  const highestRelevantIndex = state.progress?.highestRelevantIndex ?? 0n;

  const sourceGap = highestIndex - highestRelevantIndex;
  const applyGap = highestRelevantWalletIndex - appliedIndex;

  return [StateChange.ProgressUpdate({ sourceGap, applyGap })];
};

const protocolVersionChange = (previous: V1State, current: V1State): StateChange.StateChange<V1State>[] => {
  return previous.protocolVersion != current.protocolVersion
    ? [
        StateChange.VersionChange({
          change: VersionChangeType.Version({
            version: ProtocolVersion.ProtocolVersion(current.protocolVersion),
          }),
        }),
      ]
    : [];
};

export type V1State = CoreWallet;
export const V1State = new (class {
  initEmpty = (keys: ledger.ZswapSecretKeys, networkId: ledger.NetworkId): V1State => {
    return CoreWallet.empty(new ledger.ZswapLocalState(), keys, networkId);
  };

  init = (state: ledger.ZswapLocalState, keys: ledger.ZswapSecretKeys, networkId: ledger.NetworkId): V1State => {
    return CoreWallet.empty(state, keys, networkId);
  };

  spendCoins = (
    state: V1State,
    coins: ReadonlyArray<ledger.QualifiedShieldedCoinInfo>,
    segment: 0 | 1,
  ): [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, V1State] => {
    const [output, newLocalState] = pipe(
      coins,
      Arr.reduce(
        [[], state.state] as [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, ledger.ZswapLocalState],
        (
          [offers, localState]: [ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>, ledger.ZswapLocalState],
          coinToSpend,
        ) => {
          const [newState, newInput] = localState.spend(state.secretKeys, coinToSpend, segment);
          const inputOffer = ledger.ZswapOffer.fromInput(newInput, coinToSpend.type, coinToSpend.value);
          return [offers.concat([inputOffer]), newState] as [
            ReadonlyArray<ledger.ZswapOffer<ledger.PreProof>>,
            ledger.ZswapLocalState,
          ];
        },
      ),
    );
    const updatedState = new CoreWallet(
      newLocalState,
      state.secretKeys,
      state.networkId,
      state.txHistoryArray,
      state.progress,
      state.protocolVersion,
    );
    return [output, updatedState];
  };

  watchCoins = (state: V1State, coins: ReadonlyArray<ledger.ShieldedCoinInfo>): V1State => {
    const newLocalState = coins.reduce(
      (localState: ledger.ZswapLocalState, coin) => localState.watchFor(state.secretKeys.coinPublicKey, coin),
      state.state,
    );

    return new CoreWallet(
      newLocalState,
      state.secretKeys,
      state.networkId,
      state.txHistoryArray,
      state.progress,
      state.protocolVersion,
    );
  };
})();

export declare namespace RunningV1Variant {
  export type Context<TSerialized, TSyncUpdate, TTransaction> = {
    serializationCapability: SerializationCapability<V1State, ledger.ZswapSecretKeys, TSerialized>;
    syncService: SyncService<V1State, TSyncUpdate>;
    syncCapability: SyncCapability<V1State, TSyncUpdate>;
    transactingCapability: TransactingCapability<V1State, TTransaction>;
    provingService: ProvingService<TTransaction>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<V1State>;
    keysCapability: KeysCapability<V1State>;
    submissionService: SubmissionService<TTransaction>;
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>;
    transactionHistoryCapability: TransactionHistoryCapability<V1State, TTransaction>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyContext = Context<any, any, any>;
}

export const V1Tag: unique symbol = Symbol('V1');

export type DefaultRunningV1 = RunningV1Variant<string, WalletSyncSubscription, FinalizedTransaction>;

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

  startSync(): Stream.Stream<void, WalletError, Scope.Scope> {
    return pipe(
      SubscriptionRef.get(this.#context.stateRef),
      Stream.fromEffect,
      Stream.flatMap((state) => this.#v1Context.syncService.updates(state)),
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
      Stream.retry(
        pipe(
          Schedule.exponential(Duration.seconds(1), 2),
          Schedule.map((delay) => {
            const maxDelay = Duration.minutes(2);
            const jitter = Duration.millis(Math.floor(Math.random() * 1000));
            const delayWithJitter = Duration.toMillis(delay) + Duration.toMillis(jitter);

            return Duration.millis(Math.min(delayWithJitter, Duration.toMillis(maxDelay)));
          }),
        ),
      ),
    );
  }

  balanceTransaction(
    tx: TTransaction,
    newCoins: readonly ledger.ShieldedCoinInfo[],
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
    desiredInputs: Record<ledger.RawTokenType, bigint>,
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
