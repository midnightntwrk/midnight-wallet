package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.Block

@SuppressWarnings(
  Array("org.wartremover.warts.DefaultArguments", "org.wartremover.warts.Var"),
)
class SyncServiceStub(
    blocks: Seq[Block] = Seq.empty[Block],
) extends SyncService[IO] {
  override def sync(): Stream[IO, Block] = Stream.emits(blocks)
}

class FailingSyncServiceStub extends SyncService[IO] {

  override def sync(): Stream[IO, Block] =
    Stream.raiseError[IO](FailingSyncServiceStub.SyncServiceError)
}

object FailingSyncServiceStub {
  val SyncServiceError: Throwable = new Throwable("FailingSyncService")
}
