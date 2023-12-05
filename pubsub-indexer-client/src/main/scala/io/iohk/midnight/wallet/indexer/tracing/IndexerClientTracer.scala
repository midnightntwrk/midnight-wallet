package io.iohk.midnight.wallet.indexer.tracing

import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.indexer.tracing.IndexerClientEvent.{ConnectTimeout, ConnectionLost}

class IndexerClientTracer[F[_]](tracer: Tracer[F, IndexerClientEvent]) {
  def connectionLost(error: Throwable): F[Unit] =
    tracer(ConnectionLost(error))
  def connectTimeout: F[Unit] =
    tracer(ConnectTimeout)
}

object IndexerClientTracer {
  import IndexerClientEvent.DefaultInstances.*

  private val Component = Event.Component("indexer_client")

  implicit val indexerClientEventAsStructuredLog: AsStructuredLog[IndexerClientEvent] = {
    case evt: ConnectionLost      => evt.asContextAwareLog
    case evt: ConnectTimeout.type => evt.asContextAwareLog
  }

  implicit val connectionLostAsStructuredLog: AsStructuredLog[ConnectionLost] =
    AsContextAwareLog.instance(
      id = ConnectionLost.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Connection lost: ${evt.error.getMessage}",
      context = _.stringLogContext,
    )

  implicit val connectTimeoutAsStructuredLog: AsStructuredLog[ConnectTimeout.type] =
    AsContextAwareLog.instance(
      id = ConnectTimeout.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Timed out trying to connect",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](structuredTracer: Tracer[F, StructuredLog]): IndexerClientTracer[F] =
    new IndexerClientTracer[F](structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog)))
}
