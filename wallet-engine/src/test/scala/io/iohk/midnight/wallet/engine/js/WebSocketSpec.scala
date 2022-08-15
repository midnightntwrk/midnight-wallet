package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.wallet.ogmios
import io.iohk.midnight.wallet.ogmios.sync
import munit.CatsEffectSuite
import sttp.client3.UriContext
import sttp.client3.impl.cats.FetchCatsBackend

class WebSocketSpec extends CatsEffectSuite {

  private val wsUri = uri"ws://127.0.0.1:5100/"
  private val sttpBackend = FetchCatsBackend[IO]()

  private implicit val clientSyncTracer: ogmios.sync.tracer.ClientRequestResponseTracer[IO] =
    Tracer.discardTracer[IO]

  test("Open websocket".ignore) {
    sync.util.json.SttpJsonWebSocketClient[IO](sttpBackend, wsUri).use { _ =>
      IO.delay(assert(true))
    }
  }
}
