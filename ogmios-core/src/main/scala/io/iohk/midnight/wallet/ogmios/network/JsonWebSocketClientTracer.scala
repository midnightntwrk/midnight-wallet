package io.iohk.midnight.wallet.ogmios.network

import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.{AsContextAwareLog, ContextAwareLog, Event, LogLevel}
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import JsonWebSocketClientEvent.*
import cats.effect.kernel.Sync
import io.circe

class JsonWebSocketClientTracer[F[_]](val tracer: Tracer[F, JsonWebSocketClientEvent]) {

  def requestSent(msg: String): F[Unit] = tracer(RequestSent(msg))
  def responseReceived(msg: String): F[Unit] = tracer(ResponseReceived(msg))
  def sendingFailed: PartialFunction[Throwable, F[Unit]] =
    PartialFunction.fromFunction(t => tracer(ReceiveFailed(t)))
  def decodingFailed: PartialFunction[Throwable, F[Unit]] = { case ce: circe.Error =>
    tracer(DecodingFailed(ce))
  }
  def receiveFailed: PartialFunction[Throwable, F[Unit]] =
    PartialFunction.fromFunction(t => tracer(ReceiveFailed(t)))

}

object JsonWebSocketClientTracer {

  import JsonWebSocketClientEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("json_websocket_client")

  implicit val websocketEventToContextAwareLog: AsContextAwareLog[JsonWebSocketClientEvent] =
    new AsContextAwareLog[JsonWebSocketClientEvent] {
      override def apply(event: JsonWebSocketClientEvent): ContextAwareLog = event match {
        case e: RequestSent      => e.asContextAwareLog
        case e: ResponseReceived => e.asContextAwareLog
        case e: SendFailed       => e.asContextAwareLog
        case e: DecodingFailed   => e.asContextAwareLog
        case e: ReceiveFailed    => e.asContextAwareLog
      }
    }

  implicit val requestSentToContextAwareLog: AsContextAwareLog[RequestSent] =
    AsContextAwareLog.instance[RequestSent](
      id = RequestSent.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Request sent.",
      context = _.stringLogContext,
    )
  implicit val responseReceivedToContextAwareLog: AsContextAwareLog[ResponseReceived] =
    AsContextAwareLog.instance[ResponseReceived](
      id = ResponseReceived.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Response received.",
      context = _.stringLogContext,
    )
  implicit val sendFailedToContextAwareLog: AsContextAwareLog[SendFailed] =
    AsContextAwareLog.instance[SendFailed](
      id = SendFailed.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Sending message failed.",
      context = _.stringLogContext,
    )
  implicit val decodingFailedToContextAwareLog: AsContextAwareLog[DecodingFailed] =
    AsContextAwareLog.instance[DecodingFailed](
      id = DecodingFailed.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Decoding received message failed.",
      context = _.stringLogContext,
    )
  implicit val receiveFailedToContextAwareLog: AsContextAwareLog[ReceiveFailed] =
    AsContextAwareLog.instance[ReceiveFailed](
      id = ReceiveFailed.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Receiving message failed.",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      simple: Tracer[F, ContextAwareLog],
  ): JsonWebSocketClientTracer[F] = {
    val jsonWebSocketClientTracer: Tracer[F, JsonWebSocketClientEvent] =
      simple >=> (e => Sync[F].delay(e.asContextAwareLog))
    new JsonWebSocketClientTracer[F](jsonWebSocketClientTracer)
  }

}
