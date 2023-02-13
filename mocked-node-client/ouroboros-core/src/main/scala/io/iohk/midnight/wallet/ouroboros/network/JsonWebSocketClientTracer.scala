package io.iohk.midnight.wallet.ouroboros.network

import cats.effect.kernel.Sync
import io.circe
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.TracerSyntax.*
import io.iohk.midnight.tracer.logging.*
import io.iohk.midnight.tracer.logging.AsContextAwareLogSyntax.*
import io.iohk.midnight.tracer.logging.AsStringLogContextSyntax.*
import io.iohk.midnight.wallet.ouroboros.network.JsonWebSocketClientEvent.*
import sttp.ws.WebSocketClosed

class JsonWebSocketClientTracer[F[_]](val tracer: Tracer[F, JsonWebSocketClientEvent]) {

  def requestSent(msg: String): F[Unit] = tracer(RequestSent(msg))
  def responseReceived(msg: String): F[Unit] = tracer(ResponseReceived(msg))
  def sendingFailed: PartialFunction[Throwable, F[Unit]] =
    PartialFunction.fromFunction(t => tracer(SendFailed(t)))
  def decodingFailed: PartialFunction[Throwable, F[Unit]] = { case ce: circe.Error =>
    tracer(DecodingFailed(ce))
  }
  def receiveFailed: PartialFunction[Throwable, F[Unit]] = {
    case wsc @ WebSocketClosed(_) => tracer(CloseFrameReceived(wsc))
    case t                        => tracer(ReceiveFailed(t))
  }
}

object JsonWebSocketClientTracer {

  import JsonWebSocketClientEvent.DefaultInstances.*

  private val Component: Event.Component = Event.Component("json_websocket_client")

  implicit val websocketEventAsStructuredLog: AsStructuredLog[JsonWebSocketClientEvent] = {
    case e: RequestSent        => e.asContextAwareLog
    case e: ResponseReceived   => e.asContextAwareLog
    case e: SendFailed         => e.asContextAwareLog
    case e: DecodingFailed     => e.asContextAwareLog
    case e: ReceiveFailed      => e.asContextAwareLog
    case e: CloseFrameReceived => e.asContextAwareLog
  }

  implicit val requestSentAsStructuredLog: AsStructuredLog[RequestSent] =
    AsContextAwareLog.instance(
      id = RequestSent.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Request sent.",
      context = _.stringLogContext,
    )
  implicit val responseReceivedAsStructuredLog: AsStructuredLog[ResponseReceived] =
    AsContextAwareLog.instance(
      id = ResponseReceived.id,
      component = Component,
      level = LogLevel.Debug,
      message = _ => "Response received.",
      context = _.stringLogContext,
    )
  implicit val sendFailedAsStructuredLog: AsStructuredLog[SendFailed] =
    AsContextAwareLog.instance(
      id = SendFailed.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Sending message failed.",
      context = _.stringLogContext,
    )
  implicit val decodingFailedAsStructuredLog: AsStructuredLog[DecodingFailed] =
    AsContextAwareLog.instance(
      id = DecodingFailed.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Decoding received message failed.",
      context = _.stringLogContext,
    )
  implicit val receiveFailedAsStructuredLog: AsStructuredLog[ReceiveFailed] =
    AsContextAwareLog.instance(
      id = ReceiveFailed.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Receiving message failed.",
      context = _.stringLogContext,
    )
  implicit val closeFrameReceivedAsStructuredLog: AsStructuredLog[CloseFrameReceived] =
    AsContextAwareLog.instance(
      id = CloseFrameReceived.id,
      component = Component,
      level = LogLevel.Warn,
      message = _ => "Received web socket close frame.",
      context = _.stringLogContext,
    )

  def from[F[_]: Sync](
      structuredTracer: Tracer[F, StructuredLog],
  ): JsonWebSocketClientTracer[F] = {
    val jsonWebSocketClientTracer: Tracer[F, JsonWebSocketClientEvent] =
      structuredTracer >=> (e => Sync[F].delay(e.asContextAwareLog))
    new JsonWebSocketClientTracer[F](jsonWebSocketClientTracer)
  }

}
