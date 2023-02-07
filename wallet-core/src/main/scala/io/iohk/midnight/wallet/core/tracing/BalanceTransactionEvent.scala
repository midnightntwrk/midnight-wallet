package io.iohk.midnight.wallet.core.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.AsStringLogContext
import io.iohk.midnight.tracer.logging.Event
import io.iohk.midnight.wallet.blockchain.data

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
      error: Throwable,
  ) extends BalanceTransactionEvent

  object BalanceTransactionError {
    val id: Event.Id[BalanceTransactionError] = Event.Id("balance_transaction_error")
  }

  object DefaultInstances {

    implicit val balanceTxStartContext: AsStringLogContext[BalanceTransactionStart] =
      AsStringLogContext.fromMap[BalanceTransactionStart](evt => Map("transaction" -> evt.tx.show))
    implicit val balanceTxSuccessContext: AsStringLogContext[BalanceTransactionSuccess] =
      AsStringLogContext.fromMap[BalanceTransactionSuccess](evt =>
        Map("updated_transaction" -> evt.tx.show),
      )
    implicit val balanceTxErrorContext: AsStringLogContext[BalanceTransactionError] =
      AsStringLogContext.fromMap[BalanceTransactionError](evt =>
        Map("transaction_hash" -> evt.tx.header.hash.show, "error" -> evt.error.getMessage()),
      )

  }

}
