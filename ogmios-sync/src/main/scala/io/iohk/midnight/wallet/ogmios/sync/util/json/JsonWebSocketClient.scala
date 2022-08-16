package io.iohk.midnight.wallet.ogmios.sync.util.json

import cats.effect.Resource
import cats.syntax.all.*
import io.circe.parser.decode
import io.circe.syntax.*
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.wallet.ogmios.sync.tracer.*
import sttp.capabilities.WebSockets
import sttp.client3.*
import sttp.model.Uri
import sttp.ws.WebSocket
import cats.effect.kernel.Sync

// [TODO NLLW-361]
private[sync] trait JsonWebSocketClient[F[_]] {
  def send[T: Encoder](message: T): F[Unit]

  def receive[T: Decoder](): F[T]
}

private class SttpJsonWebSocketClient[F[_]: Sync](webSocket: WebSocket[F])(implicit
    tracer: ClientRequestResponseTracer[F],
) extends JsonWebSocketClient[F] {
  override def send[T: Encoder](message: T): F[Unit] = {
    val encodedMessage = message.asJson.spaces2
    tracer(ClientRequestResponseTrace.ClientRequest(encodedMessage)) >>
      Sync[F].defer(
        webSocket.sendText(encodedMessage),
      ) // using Sync[F].defer to prevent the underlying (future-based) code to run eagerly
  }

  override def receive[T: Decoder](): F[T] =
    webSocket
      .receiveText()
      .flatTap(message => tracer(ClientRequestResponseTrace.ClientResponse(message)))
      .map(decode(_))
      .rethrow
}

object SttpJsonWebSocketClient {
  def apply[F[_]: Sync: ClientRequestResponseTracer](
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
