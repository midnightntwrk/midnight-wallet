package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.util.BetterOutputSuite

trait WalletTransactionProcessingSpec[TWallet, TTransaction] extends BetterOutputSuite {

  val walletTransactionProcessing: WalletTransactionProcessing[TWallet, TTransaction]
  val walletForTransactions: TWallet
  val validTransactionToApply: TTransaction
  val transactionToApplyWithBadFormatTx: TTransaction
  val isTransactionApplied: TWallet => Boolean

  test("apply transaction to the wallet") {
    val isApplied =
      walletTransactionProcessing
        .applyTransaction(walletForTransactions, validTransactionToApply)
        .map(isTransactionApplied)
    assert(isApplied.getOrElse(false))
  }

  test("return error for transaction with bad format") {
    val error = walletTransactionProcessing.applyTransaction(
      walletForTransactions,
      transactionToApplyWithBadFormatTx,
    )
    assert(error.isLeft)
  }

}
