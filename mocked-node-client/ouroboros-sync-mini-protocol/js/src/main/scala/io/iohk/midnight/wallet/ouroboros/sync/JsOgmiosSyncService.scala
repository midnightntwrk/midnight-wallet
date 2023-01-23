package io.iohk.midnight.wallet.ouroboros.sync

import cats.Show as CatsShow
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Decoder as CirceDecoder
import io.iohk.midnight.js.interop.util.ObservableOps.FromStream
import io.iohk.midnight.rxjs.mod.Observable_
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.{ConsoleTracer, LogLevel, StructuredLog}
import io.iohk.midnight.wallet.ouroboros.network.{
  JsonWebSocketClientTracer,
  SttpJsonWebSocketClient,
}
import io.iohk.midnight.wallet.ouroboros.sync.interop.*
import io.iohk.midnight.wallet.ouroboros.sync.tracing.OuroborosSyncTracer
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportTopLevel}

/** Translation layer from Scala into JS types:
  *   - fs2.Stream into rxjs.Observable
  *
  * This class implements the methods exposed in `main.d.ts`
  * @param syncService
  *   The Scala OuroborosSyncService
  * @param finalizer
  *   An effect that will be called upon `close()` execution
  */
@JSExportTopLevel("OuroborosSyncService")
class JsOuroborosSyncService[Block](
    syncService: OuroborosSyncService[IO, Block],
    finalizer: IO[Unit],
) {
  @JSExport
  def sync(): Observable_[Block] =
    syncService.sync.unsafeToObservable()

  @JSExport
  def close(): js.Promise[Unit] =
    finalizer.unsafeToPromise()
}

@JSExportTopLevel("OuroborosSyncServiceBuilder")
object JsOuroborosSyncServiceBuilder {

  @JSExport
  def build[Block](
      nodeUri: String,
      blockDecoder: Decoder[Block],
      blockShow: Show[Block],
      minLogLevel: js.UndefOr[String],
  ): js.Promise[JsOuroborosSyncService[Block]] = {
    val parsedLogLevel = minLogLevel.toOption.flatMap(LogLevel.fromString).getOrElse(LogLevel.Warn)

    implicit val structuredLogTracer: Tracer[IO, StructuredLog] =
      ConsoleTracer.contextAware(parsedLogLevel)
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[IO] =
      JsonWebSocketClientTracer.from(structuredLogTracer)
    implicit val ouroborosSyncTracer: OuroborosSyncTracer[IO] =
      OuroborosSyncTracer.from(structuredLogTracer)

    val sttpBackend = FetchCatsBackend[IO]()
    val parsedNodeUri = Uri.unsafeParse(nodeUri)

    @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
    implicit val circeDecoder: CirceDecoder[Block] = {
      CirceDecoder[String].emap { rawString =>
        val rawResult = blockDecoder.decode(rawString)

        if (rawResult.hasOwnProperty("value")) { // Success
          Right(rawResult.asInstanceOf[Success[Block]].value)
        } else { // Failure
          Left(rawResult.asInstanceOf[Failure].message)
        }
      }
    }

    implicit val catsShow: CatsShow[Block] =
      CatsShow.show[Block](blockShow.show)

    SttpJsonWebSocketClient(sttpBackend, parsedNodeUri)
      .flatMap(OuroborosSyncService(_))
      .allocated
      .map((new JsOuroborosSyncService[Block](_, _)).tupled)
      .unsafeToPromise()
  }
}
