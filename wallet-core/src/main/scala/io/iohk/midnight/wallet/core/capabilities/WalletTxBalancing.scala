package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionRecipe,
  TokenTransfer,
  TransactionToProve,
}

trait WalletTxBalancing[
    TWallet,
    TTransaction,
    TUnprovenTransaction,
    TCoin,
] {
  def balanceTransaction(
      wallet: TWallet,
      transactionWithCoins: (TTransaction, Seq[TCoin]),
  ): Either[WalletError, (TWallet, BalanceTransactionRecipe)]

  def prepareTransferRecipe(
      wallet: TWallet,
      outputs: List[TokenTransfer],
  ): Either[WalletError, (TWallet, TransactionToProve)]

  def applyFailedTransaction(wallet: TWallet, tx: TTransaction): Either[WalletError, TWallet]

  def applyFailedUnprovenTransaction(
      wallet: TWallet,
      tx: TUnprovenTransaction,
  ): Either[WalletError, TWallet]
}
