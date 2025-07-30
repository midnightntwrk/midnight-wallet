// TODO: once rewrite commences - rewire things to ledger package
import * as ledger from '@midnight-ntwrk/ledger';
import { Array as EArray, Effect, Encoding, pipe, Stream, SubscriptionRef } from 'effect';
import { EitherOps, NonEmptyArrayOps } from '../effect';
import * as zswap from '@midnight-ntwrk/zswap';
import * as crypto from 'crypto';

export type SimulatorState = Readonly<{
  ledger: ledger.LedgerState;
  lastTx: ledger.ProofErasedTransaction;
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
    simpleHash(number.toString(16)).pipe(
      Effect.map((hash) => ({
        blockHash: hash,
        secondsSinceEpoch: number,
        secondsSinceEpochErr: 1,
      })),
    );

  static init(
    genesisMints: Readonly<
      EArray.NonEmptyArray<{ amount: bigint; type: ledger.TokenType; recipient: zswap.SecretKeys }>
    >,
  ): Effect.Effect<Simulator> {
    const makeTransactions = (context: ledger.BlockContext) => {
      const tx = pipe(
        genesisMints,
        EArray.map((transfer) => {
          const coin: ledger.CoinInfo = ledger.createCoinInfo(transfer.type, transfer.amount);
          const output = ledger.UnprovenOutput.new(
            coin,
            0,
            transfer.recipient.coinPublicKey,
            transfer.recipient.encryptionPublicKey,
          );
          return ledger.UnprovenOffer.fromOutput(output, transfer.type, transfer.amount);
        }),
        NonEmptyArrayOps.fold((acc: ledger.UnprovenOffer, offer: ledger.UnprovenOffer) => acc.merge(offer)),
        (offer) => new ledger.UnprovenTransaction(offer).eraseProofs(),
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
      return new Simulator(ref);
    });
  }

  #stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>;

  state$: Stream.Stream<SimulatorState>;

  constructor(stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>) {
    this.#stateRef = stateRef;
    this.state$ = stateRef.changes;
  }

  submitRegularTx(tx: ledger.ProofErasedTransaction): Effect.Effect<{ blockNumber: bigint; blockHash: string }> {
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
            blockHash: context.blockHash,
          };

          return [output, newSimulatorState];
        }),
      ),
    );
  }
}
