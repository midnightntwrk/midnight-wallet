package io.iohk.midnight.wallet.engine.tracing.sync

import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.AsContextAwareLogOps
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.AsStringLogContextOps
import io.iohk.midnight.wallet.engine.tracing.sync.SyncServiceEvent.{
  SyncFailed,
  ViewingUpdateReceived,
}
import io.iohk.midnight.wallet.indexer.IndexerClient.{RawViewingUpdate, SingleUpdate}

class SyncServiceTracer[F[_]](val tracer: Tracer[F, SyncServiceEvent]) {

  def syncFailed(error: Throwable): F[Unit] = tracer(SyncFailed(error))
  def viewingUpdateReceived(viewingUpdate: RawViewingUpdate): F[Unit] = tracer(
    ViewingUpdateReceived(viewingUpdate),
  )
}

object SyncServiceTracer {

  import SyncServiceEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("sync_service")

  implicit val txSubmissionEventAsStructuredLog: AsStructuredLog[SyncServiceEvent] = {
    case e: SyncFailed            => e.asContextAwareLog
    case e: ViewingUpdateReceived => e.asContextAwareLog
  }

  implicit val syncFailedAsStructuredLog: AsStructuredLog[SyncFailed] =
    AsContextAwareLog.instance(
      id = SyncFailed.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt => s"Sync operation finished with an error: ${evt.error.getMessage}",
      context = _.stringLogContext,
    )

  implicit val viewingUpdateReceivedAsStructuredLog: AsStructuredLog[ViewingUpdateReceived] =
    AsContextAwareLog.instance(
      id = ViewingUpdateReceived.id,
      component = Component,
      level = LogLevel.Debug,
      message = evt =>
        s"Viewing update received with ${evt.update.updates
            .collect { case SingleUpdate.RawTransaction(hash, _, _) => hash }
            .mkString("[", ",", "]")}.",
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
