// TODO: once rewrite commences - rewire things to ledger package
import * as ledger from '@midnight-ntwrk/ledger';
import { Array as EArray, Effect, pipe, Stream, SubscriptionRef } from 'effect';
import { NonEmptyArrayOps } from '../effect';
import * as zswap from '@midnight-ntwrk/zswap';

export type SimulatorState = Readonly<{
  ledger: ledger.LedgerState;
  lastTx: ledger.ProofErasedTransaction;
  lastTxResult: ledger.TransactionResult;
}>;

export class Simulator {
  static mockBlockContext: ledger.BlockContext = {
    blockHash: Buffer.alloc(32, 0).toString('hex'),
    secondsSinceEpoch: 1n,
    secondsSinceEpochErr: 1,
  };

  static init(
    genesisMints: Readonly<
      EArray.NonEmptyArray<{ amount: bigint; type: ledger.TokenType; recipient: zswap.SecretKeys }>
    >,
  ): Effect.Effect<Simulator> {
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
    const [initialState, initialResult] = emptyState.apply(
      tx,
      new ledger.TransactionContext(emptyState, Simulator.mockBlockContext),
    );

    return SubscriptionRef.make<SimulatorState>({
      ledger: initialState,
      lastTx: tx,
      lastTxResult: initialResult,
    }).pipe(Effect.map((stateRef) => new Simulator(stateRef)));
  }

  #stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>;

  state$: Stream.Stream<SimulatorState>;

  constructor(stateRef: SubscriptionRef.SubscriptionRef<SimulatorState>) {
    this.#stateRef = stateRef;
    this.state$ = stateRef.changes;
  }

  submitRegularTx(tx: ledger.ProofErasedTransaction): Effect.Effect<void> {
    return pipe(
      this.#stateRef,
      SubscriptionRef.update((simulatorState) => {
        const [newState, result] = simulatorState.ledger.apply(
          tx,
          new ledger.TransactionContext(simulatorState.ledger, Simulator.mockBlockContext),
        );

        return {
          ledger: newState,
          lastTx: tx,
          lastTxResult: result,
        };
      }),
    );
  }
}
