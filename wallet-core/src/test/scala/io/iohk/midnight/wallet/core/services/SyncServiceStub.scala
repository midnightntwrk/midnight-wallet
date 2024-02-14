package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.domain.ViewingUpdate

class SyncServiceStub(updates: Seq[ViewingUpdate] = Seq.empty[ViewingUpdate])
    extends SyncService[IO] {
  override def sync(offset: Option[Transaction.Offset]): Stream[IO, ViewingUpdate] =
    Stream.emits(updates)
}

class FailingSyncServiceStub extends SyncService[IO] {
  override def sync(offset: Option[Transaction.Offset]): Stream[IO, ViewingUpdate] =
    Stream.raiseError[IO](FailingSyncServiceStub.SyncServiceError)
}

object FailingSyncServiceStub {
  val SyncServiceError: Throwable = new Throwable("FailingSyncService")
}
