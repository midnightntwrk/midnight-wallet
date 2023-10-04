package io.iohk.midnight.wallet.core.capabilities

import cats.effect.IO
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.CatsEffectSuite

trait WalletTransactionProcessingSpec[TWallet, TTransaction]
    extends CatsEffectSuite
    with BetterOutputSuite {

  val walletTransactionProcessing: WalletTransactionProcessing[TWallet, TTransaction]
  val walletForTransactions: IO[TWallet]
  val validTransactionToApply: IO[TTransaction]
  val transactionToApplyWithBadFormatTx: TTransaction
  val isTransactionApplied: TWallet => Boolean

  test("apply transaction to the wallet") {
    walletForTransactions.product(validTransactionToApply).map { (wallet, tx) =>
      val isApplied =
        walletTransactionProcessing
          .applyTransaction(wallet, tx)
          .map(isTransactionApplied)
      assert(isApplied.getOrElse(false))
    }
  }

  test("return error for transaction with bad format") {
    walletForTransactions.map { wallet =>
      val error = walletTransactionProcessing.applyTransaction(
        wallet,
        transactionToApplyWithBadFormatTx,
      )
      assert(error.isLeft)
    }
  }

}
