package io.iohk.midnight.wallet.engine.config

import cats.Show
import cats.syntax.all.*
import io.iohk.midnight.js.interop.TracerCarrier
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.Config.InitialState
import io.iohk.midnight.wallet.engine.config.Config.ParseError.{InvalidLogLevel, InvalidUri}
import sttp.model.Uri

import scala.scalajs.js.annotation.{JSExportAll, JSExportTopLevel}

@JSExportAll
@JSExportTopLevel("Config")
final case class Config(
    indexerUri: Uri,
    indexerWsUri: Uri,
    provingServerUri: Uri,
    substrateNodeUri: Uri,
    minLogLevel: LogLevel,
    initialState: InitialState,
    discardTxHistory: Boolean,
)

@JSExportAll
object Config {
  def parse(rawConfig: RawConfig): Either[Throwable, Config] =
    (
      Uri.parse(rawConfig.indexerUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.indexerWsUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.provingServerUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.substrateNodeUri).leftMap(InvalidUri.apply),
      TracerCarrier.parseLogLevel(rawConfig.minLogLevel).leftMap(InvalidLogLevel.apply),
      rawConfig.initialState.asRight,
      rawConfig.discardTxHistory.getOrElse(false).asRight,
    )
      .mapN(Config.apply)

  given configShow: Show[Config] = Show.fromToString

  abstract class ParseError(msg: String) extends Throwable(msg)
  object ParseError {
    final case class InvalidLogLevel(msg: String) extends ParseError(msg)
    final case class InvalidUri(msg: String) extends ParseError(msg)
  }
}
