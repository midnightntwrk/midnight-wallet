package io.iohk.midnight.wallet.clients.platform

import cats.MonadThrow
import cats.effect.Resource
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import cats.syntax.monadError.*
import io.circe.parser.decode
import io.circe.syntax.*
import io.iohk.midnight.wallet.clients.platform.protocol.Decoders.receiveMessageDecoder
import io.iohk.midnight.wallet.clients.platform.protocol.Encoders.sendMessageEncoder
import io.iohk.midnight.wallet.clients.platform.protocol.{ReceiveMessage, SendMessage}
import org.typelevel.log4cats.Logger
import sttp.capabilities.WebSockets
import sttp.client3.*
import sttp.model.Uri
import sttp.ws.WebSocket

trait PlatformClient[F[_]] {
  def send(message: SendMessage): F[Unit]

  def receive(): F[ReceiveMessage]
}

object PlatformClient {
  @SuppressWarnings(Array("org.wartremover.warts.ToString")) // FIXME: LLW-163
  class Live[F[_]: MonadThrow: Logger](webSocket: WebSocket[F]) extends PlatformClient[F] {
    override def send(message: SendMessage): F[Unit] = {
      Logger[F].debug(s"==> sending: ${message.toString}") >>
        webSocket.sendText(message.asJson(sendMessageEncoder).toString)
    }

    override def receive(): F[ReceiveMessage] =
      webSocket
        .receiveText()
        .map(decode(_)(receiveMessageDecoder))
        .rethrow
        .flatTap(message => Logger[F].debug(s"==> receiving: ${message.toString}"))
  }

  object Live {
    def apply[F[_]: MonadThrow: Logger](
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
