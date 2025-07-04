import * as zswap from '@midnight-ntwrk/zswap';

export const TRANSACTION_TO_PROVE = 'TransactionToProve';
export const BALANCE_TRANSACTION_TO_PROVE = 'BalanceTransactionToProve';
export const NOTHING_TO_PROVE = 'NothingToProve';

export type TransactionToProve = {
  readonly type: typeof TRANSACTION_TO_PROVE;
  readonly transaction: zswap.UnprovenTransaction;
};

export type BalanceTransactionToProve<Transaction> = {
  readonly type: typeof BALANCE_TRANSACTION_TO_PROVE;
  readonly transactionToProve: zswap.UnprovenTransaction;
  readonly transactionToBalance: Transaction;
};

export type NothingToProve<Transaction> = {
  readonly type: typeof NOTHING_TO_PROVE;
  readonly transaction: Transaction;
};

export type ProvingRecipe<Transaction> =
  | TransactionToProve
  | BalanceTransactionToProve<Transaction>
  | NothingToProve<Transaction>;
