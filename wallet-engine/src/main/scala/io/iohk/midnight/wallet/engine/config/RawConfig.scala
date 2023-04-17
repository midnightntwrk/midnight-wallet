package io.iohk.midnight.wallet.engine.config

import cats.Show
import io.iohk.midnight.wallet.engine.js.NodeConnection

final case class RawConfig(
    nodeConnection: NodeConnection,
    initialState: Option[String],
    minLogLevel: Option[String],
)

object RawConfig {
  implicit val rawConfigShow: Show[RawConfig] = Show.fromToString
}
