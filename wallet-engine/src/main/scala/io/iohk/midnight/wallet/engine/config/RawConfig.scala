package io.iohk.midnight.wallet.engine.config

import cats.Show
import io.iohk.midnight.wallet.core.Config.InitialState

final case class RawConfig(
    indexerUri: String,
    indexerWsUri: String,
    provingServerUri: String,
    substrateNodeUri: String,
    minLogLevel: Option[String],
    initialState: InitialState,
    discardTxHistory: Option[Boolean],
)

object RawConfig {
  given Show[RawConfig] = Show.fromToString
}
