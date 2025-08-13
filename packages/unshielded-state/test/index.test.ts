import { Effect, Either, HashSet, Option } from 'effect';
import { UnshieldedStateService } from '../src/UnshieldedState';
import { UnshieldedTransaction, UtxoNotFoundError } from '../src/model';
import { generateMockTransaction, getLastStateValue, generateMockUtxo } from './testUtils';

/**
 * @TODO: Add tests for:
 * - Failed transaction
 * - Failed transaction with multiple created outputs and spent outputs
 * - Successful transaction apply after spending an utxo (ensure utxos and pending utxos are updated accordingly)
 * - more possible cases/edge cases?
 */
describe('UnshieldedStateService', () => {
  it('should apply a transaction', () =>
    Effect.gen(function* () {
      const unshieldedState = yield* UnshieldedStateService;
      // Create a mock transaction
      const mockTx = generateMockTransaction('owner1', 'type1', 'SucceedEntirely', 1, 0);

      // Apply the transaction
      yield* unshieldedState.applyTx(mockTx);

      // Verify the state was updated
      const stateAfterTx = yield* getLastStateValue(unshieldedState.state);

      expect(Option.isSome(stateAfterTx)).toBe(true);

      if (Option.isSome(stateAfterTx)) {
        const state = stateAfterTx.value;

        expect(HashSet.size(state.utxos)).toEqual(1);
        expect(HashSet.toValues(state.utxos)).toEqual(mockTx.createdUtxos);
        expect(HashSet.size(state.pendingUtxos)).toEqual(0);
      }
    }).pipe(Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should apply transaction with multiple created outputs', () =>
    Effect.gen(function* () {
      const unshieldedState = yield* UnshieldedStateService;
      // Create a mock transaction
      const mockTx = generateMockTransaction('owner1', 'type1', 'SucceedEntirely', 3, 0);

      // Apply the transaction
      yield* unshieldedState.applyTx(mockTx);

      // Verify the state was updated
      const stateAfterTx = yield* getLastStateValue(unshieldedState.state);

      expect(Option.isSome(stateAfterTx)).toBe(true);

      if (Option.isSome(stateAfterTx)) {
        const state = stateAfterTx.value;

        expect(HashSet.size(state.utxos)).toEqual(mockTx.createdUtxos.length);
        expect(HashSet.size(state.pendingUtxos)).toEqual(0);
      }
    }).pipe(Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should spend an utxo', () =>
    Effect.gen(function* () {
      const unshieldedState = yield* UnshieldedStateService;
      // Create a mock transaction
      const mockTx: UnshieldedTransaction = generateMockTransaction('owner1', 'type1', 'SucceedEntirely', 1, 0);

      // Apply the transaction
      yield* unshieldedState.applyTx(mockTx);

      // Verify the state was updated
      const stateAfterTx = yield* getLastStateValue(unshieldedState.state);
      expect(Option.isSome(stateAfterTx)).toBe(true);
      if (Option.isSome(stateAfterTx)) {
        const state = stateAfterTx.value;
        expect(HashSet.size(state.utxos)).toEqual(1);
        expect(HashSet.size(state.pendingUtxos)).toEqual(0);
      }

      // Spend the utxo
      yield* unshieldedState.spend(mockTx.createdUtxos[0]);

      // Verify the state was updated
      const stateAfterSpend = yield* getLastStateValue(unshieldedState.state);

      expect(Option.isSome(stateAfterSpend)).toBe(true);

      if (Option.isSome(stateAfterSpend)) {
        const state = stateAfterSpend.value;
        expect(HashSet.size(state.utxos)).toEqual(0);
        expect(HashSet.size(state.pendingUtxos)).toEqual(1);
      }
    }).pipe(Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should fail to spend an utxo that does not exist', () =>
    Effect.gen(function* () {
      const unshieldedState = yield* UnshieldedStateService;
      // Create a mock transaction
      const mockTx: UnshieldedTransaction = generateMockTransaction('owner1', 'type1', 'SucceedEntirely', 1, 0);

      // Apply the transaction
      yield* unshieldedState.applyTx(mockTx);

      // Verify the state was updated
      const stateAfterTx = yield* getLastStateValue(unshieldedState.state);
      expect(Option.isSome(stateAfterTx)).toBe(true);
      if (Option.isSome(stateAfterTx)) {
        const state = stateAfterTx.value;
        expect(HashSet.size(state.utxos)).toEqual(1);
        expect(HashSet.size(state.pendingUtxos)).toEqual(0);
      }

      // Create a mock utxo that does not exist in the state
      const mockUtxo = generateMockUtxo('owner21', 'type12');

      // try to spend the utxo
      const result = yield* Effect.either(unshieldedState.spend(mockUtxo));

      Either.match(result, {
        onLeft: (error) => {
          expect(error).toBeInstanceOf(UtxoNotFoundError);
        },
        onRight: () => {
          throw new Error('Expected error when spending a utxo that does not exist, got success.');
        },
      });
    }).pipe(Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should rollback a transaction', () =>
    Effect.gen(function* () {
      const unshieldedState = yield* UnshieldedStateService;
      // Create a mock transaction
      const mockTx: UnshieldedTransaction = generateMockTransaction('owner1', 'type1', 'SucceedEntirely', 1, 0);

      // Apply the transaction
      yield* unshieldedState.applyTx(mockTx);

      // Verify the state was updated
      const stateAfterTx = yield* getLastStateValue(unshieldedState.state);
      expect(Option.isSome(stateAfterTx)).toBe(true);
      if (Option.isSome(stateAfterTx)) {
        const state = stateAfterTx.value;
        expect(HashSet.size(state.utxos)).toEqual(1);
        expect(HashSet.size(state.pendingUtxos)).toEqual(0);
      }

      // spend a utxo to create a pending state
      yield* unshieldedState.spend(mockTx.createdUtxos[0]);

      // Verify the state was updated
      const stateAfterSpend = yield* getLastStateValue(unshieldedState.state);
      expect(Option.isSome(stateAfterSpend)).toBe(true);
      if (Option.isSome(stateAfterSpend)) {
        const state = stateAfterSpend.value;
        expect(HashSet.size(state.utxos)).toEqual(0);
        expect(HashSet.size(state.pendingUtxos)).toEqual(1);
      }

      // Create a mock transaction that we'll use to rollback
      // This transaction will have the utxo we spent in the previous step as a spent utxo
      // and no created utxos, simulating a rollback scenario.
      const rollbackTx = {
        ...mockTx,
        createdUtxos: [],
        spentUtxos: [mockTx.createdUtxos[0]],
      };

      // Rollback the transaction
      yield* unshieldedState.rollbackTx(rollbackTx);

      // Verify the state was rolled back
      const stateAfterRollback = yield* getLastStateValue(unshieldedState.state);

      expect(Option.isSome(stateAfterRollback)).toBe(true);
      if (Option.isSome(stateAfterRollback)) {
        const state = stateAfterRollback.value;
        expect(HashSet.size(state.utxos)).toEqual(1);
        expect(HashSet.size(state.pendingUtxos)).toEqual(0);
      }
    }).pipe(Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should apply a failed transaction', () =>
    Effect.gen(function* () {
      const unshieldedState = yield* UnshieldedStateService;
      // Create a mock transaction
      const mockTx: UnshieldedTransaction = generateMockTransaction('owner1', 'type1', 'SucceedEntirely', 1, 0);

      // Apply the transaction
      yield* unshieldedState.applyTx(mockTx);

      // Verify the state was updated
      const stateAfterTx = yield* getLastStateValue(unshieldedState.state);
      expect(Option.isSome(stateAfterTx)).toBe(true);
      if (Option.isSome(stateAfterTx)) {
        const state = stateAfterTx.value;
        expect(HashSet.size(state.utxos)).toEqual(1);
        expect(HashSet.size(state.pendingUtxos)).toEqual(0);
      }

      // spend a utxo to create a pending state
      yield* unshieldedState.spend(mockTx.createdUtxos[0]);

      // Verify the state was updated
      const stateAfterSpend = yield* getLastStateValue(unshieldedState.state);
      expect(Option.isSome(stateAfterSpend)).toBe(true);
      if (Option.isSome(stateAfterSpend)) {
        const state = stateAfterSpend.value;
        expect(HashSet.size(state.utxos)).toEqual(0);
        expect(HashSet.size(state.pendingUtxos)).toEqual(1);
      }

      // Create a mock transaction that we'll use to apply as failed
      // This transaction will have the utxo we spent in the previous step as a spent utxo
      // and no created utxos, simulating a rollback scenario.
      const failedTx = {
        ...mockTx,
        transactionResult: {
          ...mockTx.transactionResult,
          status: 'FailedEntirely',
        },
        createdUtxos: [],
        spentUtxos: [mockTx.createdUtxos[0]],
      };

      // Rollback the transaction
      yield* unshieldedState.applyFailedTx(failedTx);

      // Verify the state was updated
      const stateAfterFailed = yield* getLastStateValue(unshieldedState.state);

      expect(Option.isSome(stateAfterFailed)).toBe(true);
      if (Option.isSome(stateAfterFailed)) {
        const state = stateAfterFailed.value;
        expect(HashSet.size(state.utxos)).toEqual(1);
        expect(HashSet.size(state.pendingUtxos)).toEqual(0);
      }
    }).pipe(Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));

  it('should initialize with state', () =>
    Effect.gen(function* () {
      const unshieldedState = yield* UnshieldedStateService;
      const mockTx = generateMockTransaction('owner1', 'type1', 'SucceedEntirely', 1, 0);
      yield* unshieldedState.applyTx(mockTx);
      yield* unshieldedState.updateSyncProgress(mockTx.id);
      const state = yield* unshieldedState.getLatestState();

      yield* Effect.gen(function* () {
        const unshieldedStateFromSerialized = yield* UnshieldedStateService;
        const restoredState = yield* unshieldedStateFromSerialized.getLatestState();

        expect(HashSet.size(restoredState.utxos)).toEqual(1);
        expect(HashSet.toValues(restoredState.utxos)).toEqual(mockTx.createdUtxos);
        expect(HashSet.size(restoredState.pendingUtxos)).toEqual(0);
        expect(restoredState.syncProgress).toBeDefined();
        expect(restoredState.syncProgress?.highestTransactionId).toEqual(mockTx.id);
        expect(restoredState.syncProgress?.currentTransactionId).toEqual(mockTx.id);
      }).pipe(Effect.provide(UnshieldedStateService.LiveWithState(state)));
    }).pipe(Effect.provide(UnshieldedStateService.Live()), Effect.runPromise));
});
