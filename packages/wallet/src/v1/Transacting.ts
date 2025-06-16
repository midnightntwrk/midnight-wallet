import { ProvingRecipe, TokenTransfer } from '@midnight-ntwrk/wallet-api';
import * as zswap from '@midnight-ntwrk/zswap';
import { Either } from 'effect';
import { WalletError } from './WalletError';

/**
 * TODO: Following functions are missing in one way or another:
 * - balanceProofErasedTransaction
 * - balanceUnprovenTransaction
 * - initSwap(state: TState, desiredImbalances: Record<zswap.TokenType, bigint>): { newState: TState; tx: zswap.UnprovenTransaction };
 * - applyFailedProofErasedTransaction
 */
export declare namespace TransactingCapability {
  interface Service<TState> {
    balanceTransaction(
      state: TState,
      tx: zswap.Transaction,
      newCoins: zswap.CoinInfo[],
    ): Either.Either<{ recipe: ProvingRecipe; newState: TState }, WalletError>;

    makeTransfer(
      state: TState,
      outputs: ReadonlyArray<TokenTransfer>,
    ): Either.Either<{ recipe: ProvingRecipe; newState: TState }, WalletError>;

    //These functions below do not exactly match here, but also seem to be somewhat good place to put
    //The reason is that they primarily make sense in a wallet flavour only able to issue transactions
    applyFailedTransaction(state: TState, tx: zswap.Transaction): Either.Either<TState, WalletError>;

    applyFailedUnprovenTransaction(state: TState, tx: zswap.UnprovenTransaction): Either.Either<TState, WalletError>;
  }
}
