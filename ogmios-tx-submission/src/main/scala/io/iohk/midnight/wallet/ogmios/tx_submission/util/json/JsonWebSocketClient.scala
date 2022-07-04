package io.iohk.midnight.wallet.ogmios.tx_submission.util.json

import cats.MonadThrow
import cats.effect.Resource
import cats.syntax.all.*
import io.circe.parser.decode
import io.circe.syntax.*
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.tracer.*
import sttp.capabilities.WebSockets
import sttp.client3.*
import sttp.model.Uri
import sttp.ws.WebSocket

// [TODO NLLW-361]
private[tx_submission] trait JsonWebSocketClient[F[_]] {
  def send[T: Encoder](message: T): F[Unit]

  def receive[T: Decoder](): F[T]
}

private class SttpJsonWebSocketClient[F[_]: MonadThrow](webSocket: WebSocket[F])(implicit
    tracer: ClientRequestResponseTracer[F],
) extends JsonWebSocketClient[F] {
  override def send[T: Encoder](message: T): F[Unit] = {
    val encodedMessage = message.asJson.spaces2
    tracer(ClientRequestResponseTrace.ClientRequest(encodedMessage)) >>
      webSocket.sendText(encodedMessage)
  }

  override def receive[T: Decoder](): F[T] =
    webSocket
      .receiveText()
      .flatTap(message => tracer(ClientRequestResponseTrace.ClientResponse(message)))
      .map(decode(_))
      .rethrow
}

private[tx_submission] object SttpJsonWebSocketClient {
  def apply[F[_]: MonadThrow: ClientRequestResponseTracer](
      backend: SttpBackend[F, WebSockets],
      nodeUri: Uri,
  ): Resource[F, JsonWebSocketClient[F]] = {
    val openWebSocket: F[WebSocket[F]] =
      emptyRequest
        .response(asWebSocketAlwaysUnsafe[F])
        .get(nodeUri)
        .send[F, WebSockets](backend)
        .map(_.body)
    Resource.make(openWebSocket)(_.close()).map(new SttpJsonWebSocketClient[F](_))
  }
}
