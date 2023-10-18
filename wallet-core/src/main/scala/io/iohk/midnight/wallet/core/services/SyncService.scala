package io.iohk.midnight.wallet.core.services

import fs2.Stream
import io.iohk.midnight.wallet.core.domain.{TransactionHash, ViewingUpdate}

trait SyncService[F[_]] {
  def sync(
      lastHash: Option[TransactionHash] = None,
      lastIndex: Option[BigInt] = None,
  ): Stream[F, ViewingUpdate]
}
