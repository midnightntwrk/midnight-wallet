package io.iohk.midnight.wallet.core

import cats.effect.IO
import io.iohk.midnight.midnightLedger.mod.{Transaction, ZSwapLocalState}
import io.iohk.midnight.wallet.core.FailingBalanceTransactionServiceStub.error

class BalanceTransactionServiceStub() extends BalanceTransactionService[IO] {
  override def balanceTransaction(
      state: ZSwapLocalState,
      transaction: Transaction,
  ): IO[(Transaction, ZSwapLocalState)] =
    IO.pure((transaction, state))
}

class FailingBalanceTransactionServiceStub() extends BalanceTransactionService[IO] {
  override def balanceTransaction(
      state: ZSwapLocalState,
      transaction: Transaction,
  ): IO[(Transaction, ZSwapLocalState)] =
    IO.raiseError(error)
}

object FailingBalanceTransactionServiceStub {
  val error: Throwable = new Throwable("FailingBalanceTransactionServiceStub")
}
