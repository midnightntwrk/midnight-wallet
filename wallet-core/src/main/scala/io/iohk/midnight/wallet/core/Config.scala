package io.iohk.midnight.wallet.core

import cats.Show
import io.iohk.midnight.wallet.zswap

final case class Config(
    initialState: Config.InitialState,
    discardTxHistory: Boolean,
)

object Config {
  sealed trait InitialState
  object InitialState {
    final case class CreateNew(networkId: zswap.NetworkId) extends InitialState
    final case class Seed(seed: String, networkId: zswap.NetworkId) extends InitialState
    final case class SerializedSnapshot(serialized: String) extends InitialState
    // This contains the users secrets, shouldn't be logged anywhere
    given Show[InitialState] = Show.show(_ => "******")
  }
}
