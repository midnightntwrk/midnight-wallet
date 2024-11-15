package io.iohk.midnight.wallet.indexer.tracing

import cats.effect.IO
import cats.effect.kernel.Sync
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.indexer.tracing.IndexerClientEvent.{ConnectTimeout, ConnectionLost}

class IndexerClientTracer(tracer: Tracer[IO, IndexerClientEvent]) {
  def connectionLost(error: Throwable): IO[Unit] =
    tracer(ConnectionLost(error))
  def connectTimeout: IO[Unit] =
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
    AsContextAwareLog.from(
      id = ConnectionLost.id,
      component = Component,
      level = LogLevel.Warn,
      message = evt => s"Connection lost: ${evt.error.getMessage}",
      context = _.stringLogContext,
    )

  implicit val connectTimeoutAsStructuredLog: AsStructuredLog[ConnectTimeout.type] =
    AsContextAwareLog.from(
      id = ConnectTimeout.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Timed out trying to connect",
      context = _.stringLogContext,
    )

  def from(structuredTracer: Tracer[IO, StructuredLog]): IndexerClientTracer =
    new IndexerClientTracer(structuredTracer >=> (e => Sync[IO].delay(e.asContextAwareLog)))
}
