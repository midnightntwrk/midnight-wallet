package io.iohk.midnight.wallet.services

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.services.SyncService.SubmissionResponse

@SuppressWarnings(
  Array("org.wartremover.warts.DefaultArguments", "org.wartremover.warts.Var"),
)
class SyncServiceStub(
    blocks: Seq[Block] = Seq.empty[Block],
    var submittedCallTransactions: Set[CallTransaction] = Set.empty,
    var submittedDeployTransactions: Set[DeployTransaction] = Set.empty,
) extends SyncService[IO] {
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

  override def sync(): IO[Stream[IO, Block]] = IO.pure(Stream.emits(blocks))

  def wasCallTxSubmitted(hash: Hash[CallTransaction]): Boolean =
    submittedCallTransactions.exists(_.hash.contains(hash))

  def wasDeployTxSubmitted(hash: Hash[DeployTransaction]): Boolean =
    submittedDeployTransactions.exists(_.hash.contains(hash))
}

class FailingSyncService extends SyncService[IO] {
  override def submitTransaction(transaction: Transaction): IO[SubmissionResponse] =
    IO.raiseError(FailingSyncService.SyncServiceError)

  override def sync(): IO[Stream[IO, Block]] =
    IO.raiseError(FailingSyncService.SyncServiceError)
}

class FailingTxSubmissionSyncService(blocks: Seq[Block] = Seq.empty[Block])
    extends SyncService[IO] {
  override def submitTransaction(transaction: Transaction): IO[SubmissionResponse] =
    IO.raiseError(FailingSyncService.SyncServiceError)

  override def sync(): IO[Stream[IO, Block]] = IO.pure(Stream.emits(blocks))
}

object FailingSyncService {
  val SyncServiceError: Exception = new Exception("FailingSyncService")
}
