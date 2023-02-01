package io.iohk.midnight.wallet.engine.config

import cats.Show
import cats.syntax.apply.*
import cats.syntax.bifunctor.*
import io.iohk.midnight.midnightLedger.mod.ZSwapLocalState
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.config.Config.ParseError.{InvalidLogLevel, InvalidUri}
import io.iohk.midnight.wallet.engine.config.NodeConnection.{NodeInstance, NodeUri}
import sttp.model.Uri

final case class Config(
    nodeConnection: NodeConnection,
    initialState: ZSwapLocalState,
    minLogLevel: LogLevel,
)

object Config {
  def parse(rawConfig: RawConfig): Either[Throwable, Config] =
    (
      parseConnection(rawConfig.nodeConnection),
      parseInitialState(rawConfig.initialState),
      parseLogLevel(rawConfig.minLogLevel),
    )
      .mapN(Config.apply)

  private def parseConnection(
      rawNodeConnection: RawNodeConnection,
  ): Either[Throwable, NodeConnection] =
    rawNodeConnection match {
      case RawNodeConnection.RawNodeInstance(instance) =>
        Right(NodeInstance(instance))
      case RawNodeConnection.RawNodeUri(uri) =>
        Uri.parse(uri).map(NodeUri).leftMap(InvalidUri)
    }

  private def parseInitialState(initialState: Option[String]): Either[Throwable, ZSwapLocalState] =
    initialState
      .map(LedgerSerialization.parseState)
      .getOrElse(Right(new ZSwapLocalState()))

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
    final case class InvalidUri(msg: String) extends ParseError(msg)
    final case class InvalidLogLevel(msg: String) extends ParseError(msg)
  }
}
