package io.iohk.midnight.wallet.core.combinator

import fs2.Stream
import io.iohk.midnight.wallet.core.WalletStateService
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}

trait VersionCombination[F[_]] {
  def sync: F[Unit]

  def state: Stream[F, State]

  def serializeState: F[SerializedWalletState]
}
