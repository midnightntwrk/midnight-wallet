package io.iohk.midnight.wallet.clients.platform

import cats.MonadThrow
import cats.effect.Resource
import cats.implicits.toShow
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import cats.syntax.monadError.*
import io.circe.parser.decode
import io.circe.syntax.*
import io.iohk.midnight.wallet.clients.platform.protocol.Decoders.receiveMessageDecoder
import io.iohk.midnight.wallet.clients.platform.protocol.Encoders.sendMessageEncoder
import io.iohk.midnight.wallet.clients.platform.protocol.{ReceiveMessage, SendMessage}
import io.iohk.midnight.wallet.tracer.{ClientRequestResponseTrace, ClientRequestResponseTracer}
import sttp.capabilities.WebSockets
import sttp.client3.*
import sttp.model.Uri
import sttp.ws.WebSocket

trait PlatformClient[F[_]] {
  def send(message: SendMessage): F[Unit]

  def receive(): F[ReceiveMessage]
}

object PlatformClient {
  class Live[F[_]: MonadThrow](webSocket: WebSocket[F])(implicit
      tracer: ClientRequestResponseTracer[F],
  ) extends PlatformClient[F] {
    override def send(message: SendMessage): F[Unit] = {
      tracer(ClientRequestResponseTrace.ClientRequest(message.show)) >>
        webSocket.sendText(message.asJson(sendMessageEncoder).spaces2)
    }

    override def receive(): F[ReceiveMessage] =
      webSocket
        .receiveText()
        .map(decode(_)(receiveMessageDecoder))
        .rethrow
        .flatTap(message => tracer(ClientRequestResponseTrace.ClientResponse(message.show)))
  }

  object Live {
    def apply[F[_]: MonadThrow: ClientRequestResponseTracer](
        backend: SttpBackend[F, WebSockets],
        platformUri: Uri,
    ): Resource[F, Live[F]] = {
      val openWebSocket: F[WebSocket[F]] =
        emptyRequest
          .response(asWebSocketAlwaysUnsafe[F])
          .get(platformUri)
          .send[F, WebSockets](backend)
          .map(_.body)
      Resource.make(openWebSocket)(_.close()).map(new Live[F](_))
    }
  }
}
