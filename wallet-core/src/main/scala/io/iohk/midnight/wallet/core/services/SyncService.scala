package io.iohk.midnight.wallet.core.services

import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.domain.TransactionHash

trait SyncService[F[_]] {
  def sync(lastHash: Option[TransactionHash] = None): Stream[F, Transaction]
}
