package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.{IndexerEvent, Transaction}

trait SyncService {
  def sync(offset: Option[Transaction.Offset]): Stream[IO, IndexerEvent]
}
