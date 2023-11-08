package io.iohk.midnight.wallet.engine.config

import cats.Show
import cats.syntax.all.*
import io.iohk.midnight.tracer.logging.LogLevel
import io.iohk.midnight.wallet.core.Wallet
import io.iohk.midnight.wallet.engine.config.Config.ParseError.{
  InvalidLogLevel,
  InvalidSerializedSnapshot,
  InvalidUri,
}
import io.iohk.midnight.wallet.engine.config.RawConfig.InitialState
import sttp.model.Uri

final case class Config(
    indexerUri: Uri,
    indexerWsUri: Uri,
    provingServerUri: Uri,
    substrateNodeUri: Uri,
    minLogLevel: LogLevel,
    initialState: Wallet.Snapshot,
)

object Config {
  def parse(rawConfig: RawConfig): Either[Throwable, Config] =
    (
      Uri.parse(rawConfig.indexerUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.indexerWsUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.provingServerUri).leftMap(InvalidUri.apply),
      Uri.parse(rawConfig.substrateNodeUri).leftMap(InvalidUri.apply),
      parseLogLevel(rawConfig.minLogLevel),
      parseInitialState(rawConfig.initialState),
    )
      .mapN(Config.apply)

  private def parseInitialState(
      initialState: Option[RawConfig.InitialState],
  ): Either[Throwable, Wallet.Snapshot] =
    (initialState match {
      case None                                              => Wallet.Snapshot.create.asRight
      case Some(InitialState.Seed(seed))                     => Wallet.Snapshot.fromSeed(seed)
      case Some(InitialState.SerializedSnapshot(serialized)) => Wallet.Snapshot.parse(serialized)
    }).leftMap(t => InvalidSerializedSnapshot.apply(t.getMessage))

  def parseLogLevel(minLogLevel: Option[String]): Either[Throwable, LogLevel] =
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
    final case class InvalidSerializedSnapshot(msg: String) extends ParseError(msg)
  }
}
