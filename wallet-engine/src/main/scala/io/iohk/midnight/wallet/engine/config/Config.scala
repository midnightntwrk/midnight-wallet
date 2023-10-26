package io.iohk.midnight.wallet.engine.config

import cats.Show
import cats.syntax.all.*
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.config.Config.ParseError.{
  InvalidBlockHeight,
  InvalidLogLevel,
  InvalidUri,
}
import io.iohk.midnight.wallet.zswap.LocalState
import sttp.model.Uri

final case class Config(
    indexerUri: Uri,
    indexerWsUri: Uri,
    provingServerUri: Uri,
    substrateNodeUri: Uri,
    initialState: LocalState,
    blockHeight: Option[Block.Height],
    minLogLevel: LogLevel,
)

object Config {
  def parse(rawConfig: RawConfig): Either[Throwable, Config] =
    (
      Uri.parse(rawConfig.indexerUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.indexerWsUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.provingServerUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.substrateNodeUri).leftMap(InvalidUri.apply),
      parseInitialState(rawConfig.initialState),
      rawConfig.blockHeight.traverse(Block.Height.apply).leftMap(InvalidBlockHeight.apply),
      parseLogLevel(rawConfig.minLogLevel),
    )
      .mapN(Config.apply)

  private def parseInitialState(initialState: Option[String]): Either[Throwable, LocalState] =
    initialState
      .map(LedgerSerialization.parseState)
      .getOrElse(Right(LocalState()))

  private def parseLogLevel(minLogLevel: Option[String]): Either[Throwable, LogLevel] =
    minLogLevel match {
      case Some(providedLogLevel) =>
        LogLevel
          .fromString(providedLogLevel)
          .toRight(InvalidLogLevel(s"Invalid log level: $providedLogLevel"))
      case None =>
        Right(LogLevel.Warn)
    }

  implicit val configShow: Show[Config] = Show.fromToString

  abstract class ParseError(msg: String) extends Throwable(msg)
  object ParseError {
    final case class InvalidLogLevel(msg: String) extends ParseError(msg)
    final case class InvalidUri(msg: String) extends ParseError(msg)
    final case class InvalidBlockHeight(msg: String) extends ParseError(msg)
  }
}
