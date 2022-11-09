package io.iohk.midnight.wallet.ogmios.network

import cats.effect.Resource
import cats.syntax.all.*
import io.circe.parser
import io.circe.syntax.*
import io.circe.{Decoder, Encoder}
import sttp.capabilities.WebSockets
import sttp.client3.*
import sttp.model.Uri
import sttp.ws.WebSocket
import cats.effect.kernel.Sync

trait JsonWebSocketClient[F[_]] {
  def send[T: Encoder](message: T): F[Unit]

  def receive[T: Decoder](): F[T]
}

private class SttpJsonWebSocketClient[F[_]: Sync](webSocket: WebSocket[F])(implicit
    tracer: JsonWebSocketClientTracer[F],
) extends JsonWebSocketClient[F] {
  override def send[T: Encoder](message: T): F[Unit] = {
    val encodedMessage = message.asJson.spaces2
    Sync[F]
      .defer(
        webSocket.sendText(encodedMessage),
      ) // using Sync[F].defer to prevent the underlying (future-based) code to run eagerly
      .flatTap(_ => tracer.requestSent(encodedMessage))
      .onError(tracer.sendingFailed)
  }

  override def receive[T: Decoder](): F[T] = {
    def receiveText: F[String] =
      webSocket
        .receiveText()
        .flatTap(tracer.responseReceived)
        .onError(tracer.receiveFailed)

    def decode(json: String): F[T] =
      Sync[F].fromEither(parser.decode(json)).onError(tracer.decodingFailed)

    receiveText.flatMap(decode)
  }
}

object SttpJsonWebSocketClient {
  def apply[F[_]: Sync: JsonWebSocketClientTracer](
      backend: SttpBackend[F, WebSockets],
      nodeUri: Uri,
  ): Resource[F, JsonWebSocketClient[F]] = {
    val openWebSocket: F[WebSocket[F]] = Sync[F].defer {
      emptyRequest
        .response(asWebSocketAlwaysUnsafe[F])
        .get(nodeUri)
        .send[F, WebSockets](backend)
        .map(_.body)
    } // using Sync[F].defer to prevent the underlying (future-based) code to run eagerly
    Resource.make(openWebSocket)(_.close()).map(new SttpJsonWebSocketClient[F](_))
  }
}
