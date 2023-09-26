package io.iohk.midnight.wallet.core.tracing

import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.core.domain.TransactionIdentifier
import io.iohk.midnight.wallet.core.tracing.WalletTxSubmissionEvent.*

class WalletTxSubmissionTracer[F[_]](val tracer: Tracer[F, WalletTxSubmissionEvent]) {

  def submitTxStart(txId: TransactionIdentifier): F[Unit] =
    tracer(TransactionSubmissionStart(txId))

  def txValidationSuccess(txId: TransactionIdentifier): F[Unit] =
    tracer(TxValidationSuccess(txId))

  def txValidationError(txId: TransactionIdentifier, error: Throwable): F[Unit] =
    tracer(TxValidationError(txId, error))

  def submitTxSuccess(
      submittedTxId: TransactionIdentifier,
  ): F[Unit] =
    tracer(
      TransactionSubmissionSuccess(
        submittedTxId,
      ),
    )

  def submitTxError(txId: TransactionIdentifier, error: Throwable): F[Unit] =
    tracer(TransactionSubmissionError(txId, error))

}

object WalletTxSubmissionTracer {

  import WalletTxSubmissionEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("wallet_tx_submission")

  implicit val walletTxSubmissionEventAsStructuredLog: AsStructuredLog[WalletTxSubmissionEvent] = {
    case evt: TransactionSubmissionStart   => evt.asContextAwareLog
    case evt: TransactionSubmissionSuccess => evt.asContextAwareLog
    case evt: TransactionSubmissionError   => evt.asContextAwareLog
    case evt: TxValidationSuccess          => evt.asContextAwareLog
    case evt: TxValidationError            => evt.asContextAwareLog
  }

  implicit val submitTxStartAsStructuredLog: AsStructuredLog[TransactionSubmissionStart] =
    AsContextAwareLog.instance(
      id = TransactionSubmissionStart.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Starting to submit transaction [${evt.txId.txId}].",
      context = _.stringLogContext,
    )

  implicit val submitTxSuccessAsStructuredLog: AsStructuredLog[TransactionSubmissionSuccess] =
    AsContextAwareLog.instance(
      id = TransactionSubmissionSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message =
        evt => s"Transaction [${evt.submittedTxIdentifier.txId}] has been submitted successfully.",
      context = _.stringLogContext,
    )

  implicit val submitTxErrorAsStructuredLog: AsStructuredLog[TransactionSubmissionError] =
    AsContextAwareLog.instance(
      id = TransactionSubmissionError.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Error while submitting transaction [${evt.txId.txId}].",
      context = _.stringLogContext,
    )

  implicit val txValidationSuccessAsStructuredLog: AsStructuredLog[TxValidationSuccess] =
    AsContextAwareLog.instance(
      id = TxValidationSuccess.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Transaction [${evt.txId.txId}] validated successfully.",
      context = _.stringLogContext,
    )

  implicit val txValidationErrorAsStructuredLog: AsStructuredLog[TxValidationError] =
    AsContextAwareLog.instance(
      id = TxValidationError.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Transaction [${evt.txId.txId}] is invalid.",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): WalletTxSubmissionTracer[F] = {
    val eventTracer: Tracer[F, WalletTxSubmissionEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new WalletTxSubmissionTracer[F](eventTracer)
  }

}
