package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionRecipe,
  TransactionToProve,
  TokenTransfer,
}

trait WalletTxBalancing[TWallet, TTransaction, TCoin] {
  def balanceTransaction(
      wallet: TWallet,
      transactionWithCoins: (TTransaction, Seq[TCoin]),
  ): Either[WalletError, (TWallet, BalanceTransactionRecipe)]

  def prepareTransferRecipe(
      wallet: TWallet,
      outputs: List[TokenTransfer],
  ): Either[WalletError, (TWallet, TransactionToProve)]
}
