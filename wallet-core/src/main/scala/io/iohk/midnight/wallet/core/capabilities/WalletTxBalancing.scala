package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionToProve,
  NothingToProve,
  TransactionToProve,
}

trait WalletTxBalancing[
    TWallet,
    Transaction,
    UnprovenTransaction,
    CoinInfo,
] {
  def balanceTransaction(
      wallet: TWallet,
      transactionWithCoins: (Either[Transaction, UnprovenTransaction], Seq[CoinInfo]),
  ): Either[
    WalletError,
    (
        TWallet,
        (TransactionToProve[UnprovenTransaction] |
          BalanceTransactionToProve[UnprovenTransaction, Transaction] |
          NothingToProve[UnprovenTransaction, Transaction]),
    ),
  ]
}
