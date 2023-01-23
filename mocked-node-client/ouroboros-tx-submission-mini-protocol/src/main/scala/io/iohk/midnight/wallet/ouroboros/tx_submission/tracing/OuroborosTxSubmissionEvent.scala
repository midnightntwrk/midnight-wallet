package io.iohk.midnight.wallet.ouroboros.tx_submission.tracing

import cats.Show
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}

sealed trait OuroborosTxSubmissionEvent

object OuroborosTxSubmissionEvent {

  /** The given transaction has been submitted to node.
    */
  final case class TxSubmitted[Transaction: Show](tx: Transaction)
      extends OuroborosTxSubmissionEvent {
    def show: String = Show[Transaction].show(tx)
  }
  object TxSubmitted {
    def id[Transaction]: Event.Id[TxSubmitted[Transaction]] = Event.Id("tx_submitted")
  }

  /** The submitted transaction has been accepted.
    */
  final case class TxAccepted[Transaction: Show](tx: Transaction)
      extends OuroborosTxSubmissionEvent {
    def show: String = Show[Transaction].show(tx)
  }
  object TxAccepted {
    def id[Transaction]: Event.Id[TxAccepted[Transaction]] = Event.Id("tx_accepted")
  }

  /** The submitted transaction has been rejected for the given reason.
    */
  final case class TxRejected[Transaction: Show](tx: Transaction, reason: String)
      extends OuroborosTxSubmissionEvent {
    def show: String = Show[Transaction].show(tx)
  }
  object TxRejected {
    def id[Transaction]: Event.Id[TxRejected[Transaction]] = Event.Id("tx_rejected")
  }

  /** The response from the server could not be processed due to the given error.
    */
  final case class ProcessingReceivedMessageFailed(exception: Throwable)
      extends OuroborosTxSubmissionEvent
  object ProcessingReceivedMessageFailed {
    val id: Event.Id[ProcessingReceivedMessageFailed] = Event.Id("processing_received_msg_failed")
  }

  object DefaultInstances {
    implicit def txSubmittedContext[Transaction]: AsStringLogContext[TxSubmitted[Transaction]] =
      AsStringLogContext.fromMap[TxSubmitted[Transaction]](evt =>
        Map(
          "transaction" -> evt.show,
        ),
      )

    implicit def txAcceptedContext[Transaction]: AsStringLogContext[TxAccepted[Transaction]] =
      AsStringLogContext.fromMap[TxAccepted[Transaction]](evt =>
        Map(
          "transaction" -> evt.show,
        ),
      )

    implicit def txRejectedContext[Transaction]: AsStringLogContext[TxRejected[Transaction]] =
      AsStringLogContext.fromMap[TxRejected[Transaction]](evt =>
        Map(
          "transaction" -> evt.show,
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
