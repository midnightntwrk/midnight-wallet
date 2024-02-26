package io.iohk.midnight.wallet.core.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.AsStringLogContext
import io.iohk.midnight.tracer.logging.Event
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.WalletError

sealed trait BalanceTransactionEvent

object BalanceTransactionEvent {

  final case class BalanceTransactionStart(tx: data.Transaction) extends BalanceTransactionEvent

  object BalanceTransactionStart {
    val id: Event.Id[BalanceTransactionStart] = Event.Id("balance_transaction_start")
  }

  final case class BalanceTransactionSuccess(tx: data.Transaction) extends BalanceTransactionEvent

  object BalanceTransactionSuccess {
    val id: Event.Id[BalanceTransactionSuccess] = Event.Id("balance_transaction_success")
  }

  final case class BalanceTransactionError(
      tx: data.Transaction,
      error: WalletError,
  ) extends BalanceTransactionEvent

  object BalanceTransactionError {
    val id: Event.Id[BalanceTransactionError] = Event.Id("balance_transaction_error")
  }

  object DefaultInstances {

    implicit val balanceTxStartContext: AsStringLogContext[BalanceTransactionStart] =
      AsStringLogContext.fromEvent(evt => "transaction" -> evt.tx.show)
    implicit val balanceTxSuccessContext: AsStringLogContext[BalanceTransactionSuccess] =
      AsStringLogContext.fromEvent(evt => "updated_transaction" -> evt.tx.show)
    implicit val balanceTxErrorContext: AsStringLogContext[BalanceTransactionError] =
      AsStringLogContext.fromEvent(
        evt => "transaction_hash" -> evt.tx.hash.show,
        evt => "error" -> evt.error.message,
      )

  }

}
