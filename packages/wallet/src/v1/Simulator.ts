// TODO: once rewrite commences - rewire things to ledger package
import * as ledger from '@midnight-ntwrk/ledger';
import { Array as Arr, Effect, Encoding, pipe, Scope, Stream, SubscriptionRef } from 'effect';
import { ArrayOps, EitherOps } from '../effect';
import * as crypto from 'crypto';
import { ProofErasedTransaction } from './Transaction';

export type SimulatorState = Readonly<{
  ledger: ledger.LedgerState;
  lastTx: ProofErasedTransaction;
  lastTxResult: ledger.TransactionResult;
  lastTxNumber: bigint;
}>;

const simpleHash = (input: string): Effect.Effect<string> => {
  return Encoding.decodeHex(input).pipe(
    EitherOps.toEffect,
    Effect.andThen((parsed) => Effect.promise(() => crypto.subtle.digest('SHA-256', parsed))),
    Effect.andThen((out) => Encoding.encodeHex(new Uint8Array(out))),
    Effect.orDie,
  );
};

export class Simulator {
  static nextBlockContext = (number: bigint): Effect.Effect<ledger.BlockContext> =>
    pipe(
      number.toString(16),
      (str) => (str.length % 2 == 0 ? str : str.padStart(str.length + 1, '0')),
      simpleHash,
      Effect.map((hash) => ({
        parentBlockHash: hash,
        secondsSinceEpoch: number,
        secondsSinceEpochErr: 1,
      })),
    );

  static init(
    genesisMints: Readonly<
      Arr.NonEmptyArray<{ amount: bigint; type: ledger.RawTokenType; recipient: ledger.ZswapSecretKeys }>
    >,
  ): Effect.Effect<Simulator, never, Scope.Scope> {
    const makeTransactions = (context: ledger.BlockContext) => {
      const tx = pipe(
        genesisMints,
        Arr.map((transfer) => {
          const coin = ledger.createShieldedCoinInfo(transfer.type, transfer.amount);
          const output = ledger.ZswapOutput.new(
            coin,
            0,
            transfer.recipient.coinPublicKey,
            transfer.recipient.encryptionPublicKey,
          );
          return ledger.ZswapOffer.fromOutput<ledger.PreProof>(output, transfer.type, transfer.amount);
        }),
        ArrayOps.fold((acc, offer) => acc.merge(offer)),
        (offer) => ledger.Transaction.fromParts(offer).eraseProofs(),
      );
      const emptyState = ledger.LedgerState.blank();
      const [initialState, initialResult] = emptyState.apply(tx, new ledger.TransactionContext(emptyState, context));
      return {
        initialResult,
        initialState,
        tx,
      };
    };

    return Effect.gen(function* () {
      const context = yield* Simulator.nextBlockContext(0n);
      const init = makeTransactions(context);
      const initialState = {
        ledger: init.initialState,
        lastTx: init.tx,
        lastTxResult: init.initialResult,
        lastTxNumber: 0n,
      };
      const ref = yield* SubscriptionRef.make<SimulatorState>(initialState);
      const changesStream = yield* Stream.share(ref.changes, {
        capacity: 'unbounded',
        replay: Number.MAX_SAFE_INTEGER,
      });
      yield* pipe(changesStream, Stream.runDrain, Effect.forkScoped);
      return new Simulator(ref, changesStream);
    });
  }

  readonly #stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>;

  readonly state$: Stream.Stream<SimulatorState>;

  constructor(stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>, state$: Stream.Stream<SimulatorState>) {
    this.#stateRef = stateRef;
    this.state$ = state$;
  }

  submitRegularTx(tx: ProofErasedTransaction): Effect.Effect<{ blockNumber: bigint; blockHash: string }> {
    return pipe(
      this.#stateRef,
      SubscriptionRef.modifyEffect((simulatorState) =>
        Effect.gen(function* () {
          const nextNumber = simulatorState.lastTxNumber + 1n;
          const context = yield* Simulator.nextBlockContext(nextNumber);

          const [newState, result] = simulatorState.ledger.apply(
            tx,
            new ledger.TransactionContext(simulatorState.ledger, context),
          );

          const newSimulatorState = {
            ledger: newState,
            lastTx: tx,
            lastTxResult: result,
            lastTxNumber: nextNumber,
          };
          const output = {
            blockNumber: nextNumber,
            blockHash: context.parentBlockHash,
          };

          return [output, newSimulatorState];
        }),
      ),
    );
  }
}
