package io.iohk.midnight.wallet.engine

import cats.effect.IO
import cats.syntax.all.*
import com.comcast.ip4s.Port
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.engine.util.TestWebSocketBuilder
import io.iohk.midnight.wallet.ogmios
import io.iohk.midnight.wallet.ogmios.sync
import munit.CatsEffectSuite
import sttp.client3.UriContext
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

import scala.concurrent.duration.*

class JsonWebSocketClientSpec extends CatsEffectSuite {

  import JsonWebSocketClientSpec.*

  private val sttpBackend = FetchCatsBackend[IO]()

  private implicit val clientSyncTracer: ogmios.sync.tracer.ClientRequestResponseTracer[IO] =
    Tracer.discardTracer[IO]

  test("Creating the websocket client should be lazy (i.e. do nothing until Resource is used)") {
    // if creation would already open the socket, the following line would throw an exception
    val _ = sync.util.json.SttpJsonWebSocketClient[IO](sttpBackend, uri"ws://nonexisting:1234/")
    IO.delay(assert(true))
  }
  test("Sending should also be lazy") {
    TestWebSocketBuilder.build[IO](port).use { server =>
      sync.util.json.SttpJsonWebSocketClient[IO](sttpBackend, wsUri).use { ws =>
        // the following line should not send a message via the websocket since the returned IO is not run
        val _ = ws.send("foo")
        for {
          _ <- ws.send("bar") // this line should send a message
          _ <- IO.sleep(1.second)
          size <- server.msgCounter.get
        } yield assert(size === 1)
      }
    }
  }
}

object JsonWebSocketClientSpec {
  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  val port: Port = Port.fromInt(5100).get
  val wsUri: Uri = uri"ws://127.0.0.1:${port.value}/"
}
