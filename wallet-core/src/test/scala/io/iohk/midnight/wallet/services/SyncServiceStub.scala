package io.iohk.midnight.wallet.services

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.domain.services.SyncService
import io.iohk.midnight.wallet.services.SubmitTxService.SubmissionResponse

@SuppressWarnings(
  Array("org.wartremover.warts.DefaultArguments", "org.wartremover.warts.Var"),
)
class SyncServiceStub(
    blocks: Seq[Block] = Seq.empty[Block],
    var submittedCallTransactions: Set[CallTransaction] = Set.empty,
    var submittedDeployTransactions: Set[DeployTransaction] = Set.empty,
) extends SubmitTxService[IO]
    with SyncService[IO] {
  override def submitTransaction(transaction: Transaction): IO[SubmissionResponse] =
    IO {
      transaction match {
        case call: CallTransaction =>
          submittedCallTransactions += call
          SubmissionResponse.Accepted
        case deploy: DeployTransaction =>
          submittedDeployTransactions += deploy
          SubmissionResponse.Accepted
      }
    }

  override def sync(): Stream[IO, Block] = Stream.emits(blocks)

  def wasCallTxSubmitted(hash: Hash[CallTransaction]): Boolean =
    submittedCallTransactions.exists(_.hash.contains(hash))

  def wasDeployTxSubmitted(hash: Hash[DeployTransaction]): Boolean =
    submittedDeployTransactions.exists(_.hash.contains(hash))
}

class FailingSyncService extends SubmitTxService[IO] with SyncService[IO] {
  override def submitTransaction(transaction: Transaction): IO[SubmissionResponse] =
    IO.raiseError(FailingSyncService.SyncServiceError)

  override def sync(): Stream[IO, Block] =
    Stream.raiseError[IO](FailingSyncService.SyncServiceError)
}

class FailingTxSubmissionSyncService(blocks: Seq[Block] = Seq.empty[Block])
    extends SubmitTxService[IO]
    with SyncService[IO] {
  override def submitTransaction(transaction: Transaction): IO[SubmissionResponse] =
    IO.raiseError(FailingSyncService.SyncServiceError)

  override def sync(): Stream[IO, Block] = Stream.emits(blocks)
}

object FailingSyncService {
  val SyncServiceError: Throwable = new Throwable("FailingSyncService")
}
