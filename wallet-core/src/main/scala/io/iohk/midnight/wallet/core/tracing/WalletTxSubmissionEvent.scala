package io.iohk.midnight.wallet.core.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.blockchain.data.Transaction as LedgerTransaction

sealed trait WalletTxSubmissionEvent

object WalletTxSubmissionEvent {

  final case class TransactionSubmissionStart(tx: LedgerTransaction) extends WalletTxSubmissionEvent
  object TransactionSubmissionStart {
    val id: Event.Id[TransactionSubmissionStart] = Event.Id("wallet_tx_submission_start")
  }

  final case class TransactionSubmissionSuccess(
      ledgerTx: LedgerTransaction,
      balancedDomainTx: LedgerTransaction,
      submittedTxIdentifier: String,
  ) extends WalletTxSubmissionEvent
  object TransactionSubmissionSuccess {
    val id: Event.Id[TransactionSubmissionSuccess] = Event.Id("wallet_tx_submission_success")
  }

  final case class TransactionSubmissionError(tx: LedgerTransaction, error: Throwable)
      extends WalletTxSubmissionEvent
  object TransactionSubmissionError {
    val id: Event.Id[TransactionSubmissionError] = Event.Id("wallet_tx_submission_error")
  }

  final case class TxValidationSuccess(tx: LedgerTransaction) extends WalletTxSubmissionEvent
  object TxValidationSuccess {
    val id: Event.Id[TxValidationSuccess] = Event.Id("wallet_tx_validation_success")
  }

  final case class TxValidationError(tx: LedgerTransaction, error: Throwable)
      extends WalletTxSubmissionEvent
  object TxValidationError {
    val id: Event.Id[TxValidationError] = Event.Id("wallet_tx_validation_error")
  }

  object DefaultInstances {
    implicit val txSubmissionStartContext: AsStringLogContext[TransactionSubmissionStart] =
      AsStringLogContext.fromMap(evt => Map("transaction" -> evt.tx.show))
    implicit val txSubmissionSuccessContext: AsStringLogContext[TransactionSubmissionSuccess] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "transaction_hash" -> evt.ledgerTx.header.hash.show,
          "balanced_transaction_hash" -> evt.balancedDomainTx.header.hash.show,
          "submitted_transaction_identifier" -> evt.submittedTxIdentifier,
        ),
      )
    implicit val txSubmissionErrorContext: AsStringLogContext[TransactionSubmissionError] =
      AsStringLogContext.fromMap(evt => Map("transaction_hash" -> evt.tx.header.hash.show))
    implicit val txValidationSuccessContext: AsStringLogContext[TxValidationSuccess] =
      AsStringLogContext.fromMap(evt => Map("transaction_hash" -> evt.tx.header.hash.show))
    implicit val txValidationErrorContext: AsStringLogContext[TxValidationError] =
      AsStringLogContext.fromMap(evt =>
        Map("transaction_hash" -> evt.tx.header.hash.show, "error" -> evt.error.getMessage()),
      )
  }

}
