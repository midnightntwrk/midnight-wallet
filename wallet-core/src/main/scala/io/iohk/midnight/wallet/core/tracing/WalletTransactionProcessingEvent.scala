package io.iohk.midnight.wallet.core.tracing

import cats.syntax.show.*
import io.iohk.midnight.tracer.logging.{AsStringLogContext, Event}
import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.TransactionHash

sealed trait WalletTransactionProcessingEvent

object WalletTransactionProcessingEvent {

  final case class TransactionProcessingHandlingTransaction(txHash: TransactionHash)
      extends WalletTransactionProcessingEvent

  object TransactionProcessingHandlingTransaction {
    val id: Event.Id[TransactionProcessingHandlingTransaction] =
      Event.Id("wallet_transaction_processing_handling_transaction")
  }

  final case class ApplyTransactionSuccess(txHash: TransactionHash)
      extends WalletTransactionProcessingEvent

  object ApplyTransactionSuccess {
    val id: Event.Id[ApplyTransactionSuccess] = Event.Id("wallet_apply_transaction_success")
  }

  final case class ApplyTransactionError(txHash: TransactionHash, error: WalletError)
      extends WalletTransactionProcessingEvent

  object ApplyTransactionError {
    val id: Event.Id[ApplyTransactionError] = Event.Id("wallet_apply_transaction_error")
  }

  object DefaultInstances {
    implicit val transactionProcessingHandlingTransactionContext
        : AsStringLogContext[TransactionProcessingHandlingTransaction] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "transaction_hash" -> evt.txHash.hash,
        ),
      )
    implicit val applyTransactionSuccessContext: AsStringLogContext[ApplyTransactionSuccess] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "transaction_hash" -> evt.txHash.hash,
        ),
      )
    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    implicit val applyTransactionErrorContext: AsStringLogContext[ApplyTransactionError] =
      AsStringLogContext.fromMap(evt =>
        Map(
          "transaction_hash" -> evt.txHash.hash,
          "error" -> evt.error.message,
        ),
      )
    // $COVERAGE-ON$
  }

}
