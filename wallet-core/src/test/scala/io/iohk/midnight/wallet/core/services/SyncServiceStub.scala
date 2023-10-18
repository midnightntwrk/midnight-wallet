package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.core.domain.{TransactionHash, ViewingUpdate}

class SyncServiceStub(updates: Seq[ViewingUpdate] = Seq.empty[ViewingUpdate])
    extends SyncService[IO] {
  override def sync(
      lastHash: Option[TransactionHash] = None,
      lastIndex: Option[BigInt] = None,
  ): Stream[IO, ViewingUpdate] =
    Stream.emits(updates)
}

class FailingSyncServiceStub extends SyncService[IO] {
  override def sync(
      lastHash: Option[TransactionHash] = None,
      lastIndex: Option[BigInt],
  ): Stream[IO, ViewingUpdate] =
    Stream.raiseError[IO](FailingSyncServiceStub.SyncServiceError)
}

object FailingSyncServiceStub {
  val SyncServiceError: Throwable = new Throwable("FailingSyncService")
}
