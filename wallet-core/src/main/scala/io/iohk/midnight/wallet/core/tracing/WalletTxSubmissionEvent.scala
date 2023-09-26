package io.iohk.midnight.wallet.core.tracing

import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.core.domain.TransactionIdentifier

sealed trait WalletTxSubmissionEvent

object WalletTxSubmissionEvent {

  final case class TransactionSubmissionStart(txId: TransactionIdentifier)
      extends WalletTxSubmissionEvent
  object TransactionSubmissionStart {
    val id: Event.Id[TransactionSubmissionStart] = Event.Id("wallet_tx_submission_start")
  }

  final case class TransactionSubmissionSuccess(
      submittedTxIdentifier: TransactionIdentifier,
  ) extends WalletTxSubmissionEvent
  object TransactionSubmissionSuccess {
    val id: Event.Id[TransactionSubmissionSuccess] = Event.Id("wallet_tx_submission_success")
  }

  final case class TransactionSubmissionError(txId: TransactionIdentifier, error: Throwable)
      extends WalletTxSubmissionEvent
  object TransactionSubmissionError {
    val id: Event.Id[TransactionSubmissionError] = Event.Id("wallet_tx_submission_error")
  }

  final case class TxValidationSuccess(txId: TransactionIdentifier) extends WalletTxSubmissionEvent
  object TxValidationSuccess {
    val id: Event.Id[TxValidationSuccess] = Event.Id("wallet_tx_validation_success")
  }

  final case class TxValidationError(txId: TransactionIdentifier, error: Throwable)
      extends WalletTxSubmissionEvent
  object TxValidationError {
    val id: Event.Id[TxValidationError] = Event.Id("wallet_tx_validation_error")
  }

  object DefaultInstances {
    implicit val txSubmissionStartContext: AsStringLogContext[TransactionSubmissionStart] =
      AsStringLogContext.fromMap(evt => Map("transaction_identifier" -> evt.txId.txId))
    implicit val txSubmissionSuccessContext: AsStringLogContext[TransactionSubmissionSuccess] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "submitted_transaction_identifier" -> evt.submittedTxIdentifier.txId,
        ),
      )
    implicit val txSubmissionErrorContext: AsStringLogContext[TransactionSubmissionError] =
      AsStringLogContext.fromMap(evt => Map("transaction_identifier" -> evt.txId.txId))
    implicit val txValidationSuccessContext: AsStringLogContext[TxValidationSuccess] =
      AsStringLogContext.fromMap(evt => Map("transaction_identifier" -> evt.txId.txId))
    implicit val txValidationErrorContext: AsStringLogContext[TxValidationError] =
      AsStringLogContext.fromMap(evt =>
        Map("transaction_identifier" -> evt.txId.txId, "error" -> evt.error.getMessage()),
      )
  }

}
