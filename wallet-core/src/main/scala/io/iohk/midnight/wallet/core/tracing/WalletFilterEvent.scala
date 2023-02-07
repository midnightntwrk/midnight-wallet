package io.iohk.midnight.wallet.core.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.Event
import io.iohk.midnight.tracer.logging.AsStringLogContext
import io.iohk.midnight.wallet.blockchain.data.Transaction

sealed trait WalletFilterEvent

object WalletFilterEvent {

  final case class TxFilterApplied(tx: Transaction, filterMatched: Boolean)
      extends WalletFilterEvent

  object TxFilterApplied {
    val id: Event.Id[TxFilterApplied] = Event.Id("tx_filter_applied")
  }

  object DefaultInstances {
    implicit val txFilterAppliedContext: AsStringLogContext[TxFilterApplied] =
      AsStringLogContext.fromMap(evt =>
        Map("transaction" -> evt.tx.show, "filter_matched" -> evt.filterMatched.show),
      )
  }

}
