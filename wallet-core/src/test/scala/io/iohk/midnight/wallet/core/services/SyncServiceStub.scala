package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.core.domain.TransactionHash

@SuppressWarnings(
  Array("org.wartremover.warts.DefaultArguments", "org.wartremover.warts.Var"),
)
class SyncServiceStub(
    transactions: Seq[Transaction] = Seq.empty[Transaction],
) extends SyncService[IO] {
  override def sync(lastHash: Option[TransactionHash] = None): Stream[IO, Transaction] =
    Stream.emits(transactions)
}

class FailingSyncServiceStub extends SyncService[IO] {

  override def sync(lastHash: Option[TransactionHash] = None): Stream[IO, Transaction] =
    Stream.raiseError[IO](FailingSyncServiceStub.SyncServiceError)
}

object FailingSyncServiceStub {
  val SyncServiceError: Throwable = new Throwable("FailingSyncService")
}
