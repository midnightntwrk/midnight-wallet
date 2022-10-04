package io.iohk.midnight.wallet.ogmios.sync

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.iohk.midnight.js.interop.facades.rxjs.Observable
import io.iohk.midnight.js.interop.util.ObservableOps.FromStream
import io.iohk.midnight.tracer.logging.ConsoleTracer
import io.iohk.midnight.wallet.ogmios.network.SttpJsonWebSocketClient
import io.iohk.midnight.wallet.ogmios.tracer.ClientRequestResponseTracer
import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri
import typings.midnightMockedNodeApi.blockMod.Block
import typings.midnightMockedNodeApi.transactionMod.Transaction

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
class JsOgmiosSyncService(syncService: OgmiosSyncService[IO], finalizer: IO[Unit]) {
  def sync(): Observable[Block[Transaction]] =
    syncService
      .sync()
      .map(Transformer.transformBlock)
      .unsafeToObservable()

  def close(): js.Promise[Unit] =
    finalizer.unsafeToPromise()
}

@JSExportTopLevel("OgmiosSyncServiceBuilder")
object JsOgmiosSyncServiceBuilder {
  @JSExport
  def build(nodeUri: String): js.Promise[JsOgmiosSyncService] = {
    implicit val clientTracer: ClientRequestResponseTracer[IO] = ConsoleTracer.apply
    val sttpBackend = FetchCatsBackend[IO]()
    val parsedNodeUri = Uri.unsafeParse(nodeUri)

    SttpJsonWebSocketClient(sttpBackend, parsedNodeUri)
      .map(OgmiosSyncService(_))
      .allocated
      .map((new JsOgmiosSyncService(_, _)).tupled)
      .unsafeToPromise()
  }
}
