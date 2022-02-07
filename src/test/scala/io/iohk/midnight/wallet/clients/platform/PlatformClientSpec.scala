package io.iohk.midnight.wallet.clients.platform

import cats.effect.{IO, Resource}
import io.iohk.midnight.wallet.clients.platform.protocol.{ReceiveMessage, SendMessage}
import munit.CatsEffectSuite
import sttp.capabilities.WebSockets
import sttp.client3.impl.cats.CatsMonadError
import sttp.client3.testing.SttpBackendStub
import sttp.model.Uri.*
import sttp.ws.testing.WebSocketStub
import sttp.ws.{WebSocket, WebSocketFrame}

trait PlatformClientSpec extends CatsEffectSuite {
  implicit val catsMonadError: CatsMonadError[IO] = new CatsMonadError[IO]

  def buildClient[S](webSocket: WebSocket[IO]): Resource[IO, PlatformClient[IO]] = {
    val sttpBackend =
      SttpBackendStub[IO, WebSockets](catsMonadError).whenAnyRequest.thenRespond(webSocket)
    PlatformClient.Live[IO](sttpBackend, uri"wss://test.com")
  }

  def buildClient(initialReceive: List[String]): Resource[IO, PlatformClient[IO]] = {
    val webSocketStub =
      WebSocketStub.initialReceive(initialReceive.map(WebSocketFrame.text)).build[IO]
    buildClient(webSocketStub)
  }

  def assertReceive(message: String, expected: ReceiveMessage): IO[Unit] = {
    val clientResource = buildClient(List(message))
    clientResource.use(_.receive().map(assertEquals(_, expected)))
  }

  def assertSend(message: SendMessage, expected: String): IO[Unit] = {
    // This websocket stub just echoes back what it got, to be able to see what the client sent
    val echoWebSocket = WebSocketStub.noInitialReceive.thenRespond(List(_)).build[IO]

    buildClient(echoWebSocket).use { client =>
      for {
        _ <- client.send(message)
        received <- echoWebSocket.receive()
      } yield received match {
        case WebSocketFrame.Text(payload, _, _) => assertEquals(payload, expected)
        case _                                  => fail("received incorrect websocket frame")
      }
    }
  }
}
