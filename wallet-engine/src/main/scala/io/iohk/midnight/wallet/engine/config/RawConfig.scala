package io.iohk.midnight.wallet.engine.config

import cats.Show

final case class RawConfig(
    indexerUri: String,
    indexerWsUri: String,
    provingServerUri: String,
    substrateNodeUri: String,
    initialState: Option[String],
    minLogLevel: Option[String],
)

object RawConfig {
  implicit val rawConfigShow: Show[RawConfig] = Show.fromToString
}
