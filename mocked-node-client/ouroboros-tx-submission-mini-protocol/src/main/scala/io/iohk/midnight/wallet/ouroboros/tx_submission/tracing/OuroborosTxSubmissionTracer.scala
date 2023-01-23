package io.iohk.midnight.wallet.ouroboros.tx_submission.tracing

import cats.Show
import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionService

class OuroborosTxSubmissionTracer[F[_]](val tracer: Tracer[F, OuroborosTxSubmissionEvent]) {

  def txSubmitted[Transaction: Show](tx: Transaction): F[Unit] = tracer(
    OuroborosTxSubmissionEvent.TxSubmitted(tx),
  )
  def resultReceived[Transaction: Show](
      tx: Transaction,
      result: OuroborosTxSubmissionService.SubmissionResult,
  ): F[Unit] =
    result match {
      case OuroborosTxSubmissionService.SubmissionResult.Accepted         => txAccepted(tx)
      case OuroborosTxSubmissionService.SubmissionResult.Rejected(reason) => txRejected(tx, reason)
    }
  def txAccepted[Transaction: Show](tx: Transaction): F[Unit] = tracer(
    OuroborosTxSubmissionEvent.TxAccepted(tx),
  )
  def txRejected[Transaction: Show](tx: Transaction, reason: String): F[Unit] = tracer(
    OuroborosTxSubmissionEvent.TxRejected(tx, reason),
  )
  def processingMsgFailed: PartialFunction[Throwable, F[Unit]] = { case e: Throwable =>
    tracer(
      OuroborosTxSubmissionEvent.ProcessingReceivedMessageFailed(e),
    )
  }

}

object OuroborosTxSubmissionTracer {

  import OuroborosTxSubmissionEvent.*
  import OuroborosTxSubmissionEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("ouroboros_tx_submission")

  implicit val txSubmissionEventAsStructuredLog: AsStructuredLog[OuroborosTxSubmissionEvent] = {
    case e: TxSubmitted[?]                  => e.asContextAwareLog
    case e: TxAccepted[?]                   => e.asContextAwareLog
    case e: TxRejected[?]                   => e.asContextAwareLog
    case e: ProcessingReceivedMessageFailed => e.asContextAwareLog
  }

  implicit def txSubmittedAsStructuredLog[Transaction]: AsStructuredLog[TxSubmitted[Transaction]] =
    AsContextAwareLog.instance(
      id = TxSubmitted.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Transaction [${evt.show}] has been submitted.",
      context = _.stringLogContext,
    )

  implicit def txAcceptedAsStructuredLog[Transaction]: AsStructuredLog[TxAccepted[Transaction]] =
    AsContextAwareLog.instance(
      id = TxAccepted.id,
      component = Component,
      level = LogLevel.Info,
      message = evt => s"Transaction [${evt.show}] has been accepted.",
      context = _.stringLogContext,
    )

  implicit def txRejectedAsStructuredLog[Transaction]: AsStructuredLog[TxRejected[Transaction]] =
    AsContextAwareLog.instance(
      id = TxRejected.id,
      component = Component,
      level = LogLevel.Info,
      message = evt => s"Transaction [${evt.show}] has been rejected.",
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
  ): OuroborosTxSubmissionTracer[F] = {
    val txSubmissionTracer: Tracer[F, OuroborosTxSubmissionEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new OuroborosTxSubmissionTracer[F](txSubmissionTracer)
  }

}
