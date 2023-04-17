package io.iohk.midnight.wallet.engine.tracing.sync

import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.AsContextAwareLogOps
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.AsStringLogContextOps
import io.iohk.midnight.wallet.engine.tracing.sync.SyncServiceEvent.{BlockReceived, SyncFailed}

class SyncServiceTracer[F[_]](val tracer: Tracer[F, SyncServiceEvent]) {

  def syncFailed(error: Any): F[Unit] = tracer(SyncFailed(error))
  def syncBlockReceived(additionalData: Map[String, String]): F[Unit] = tracer(
    BlockReceived(additionalData),
  )
}

object SyncServiceTracer {

  import SyncServiceEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("sync_service")

  implicit val txSubmissionEventAsStructuredLog: AsStructuredLog[SyncServiceEvent] = {
    case e: SyncFailed    => e.asContextAwareLog
    case e: BlockReceived => e.asContextAwareLog
  }

  implicit val syncFailedAsStructuredLog: AsStructuredLog[SyncFailed] =
    AsContextAwareLog.instance(
      id = SyncFailed.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Sync operation finished with an error.",
      context = _.stringLogContext,
    )

  implicit val syncEventReceivedAsStructuredLog: AsStructuredLog[BlockReceived] =
    AsContextAwareLog.instance(
      id = BlockReceived.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Block received.",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): SyncServiceTracer[F] = {
    val walletBuilderTracer: Tracer[F, SyncServiceEvent] =
      structuredTracer >=> (evt => Sync[F].delay(evt.asContextAwareLog))
    new SyncServiceTracer[F](walletBuilderTracer)
  }
}
