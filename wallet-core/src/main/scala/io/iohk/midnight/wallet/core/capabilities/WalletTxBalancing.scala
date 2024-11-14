package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionRecipe,
  TokenTransfer,
  TransactionToProve,
}

trait WalletTxBalancing[
    TWallet,
    Transaction,
    UnprovenTransaction,
    Coin,
    TokenType,
] {
  extension (wallet: TWallet) {
    def balanceTransaction(
        transactionWithCoins: (Transaction, Seq[Coin]),
    ): Either[WalletError, (TWallet, BalanceTransactionRecipe[UnprovenTransaction, Transaction])]

    def prepareTransferRecipe(
        outputs: List[TokenTransfer[TokenType]],
    ): Either[WalletError, (TWallet, TransactionToProve[UnprovenTransaction])]

    def applyFailedTransaction(tx: Transaction): Either[WalletError, TWallet]

    def applyFailedUnprovenTransaction(tx: UnprovenTransaction): Either[WalletError, TWallet]
  }
}
