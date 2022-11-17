package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import io.iohk.midnight.wallet.core.services.FailingBalanceTransactionServiceStub.error
import typings.midnightLedger.mod.{Transaction, ZSwapLocalState}

class BalanceTransactionServiceStub() extends BalanceTransactionService[IO] {
  override def balanceTransaction(transaction: Transaction): IO[(Transaction, ZSwapLocalState)] =
    IO.pure((transaction, new ZSwapLocalState()))
}

class FailingBalanceTransactionServiceStub() extends BalanceTransactionService[IO] {
  override def balanceTransaction(transaction: Transaction): IO[(Transaction, ZSwapLocalState)] =
    IO.raiseError(error)
}

object FailingBalanceTransactionServiceStub {
  val error: Throwable = new Throwable("FailingBalanceTransactionServiceStub")
}
