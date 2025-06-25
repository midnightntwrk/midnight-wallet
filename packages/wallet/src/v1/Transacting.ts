import {
  AppliedTransaction,
  DefaultBalancingCapability,
  DefaultCoinsCapability,
  DefaultTransferCapability,
  JsEither,
  NetworkId,
  WalletError as ScalaWalletError,
} from '@midnight-ntwrk/wallet';
import { ProvingRecipe, TokenTransfer } from '@midnight-ntwrk/wallet-api';
import * as zswap from '@midnight-ntwrk/zswap';
import { Either } from 'effect';
import { EitherOps } from '../effect/index';
import { V1State } from './RunningV1Variant';
import { WalletError } from './WalletError';

/**
 * TODO: Following functions are missing in one way or another:
 * - balanceProofErasedTransaction
 * - balanceUnprovenTransaction
 * - initSwap(state: TState, desiredImbalances: Record<zswap.TokenType, bigint>): { newState: TState; tx: zswap.UnprovenTransaction };
 * - applyFailedProofErasedTransaction
 */
export interface TransactingCapability<TState> {
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

export const makeDefaultTransactingCapability = (): TransactingCapability<V1State> => {
  const applyTransaction = (wallet: V1State, tx: AppliedTransaction<zswap.Transaction>): V1State => {
    return wallet.applyTransaction(tx);
  };

  const getState = (wallet: V1State) => wallet.state;
  const setState = (wallet: V1State, state: zswap.LocalState): V1State => {
    return wallet.applyState(state);
  };

  const getNetworkId = (wallet: V1State): NetworkId => {
    return wallet.networkId;
  };

  const defaultTransacting = DefaultTransferCapability.createV1(applyTransaction, getState, setState, getNetworkId);
  const defaultCoins = DefaultCoinsCapability.createV1<V1State>(
    (wallet) => [...wallet.state.coins],
    (wallet) =>
      [...wallet.state.coins].map((coin) => {
        const [, input] = wallet.state.spend(wallet.secretKeys, coin, 0);
        return input.nullifier;
      }),
    (wallet) => {
      const pendingSpends = new Set([...wallet.state.pendingSpends.values()].map((coin) => coin.nonce));
      return [...wallet.state.coins].filter((coin) => !pendingSpends.has(coin.nonce));
    },
    (wallet) => [...wallet.state.pendingSpends.values()],
  );
  const defaultBalancing = DefaultBalancingCapability.createV1(
    defaultCoins,
    setState,
    (wallet) => wallet.secretKeys,
    getState,
  );

  const resultFromScala: (
    res: Either.Either<{ wallet: V1State; result: ProvingRecipe }, ScalaWalletError>,
  ) => Either.Either<{ recipe: ProvingRecipe; newState: V1State }, WalletError> = Either.mapBoth({
    onLeft: (err) => WalletError.fromScala(err),
    onRight: (result) => ({ recipe: result.result, newState: result.wallet }),
  });

  return {
    balanceTransaction(
      state: V1State,
      tx: zswap.Transaction,
      newCoins: zswap.CoinInfo[],
    ): Either.Either<{ recipe: ProvingRecipe; newState: V1State }, WalletError> {
      return EitherOps.fromScala(defaultBalancing.balanceTransaction(state, JsEither.left(tx), newCoins)).pipe(
        resultFromScala,
      );
    },
    makeTransfer(
      state: V1State,
      outputs: TokenTransfer[],
    ): Either.Either<{ recipe: ProvingRecipe; newState: V1State }, WalletError> {
      return EitherOps.fromScala(defaultTransacting.prepareTransferRecipe(state, outputs)).pipe(
        Either.flatMap((unprovenTx: zswap.UnprovenTransaction) =>
          EitherOps.fromScala(defaultBalancing.balanceTransaction(state, JsEither.right(unprovenTx), [])),
        ),
        resultFromScala,
      );
    },

    //These functions below do not exactly match here, but also seem to be somewhat good place to put
    //The reason is that they primarily make sense in a wallet flavour only able to issue transactions
    applyFailedTransaction(state: V1State, tx: zswap.Transaction): Either.Either<V1State, WalletError> {
      return EitherOps.fromScala(defaultTransacting.applyFailedTransaction(state, tx)).pipe(
        Either.mapLeft((err) => WalletError.fromScala(err)),
      );
    },

    applyFailedUnprovenTransaction(state: V1State, tx: zswap.UnprovenTransaction): Either.Either<V1State, WalletError> {
      return EitherOps.fromScala(defaultTransacting.applyFailedUnprovenTransaction(state, tx)).pipe(
        Either.mapLeft((err) => WalletError.fromScala(err)),
      );
    },
  };
};
