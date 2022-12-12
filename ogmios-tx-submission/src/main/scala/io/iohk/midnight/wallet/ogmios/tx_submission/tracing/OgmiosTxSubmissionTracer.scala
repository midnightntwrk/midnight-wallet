package io.iohk.midnight.wallet.ogmios.tx_submission.tracing

import cats.effect.kernel.Sync
import cats.syntax.show.*
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.AsContextAwareLog
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.tracer.logging.AsStructuredLog
import io.iohk.midnight.tracer.logging.Event
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.ogmios.tx_submission.OgmiosTxSubmissionService

class OgmiosTxSubmissionTracer[F[_]](val tracer: Tracer[F, OgmiosTxSubmissionEvent]) {

  def txSubmitted(tx: Transaction): F[Unit] = tracer(OgmiosTxSubmissionEvent.TxSubmitted(tx))
  def resultReceived(tx: Transaction, result: OgmiosTxSubmissionService.SubmissionResult): F[Unit] =
    result match {
      case OgmiosTxSubmissionService.SubmissionResult.Accepted         => txAccepted(tx)
      case OgmiosTxSubmissionService.SubmissionResult.Rejected(reason) => txRejected(tx, reason)
    }
  def txAccepted(tx: Transaction): F[Unit] = tracer(OgmiosTxSubmissionEvent.TxAccepted(tx))
  def txRejected(tx: Transaction, reason: String): F[Unit] = tracer(
    OgmiosTxSubmissionEvent.TxRejected(tx, reason),
  )
  def processingMsgFailed: PartialFunction[Throwable, F[Unit]] = { case e: Throwable =>
    tracer(
      OgmiosTxSubmissionEvent.ProcessingReceivedMessageFailed(e),
    )
  }

}

object OgmiosTxSubmissionTracer {

  import OgmiosTxSubmissionEvent.*
  import OgmiosTxSubmissionEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("ogmios_tx_submission")

  implicit val txSubmissionEventAsStructuredLog: AsStructuredLog[OgmiosTxSubmissionEvent] = {
    case e: TxSubmitted                     => e.asContextAwareLog
    case e: TxAccepted                      => e.asContextAwareLog
    case e: TxRejected                      => e.asContextAwareLog
    case e: ProcessingReceivedMessageFailed => e.asContextAwareLog
  }

  implicit val txSubmittedAsStructuredLog: AsStructuredLog[TxSubmitted] =
    AsContextAwareLog.instance(
      id = TxSubmitted.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Transaction [${evt.tx.header.hash.show}] has been submitted.",
      context = _.stringLogContext,
    )

  implicit val txAcceptedAsStructuredLog: AsStructuredLog[TxAccepted] =
    AsContextAwareLog.instance(
      id = TxAccepted.id,
      component = Component,
      level = LogLevel.Info,
      message = evt => s"Transaction [${evt.tx.header.hash.show}] has been accepted.",
      context = _.stringLogContext,
    )

  implicit val txRejectedAsStructuredLog: AsStructuredLog[TxRejected] =
    AsContextAwareLog.instance(
      id = TxRejected.id,
      component = Component,
      level = LogLevel.Info,
      message = evt => s"Transaction [${evt.tx.header.hash.show}] has been rejected.",
      context = _.stringLogContext,
    )

  implicit val processingFailedAsStructuredLog: AsStructuredLog[ProcessingReceivedMessageFailed] =
    AsContextAwareLog.instance(
      id = ProcessingReceivedMessageFailed.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Processing received message failed with an exception.",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): OgmiosTxSubmissionTracer[F] = {
    val txSubmissionTracer: Tracer[F, OgmiosTxSubmissionEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new OgmiosTxSubmissionTracer[F](txSubmissionTracer)
  }

}
