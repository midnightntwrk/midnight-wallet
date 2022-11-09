package io.iohk.midnight.wallet.ogmios.sync

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.iohk.midnight.js.interop.facades.rxjs.Observable
import io.iohk.midnight.js.interop.util.ObservableOps.FromStream
import io.iohk.midnight.tracer.logging.ConsoleTracer
import io.iohk.midnight.wallet.ogmios.network.SttpJsonWebSocketClient
import io.iohk.midnight.wallet.ogmios.network.JsonWebSocketClientTracer
import io.iohk.midnight.wallet.ogmios.sync.tracing.OgmiosSyncTracer
import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri
import typings.midnightMockedNodeApi.blockMod.Block
import typings.midnightMockedNodeApi.transactionMod.Transaction
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.ContextAwareLog

/** Translation layer from Scala into JS types:
  *   - fs2.Stream into rxjs.Observable
  *   - blockchain.data.Block into midnightMockedNodeApi.blockMod.Block
  *
  * This class implements the methods exposed in `main.d.ts`
  * @param syncService
  *   The Scala OgmiosSyncService
  * @param finalizer
  *   An effect that will be called upon `close()` execution
  */
@JSExportTopLevel("OgmiosSyncService")
class JsOgmiosSyncService(syncService: OgmiosSyncService[IO], finalizer: IO[Unit]) {
  @JSExport
  def sync(): Observable[Block[Transaction]] =
    syncService
      .sync()
      .map(Transformer.transformBlock)
      .unsafeToObservable()

  @JSExport
  def close(): js.Promise[Unit] =
    finalizer.unsafeToPromise()
}

@JSExportTopLevel("OgmiosSyncServiceBuilder")
object JsOgmiosSyncServiceBuilder {
  @JSExport
  def build(nodeUri: String): js.Promise[JsOgmiosSyncService] = {
    implicit val simpleLogTracer: Tracer[IO, ContextAwareLog] = ConsoleTracer.contextAware
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[IO] =
      JsonWebSocketClientTracer.from(simpleLogTracer)
    implicit val ogmiosSyncTracer: OgmiosSyncTracer[IO] =
      OgmiosSyncTracer.from(simpleLogTracer)
    val sttpBackend = FetchCatsBackend[IO]()
    val parsedNodeUri = Uri.unsafeParse(nodeUri)

    SttpJsonWebSocketClient(sttpBackend, parsedNodeUri)
      .map(OgmiosSyncService(_))
      .allocated
      .map((new JsOgmiosSyncService(_, _)).tupled)
      .unsafeToPromise()
  }
}
