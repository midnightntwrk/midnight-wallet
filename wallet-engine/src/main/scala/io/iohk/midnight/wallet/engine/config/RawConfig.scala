package io.iohk.midnight.wallet.engine.config

import cats.Show
import io.iohk.midnight.midnightNtwrkZswap.mod
import io.iohk.midnight.wallet.engine.config.RawConfig.InitialState

final case class RawConfig(
    indexerUri: String,
    indexerWsUri: String,
    provingServerUri: String,
    substrateNodeUri: String,
    networkId: Option[mod.NetworkId],
    minLogLevel: Option[String],
    initialState: Option[InitialState],
    discardTxHistory: Option[Boolean],
)

object RawConfig {
  implicit val rawConfigShow: Show[RawConfig] = Show.fromToString

  sealed trait InitialState
  object InitialState {
    final case class Seed(seed: String) extends InitialState
    final case class SerializedSnapshot(serialized: String) extends InitialState
    // This contains the users secrets, shouldn't be logged anywhere
    given Show[InitialState] = Show.show(_ => "******")
  }
}
