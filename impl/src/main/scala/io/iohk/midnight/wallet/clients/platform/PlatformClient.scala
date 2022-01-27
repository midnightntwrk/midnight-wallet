package io.iohk.midnight.wallet.clients.platform

import cats.effect.{Async, Resource}
import cats.syntax.functor.*
import cats.syntax.monadError.*
import cats.{Functor, MonadThrow}
import io.circe.parser.decode
import io.circe.syntax.*
import io.iohk.midnight.wallet.clients.platform.protocol.{ReceiveMessage, SendMessage}
import io.iohk.midnight.wallet.domain.*
import sttp.capabilities.WebSockets
import sttp.client3.*
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri
import sttp.ws.WebSocket

trait PlatformClient[F[_]]:
  def send(message: SendMessage): F[Unit]

  def receive(): F[ReceiveMessage]

object PlatformClient:
  class Live[F[_]: MonadThrow](webSocket: WebSocket[F]) extends PlatformClient[F]:
    override def send(message: SendMessage): F[Unit] =
      import protocol.Encoders.sendMessageEncoder
      webSocket.sendText(message.asJson.toString)

    override def receive(): F[ReceiveMessage] =
      import protocol.Decoders.receiveMessageDecoder
      webSocket.receiveText().map(decode[ReceiveMessage]).rethrow

  object Live:
    def apply[F[_]: Functor: Async](
        backend: SttpBackend[F, WebSockets],
        platformUri: Uri,
    ): Resource[F, Live[F]] =
      val openWebSocket: F[WebSocket[F]] =
        emptyRequest
          .response(asWebSocketAlwaysUnsafe[F])
          .get(platformUri)
          .send(backend)
          .map(_.body)
      Resource.make(openWebSocket)(_.close()).map(new Live[F](_))
