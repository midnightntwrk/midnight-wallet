package io.iohk.midnight.wallet.clients.platform

import cats.MonadThrow
import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.iohk.midnight.wallet.clients.platform.examples.IntersectFound
import io.iohk.midnight.wallet.clients.platform.protocol.{ReceiveMessage, SendMessage}
import io.iohk.midnight.wallet.clients.platform.protocol.ReceiveMessage.LocalBlockSync
import io.iohk.midnight.wallet.domain.*
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import sttp.capabilities.WebSockets
import sttp.client3.SttpBackend
import sttp.client3.impl.cats.CatsMonadError
import sttp.client3.testing.SttpBackendStub
import sttp.model.Uri.*
import sttp.ws.{WebSocket, WebSocketFrame}
import sttp.ws.testing.WebSocketStub

trait PlatformClientSpec extends CatsEffectSuite:
  def buildClient[S](webSocket: WebSocket[IO]): Resource[IO, PlatformClient[IO]] =
    val sttpBackend =
      SttpBackendStub
        .apply[IO, WebSockets](CatsMonadError[IO])
        .whenAnyRequest
        .thenRespond(webSocket)
    PlatformClient.Live[IO](sttpBackend, uri"wss://test.com")

  def buildClient(initialReceive: List[String]): Resource[IO, PlatformClient[IO]] =
    val webSocketStub =
      WebSocketStub
        .initialReceive(initialReceive.map(WebSocketFrame.text))
        .build[IO](CatsMonadError[IO])
    buildClient(webSocketStub)

  def assertReceive(message: String, expected: ReceiveMessage): IO[Unit] =
    val clientResource = buildClient(List(message))
    clientResource.use(_.receive().map(assertEquals(_, expected)))

  def assertSend(message: SendMessage, expected: String): IO[Unit] =
    val echoWebSocket =
      // This websocket stub just echoes back what it got, to be able to see what the client sent
      WebSocketStub.noInitialReceive.thenRespond(List(_)).build[IO](CatsMonadError[IO])
    buildClient(echoWebSocket).use { client =>
      for
        _ <- client.send(message)
        received <- echoWebSocket.receive()
      yield received match
        case WebSocketFrame.Text(payload, _, _) => assertEquals(payload, expected)
        case _                                  => fail("received incorrect websocket frame")
    }
