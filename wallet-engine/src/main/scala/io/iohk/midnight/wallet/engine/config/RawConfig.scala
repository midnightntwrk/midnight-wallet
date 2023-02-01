package io.iohk.midnight.wallet.engine.config

import cats.Show

final case class RawConfig(
    nodeConnection: RawNodeConnection,
    initialState: Option[String],
    minLogLevel: Option[String],
)

object RawConfig {
  implicit val rawConfigShow: Show[RawConfig] = Show.fromToString
}
