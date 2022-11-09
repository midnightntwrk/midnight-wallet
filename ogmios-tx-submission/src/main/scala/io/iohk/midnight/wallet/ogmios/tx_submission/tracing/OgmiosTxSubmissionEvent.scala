package io.iohk.midnight.wallet.ogmios.tx_submission.tracing

import io.iohk.midnight.wallet.blockchain.data.Transaction
import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.AsStringLogContext
import io.iohk.midnight.tracer.logging.Event

sealed trait OgmiosTxSubmissionEvent

object OgmiosTxSubmissionEvent {

  /** The given transaction has been submitted to node.
    */
  final case class TxSubmitted(tx: Transaction) extends OgmiosTxSubmissionEvent
  object TxSubmitted {
    val id: Event.Id[TxSubmitted] = Event.Id("tx_submitted")
  }

  /** The submitted transaction has been accepted.
    */
  final case class TxAccepted(tx: Transaction) extends OgmiosTxSubmissionEvent
  object TxAccepted {
    val id: Event.Id[TxAccepted] = Event.Id("tx_accepted")
  }

  /** The submitted transaction has been rejected for the given reason.
    */
  final case class TxRejected(tx: Transaction, reason: String) extends OgmiosTxSubmissionEvent
  object TxRejected {
    val id: Event.Id[TxRejected] = Event.Id("tx_rejected")
  }

  /** The response from the server could not be processed due to the given error.
    */
  final case class ProcessingReceivedMessageFailed(exception: Throwable)
      extends OgmiosTxSubmissionEvent
  object ProcessingReceivedMessageFailed {
    val id: Event.Id[ProcessingReceivedMessageFailed] = Event.Id("processing_received_msg_failed")
  }

  object DefaultInstances {
    implicit val txSubmittedContext: AsStringLogContext[TxSubmitted] =
      AsStringLogContext.fromMap[TxSubmitted](evt =>
        Map(
          "transaction" -> evt.tx.show,
        ),
      )

    implicit val txAcceptedContext: AsStringLogContext[TxAccepted] =
      AsStringLogContext.fromMap[TxAccepted](evt =>
        Map(
          "transaction" -> evt.tx.show,
        ),
      )

    implicit val txRejectedContext: AsStringLogContext[TxRejected] =
      AsStringLogContext.fromMap[TxRejected](evt =>
        Map(
          "transaction" -> evt.tx.show,
          "reason" -> evt.reason,
        ),
      )

    implicit val processingMsgFailedContext: AsStringLogContext[ProcessingReceivedMessageFailed] =
      AsStringLogContext.fromMap[ProcessingReceivedMessageFailed](evt =>
        Map(
          "error" -> evt.exception.getMessage,
        ),
      )
  }

}
