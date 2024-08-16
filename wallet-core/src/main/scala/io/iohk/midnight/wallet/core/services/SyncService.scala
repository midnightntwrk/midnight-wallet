package io.iohk.midnight.wallet.core.services

import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, Transaction}

trait SyncService[F[_]] {
  def sync(offset: Option[Transaction.Offset]): Stream[F, IndexerEvent]
}
