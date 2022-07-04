package io.iohk.midnight.wallet.ogmios.sync.util

import cats.effect.{IO, Resource}
import io.circe.{Decoder, Encoder}
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.tracer.ClientRequestResponseTracer
import io.iohk.midnight.wallet.ogmios.sync.util.json.{JsonWebSocketClient, SttpJsonWebSocketClient}
import munit.CatsEffectSuite
import sttp.capabilities.WebSockets
import sttp.client3.impl.cats.CatsMonadError
import sttp.client3.testing.SttpBackendStub
import sttp.model.Uri.*
import sttp.ws.testing.WebSocketStub
import sttp.ws.{WebSocket, WebSocketFrame}

// [TODO NLLW-361]
trait WithJsonWebSocketClient extends CatsEffectSuite with BetterOutputSuite {
  implicit val catsMonadError: CatsMonadError[IO] = new CatsMonadError[IO]
  implicit val clientTracer: ClientRequestResponseTracer[IO] = Tracer.discardTracer

  def buildClientFromWebSocket(
      webSocket: WebSocket[IO],
  ): Resource[IO, JsonWebSocketClient[IO]] = {
    val sttpBackend =
      SttpBackendStub[IO, WebSockets](catsMonadError).whenAnyRequest.thenRespond(webSocket)
    SttpJsonWebSocketClient[IO](sttpBackend, uri"wss://test.com")
  }

  def buildClientWithInitialReceive(
      initialReceive: List[String],
  ): Resource[IO, JsonWebSocketClient[IO]] = {
    val webSocketStub =
      WebSocketStub.initialReceive(initialReceive.map(WebSocketFrame.text)).build[IO]
    buildClientFromWebSocket(webSocketStub)
  }

  def assertReceive[T: Decoder](message: String, expected: T): IO[Unit] = {
    val clientResource = buildClientWithInitialReceive(List(message))
    clientResource.use(_.receive[T]().map(assertEquals(_, expected)))
  }

  def assertSend[T: Encoder](message: T, expected: String): IO[Unit] = {
    // This websocket stub just echoes back what it got, to be able to see what the client sent
    val echoWebSocket = WebSocketStub.noInitialReceive.thenRespond(List(_)).build[IO]

    buildClientFromWebSocket(echoWebSocket).use { client =>
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
