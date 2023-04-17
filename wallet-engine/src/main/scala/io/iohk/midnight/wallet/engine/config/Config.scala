package io.iohk.midnight.wallet.engine.config

import cats.Show
import cats.syntax.apply.*
import io.iohk.midnight.midnightLedger.mod.ZSwapLocalState
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.engine.config.Config.ParseError.InvalidLogLevel

final case class Config(
    nodeConnection: NodeConnectionResourced,
    initialState: ZSwapLocalState,
    minLogLevel: LogLevel,
)

object Config {
  def parse(rawConfig: RawConfig): Either[Throwable, Config] =
    (
      Right(NodeConnectionResourced(rawConfig.nodeConnection)),
      parseInitialState(rawConfig.initialState),
      parseLogLevel(rawConfig.minLogLevel),
    )
      .mapN(Config.apply)

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
    final case class InvalidLogLevel(msg: String) extends ParseError(msg)
  }
}
