package io.iohk.midnight.wallet.core.tracing

import io.iohk.midnight.wallet.core.domain.TransactionIdentifier
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}

sealed trait WalletTxServiceEvent

object WalletTxServiceEvent {
  final case class UnprovenTransactionReverted(
      txId: Option[TransactionIdentifier],
      error: Throwable,
  ) extends WalletTxServiceEvent
  object UnprovenTransactionReverted {
    val id: Event.Id[UnprovenTransactionReverted] = Event.Id("unproven_tx_reverted")
  }

  object DefaultInstances {
    implicit val unprovenTxRevertedContext: AsStringLogContext[UnprovenTransactionReverted] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "transaction_identifier" -> evt.txId.fold("empty")(_.txId),
          "cause" -> evt.error.getMessage,
        ),
      )
  }
}
