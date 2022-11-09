package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.ogmios.network.SttpJsonWebSocketClient
import munit.CatsEffectSuite
import sttp.client3.UriContext
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri
import com.comcast.ip4s.Port
import io.iohk.midnight.wallet.engine.util.TestWebSocketBuilder
import io.iohk.midnight.wallet.ogmios.network.JsonWebSocketClientTracer

/** This test verifies that the websocket related initialization code in
  * [[io.iohk.midnight.wallet.engine.js.Init]] works.
  */
class WebSocketInitSpec extends CatsEffectSuite {

  import WebSocketInitSpec.*

  private val sttpBackend = FetchCatsBackend[IO]()

  private implicit val clientTracer: JsonWebSocketClientTracer[IO] =
    JsonWebSocketClientTracer.from(Tracer.discardTracer)

  test("Open websocket") {
    TestWebSocketBuilder.build[IO](port).use { _ =>
      SttpJsonWebSocketClient[IO](sttpBackend, wsUri).use { _ =>
        IO.delay(assert(true))
      }
    }
  }
}

object WebSocketInitSpec {
  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  val port: Port = Port.fromInt(5200).get
  val wsUri: Uri = uri"ws://127.0.0.1:${port.value}/"
}
