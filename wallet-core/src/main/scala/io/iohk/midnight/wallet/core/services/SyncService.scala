package io.iohk.midnight.wallet.core.services

import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.domain.IndexerUpdate

trait SyncService[F[_]] {
  def sync(blockHeight: Option[Block.Height]): Stream[F, IndexerUpdate]
}
