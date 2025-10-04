import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Effect, pipe, Record, Scope, Stream, SubscriptionRef, Schedule, Duration, Sink, Console } from 'effect';
import { StateChange, VersionChangeType, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletRuntimeError, Variant } from '../abstractions/index';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { ProvingService } from './Proving';
import { ProvingRecipe } from './ProvingRecipe';
import { SerializationCapability } from './Serialization';
import { EventsSyncUpdate, SyncCapability, SyncService } from './Sync';
import { TransactingCapability, TokenTransfer } from './Transacting';
import { OtherWalletError, WalletError } from './WalletError';
import { CoinsAndBalancesCapability } from './CoinsAndBalances';
import { KeysCapability } from './Keys';
import { SubmissionService, SubmitTransactionMethod } from './Submission';
import { CoinSelection } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { CoreWallet } from './CoreWallet';
import { TransactionHistoryCapability } from './TransactionHistory';

const progress = (state: CoreWallet): StateChange.StateChange<CoreWallet>[] => {
  const appliedIndex = state.progress?.appliedIndex ?? 0n;
  const highestRelevantWalletIndex = state.progress?.highestRelevantWalletIndex ?? 0n;
  const highestIndex = state.progress?.highestIndex ?? 0n;
  const highestRelevantIndex = state.progress?.highestRelevantIndex ?? 0n;

  const sourceGap = highestIndex - highestRelevantIndex;
  const applyGap = highestRelevantWalletIndex - appliedIndex;

  return [StateChange.ProgressUpdate({ sourceGap, applyGap })];
};

const protocolVersionChange = (previous: CoreWallet, current: CoreWallet): StateChange.StateChange<CoreWallet>[] => {
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

export declare namespace RunningV1Variant {
  export type Context<TSerialized, TSyncUpdate, TTransaction, TStartAux> = {
    serializationCapability: SerializationCapability<CoreWallet, null, TSerialized>;
    syncService: SyncService<CoreWallet, TStartAux, TSyncUpdate>;
    syncCapability: SyncCapability<CoreWallet, TSyncUpdate>;
    transactingCapability: TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, TTransaction>;
    provingService: ProvingService<TTransaction>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
    keysCapability: KeysCapability<CoreWallet>;
    submissionService: SubmissionService<TTransaction>;
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>;
    transactionHistoryCapability: TransactionHistoryCapability<CoreWallet, TTransaction>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyContext = Context<any, any, any, any>;
}

export const V1Tag: unique symbol = Symbol('V1');

export type DefaultRunningV1 = RunningV1Variant<
  string,
  EventsSyncUpdate,
  ledger.FinalizedTransaction,
  ledger.ZswapSecretKeys
>;

export class RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>
  implements Variant.RunningVariant<typeof V1Tag, CoreWallet>
{
  readonly __polyTag__: typeof V1Tag = V1Tag;
  readonly #scope: Scope.Scope;
  readonly #context: Variant.VariantContext<CoreWallet>;
  readonly #v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>;

  readonly state: Stream.Stream<StateChange.StateChange<CoreWallet>, WalletRuntimeError>;

  constructor(
    scope: Scope.Scope,
    context: Variant.VariantContext<CoreWallet>,
    v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
  ) {
    this.#scope = scope;
    this.#context = context;
    this.#v1Context = v1Context;
    this.state = Stream.fromEffect(context.stateRef.get).pipe(
      Stream.flatMap((initialState) =>
        context.stateRef.changes.pipe(
          Stream.mapAccum(initialState, (previous: CoreWallet, current: CoreWallet) => {
            return [current, [previous, current]] as const;
          }),
        ),
      ),
      Stream.mapConcat(
        ([previous, current]: readonly [CoreWallet, CoreWallet]): StateChange.StateChange<CoreWallet>[] => {
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

  startSyncInBackground(startAux: TStartAux): Effect.Effect<void> {
    return this.startSync(startAux).pipe(
      Stream.runScoped(Sink.drain),
      Effect.forkScoped,
      Effect.provideService(Scope.Scope, this.#scope),
    );
  }

  startSync(startAux: TStartAux): Stream.Stream<void, WalletError, Scope.Scope> {
    return pipe(
      SubscriptionRef.get(this.#context.stateRef),
      Stream.fromEffect,
      Stream.flatMap((state) => this.#v1Context.syncService.updates(state, startAux)),
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
      Stream.tapError((error) => Console.error(error)),
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
    secretKeys: ledger.ZswapSecretKeys,
    tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    newCoins: readonly ledger.ShieldedCoinInfo[],
  ): Effect.Effect<ProvingRecipe<TTransaction>, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.balanceTransaction(secretKeys, state, tx, newCoins),
        EitherOps.toEffect,
        Effect.map(({ recipe, newState }) => [recipe, newState] as const),
      );
    });
  }

  transferTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    outputs: ReadonlyArray<TokenTransfer>,
  ): Effect.Effect<ProvingRecipe<TTransaction>, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.makeTransfer(secretKeys, state, outputs),
        EitherOps.toEffect,
        Effect.map(({ recipe, newState }) => [recipe, newState] as const),
      );
    });
  }

  initSwap(
    secretKeys: ledger.ZswapSecretKeys,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Effect.Effect<ProvingRecipe<TTransaction>, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.initSwap(secretKeys, state, desiredInputs, desiredOutputs),
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

  serializeState(state: CoreWallet): TSerialized {
    return this.#v1Context.serializationCapability.serialize(state);
  }
}
