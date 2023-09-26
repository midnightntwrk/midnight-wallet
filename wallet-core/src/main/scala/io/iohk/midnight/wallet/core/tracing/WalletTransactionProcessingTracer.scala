package io.iohk.midnight.wallet.core.tracing

import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.domain.TransactionHash
import io.iohk.midnight.wallet.core.tracing.WalletTransactionProcessingEvent.*

class WalletTransactionProcessingTracer[F[_]](
    val tracer: Tracer[F, WalletTransactionProcessingEvent],
) {
  def handlingTransaction(txHash: TransactionHash): F[Unit] = tracer(
    TransactionProcessingHandlingTransaction(txHash),
  )
  def applyTransactionSuccess(txHash: TransactionHash): F[Unit] = tracer(
    ApplyTransactionSuccess(txHash),
  )
  // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
  def applyTransactionError(txHash: TransactionHash, error: WalletError): F[Unit] = tracer(
    ApplyTransactionError(txHash, error),
  )
  // $COVERAGE-ON$
}

object WalletTransactionProcessingTracer {

  import WalletTransactionProcessingEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("wallet_transaction_processing")

  implicit val walletTransactionProcessingEventAsStructuredLog
      : AsStructuredLog[WalletTransactionProcessingEvent] = {
    case evt: TransactionProcessingHandlingTransaction => evt.asContextAwareLog
    case evt: ApplyTransactionSuccess                  => evt.asContextAwareLog
    // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
    case evt: ApplyTransactionError => evt.asContextAwareLog
    // $COVERAGE-ON$
  }

  implicit val transactionProcessingHandlingTransactionAsStructuredLog
      : AsStructuredLog[TransactionProcessingHandlingTransaction] =
    AsContextAwareLog.instance(
      id = TransactionProcessingHandlingTransaction.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Starting applying transaction [${evt.txHash.hash}].",
      context = _.stringLogContext,
    )

  implicit val applyTransactionSuccessAsStructuredLog: AsStructuredLog[ApplyTransactionSuccess] =
    AsContextAwareLog.instance(
      id = ApplyTransactionSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Successfully applied transaction [${evt.txHash.hash}].",
      context = _.stringLogContext,
    )

  // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
  implicit val applyTransactionErrorAsStructuredLog: AsStructuredLog[ApplyTransactionError] =
    AsContextAwareLog.instance(
      id = ApplyTransactionError.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Error while applying transaction [${evt.txHash.hash}].",
      context = _.stringLogContext,
    )
  // $COVERAGE-ON$

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): WalletTransactionProcessingTracer[F] = {
    val eventTracer: Tracer[F, WalletTransactionProcessingEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new WalletTransactionProcessingTracer[F](eventTracer)
  }

}
