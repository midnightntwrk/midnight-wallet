package io.iohk.midnight.wallet.domain.services

import fs2.Stream
import io.iohk.midnight.wallet.domain.Block

trait SyncService[F[_]] {
  def sync(): Stream[F, Block]
}
