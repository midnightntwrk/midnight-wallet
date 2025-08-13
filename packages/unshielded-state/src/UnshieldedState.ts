import { Context, Effect, Layer, HashSet, SubscriptionRef } from 'effect';
import { ParseError } from 'effect/ParseResult';
import {
  ApplyTransactionError,
  RollbackError,
  UnshieldedStateAPI,
  UnshieldedState,
  UnshieldedTransaction,
  Utxo,
  UtxoNotFoundError,
} from './model';

export class UnshieldedStateService extends Context.Tag('@midnight-ntwrk/wallet-sdk-unshielded-state')<
  UnshieldedStateService,
  UnshieldedStateAPI
>() {
  private static createService = (stateRef: SubscriptionRef.SubscriptionRef<UnshieldedState>) => {
    const applyTx = (tx: UnshieldedTransaction): Effect.Effect<void, ParseError | ApplyTransactionError> =>
      SubscriptionRef.updateEffect(stateRef, (state) =>
        Effect.gen(function* () {
          const { createdUtxos, spentUtxos, transactionResult, id } = tx;

          if (transactionResult.status === 'FailedEntirely') {
            return yield* Effect.fail(
              new ApplyTransactionError({
                tx: tx,
                message: `Cannot apply failed a transaction with status: ${transactionResult.status}`,
              }),
            );
          }
          // @TODO: Handle partial success
          return {
            ...state,
            utxos: HashSet.union(state.utxos, HashSet.fromIterable(createdUtxos)),
            pendingUtxos: HashSet.difference(state.pendingUtxos, HashSet.fromIterable(spentUtxos)),
            syncProgress: {
              highestTransactionId: state.syncProgress?.highestTransactionId ?? 0,
              currentTransactionId: id,
            },
          };
        }),
      );

    const applyFailedTx = (tx: UnshieldedTransaction): Effect.Effect<void, ParseError | ApplyTransactionError> =>
      SubscriptionRef.updateEffect(stateRef, (state) =>
        Effect.gen(function* () {
          const { spentUtxos, transactionResult } = tx;

          if (transactionResult.status !== 'FailedEntirely') {
            return yield* Effect.fail(
              new ApplyTransactionError({
                tx: tx,
                message: `Cannot apply failed a transaction with status: ${transactionResult.status}`,
              }),
            );
          }

          return {
            ...state,
            utxos: HashSet.union(state.utxos, HashSet.fromIterable(spentUtxos)),
            pendingUtxos: HashSet.difference(state.pendingUtxos, HashSet.fromIterable(spentUtxos)),
          };
        }),
      );

    const spend = (utxoToSpend: Utxo): Effect.Effect<void, UtxoNotFoundError | ParseError> =>
      SubscriptionRef.updateEffect(stateRef, (state) =>
        Effect.gen(function* () {
          const utxo = utxoToSpend;

          if (!HashSet.has(state.utxos, utxo)) {
            return yield* Effect.fail(new UtxoNotFoundError({ utxo: utxoToSpend }));
          }

          return {
            ...state,
            utxos: HashSet.remove(state.utxos, utxo),
            pendingUtxos: HashSet.add(state.pendingUtxos, utxo),
          };
        }),
      );

    const updateSyncProgress = (highestTransactionId: number): Effect.Effect<void> =>
      SubscriptionRef.update(stateRef, (state) => ({
        ...state,
        syncProgress: {
          highestTransactionId,
          currentTransactionId: state?.syncProgress?.currentTransactionId ?? 0,
        },
      }));

    const rollbackTx = (tx: UnshieldedTransaction): Effect.Effect<void, ParseError | RollbackError> =>
      SubscriptionRef.updateEffect(stateRef, (state) => {
        const { spentUtxos } = tx;

        return Effect.succeed({
          ...state,
          utxos: HashSet.union(state.utxos, HashSet.fromIterable(spentUtxos)),
          pendingUtxos: HashSet.difference(state.pendingUtxos, HashSet.fromIterable(spentUtxos)),
        });
      });

    return UnshieldedStateService.of({
      state: stateRef.changes,
      getLatestState: () => SubscriptionRef.get(stateRef),
      applyTx,
      applyFailedTx,
      spend,
      updateSyncProgress,
      rollbackTx,
    });
  };

  static readonly Live = (): Layer.Layer<UnshieldedStateService, ParseError> =>
    Layer.effect(
      UnshieldedStateService,
      Effect.gen(function* () {
        const initialState: UnshieldedState = {
          utxos: HashSet.empty<Utxo>(),
          pendingUtxos: HashSet.empty<Utxo>(),
          syncProgress: undefined,
        };

        const stateRef = yield* SubscriptionRef.make<UnshieldedState>(initialState);
        return UnshieldedStateService.createService(stateRef);
      }),
    );

  static readonly LiveWithState = (initialState: UnshieldedState): Layer.Layer<UnshieldedStateService, ParseError> =>
    Layer.effect(
      UnshieldedStateService,
      Effect.gen(function* () {
        const stateRef = yield* SubscriptionRef.make<UnshieldedState>(initialState);
        return UnshieldedStateService.createService(stateRef);
      }),
    );
}
