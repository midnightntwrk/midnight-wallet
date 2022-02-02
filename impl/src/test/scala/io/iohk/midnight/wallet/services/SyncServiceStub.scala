package io.iohk.midnight.wallet.services

import cats.effect.SyncIO
import fs2.Stream
import io.iohk.midnight.wallet.domain.*
import io.iohk.midnight.wallet.services.SyncService.SubmissionResponse

@SuppressWarnings(
  Array("org.wartremover.warts.DefaultArguments", "org.wartremover.warts.Var"),
)
class SyncServiceStub(
    private var submittedCallTransactions: Set[Hash[CallTransaction]] = Set.empty,
    private var submittedDeployTransactions: Set[Hash[DeployTransaction]] = Set.empty,
) extends SyncService[SyncIO] {
  override def submitTransaction(transaction: Transaction): SyncIO[SubmissionResponse] =
    SyncIO {
      transaction match {
        case call: CallTransaction =>
          call.hash.foreach(submittedCallTransactions += _)
          SubmissionResponse.Accepted
        case deploy: DeployTransaction =>
          deploy.hash.foreach(submittedDeployTransactions += _)
          SubmissionResponse.Accepted
      }
    }

  override def sync(): SyncIO[Stream[SyncIO, Block]] = SyncIO.pure(Stream.empty)

  def wasCallTxSubmitted(hash: Hash[CallTransaction]): Boolean =
    submittedCallTransactions.contains(hash)

  def wasDeployTxSubmitted(hash: Hash[DeployTransaction]): Boolean =
    submittedDeployTransactions.contains(hash)
}

class FailingSyncService extends SyncService[SyncIO] {
  override def submitTransaction(transaction: Transaction): SyncIO[SubmissionResponse] =
    SyncIO.raiseError(FailingSyncService.SyncServiceError)

  override def sync(): SyncIO[Stream[SyncIO, Block]] =
    SyncIO.raiseError(FailingSyncService.SyncServiceError)
}

object FailingSyncService {
  val SyncServiceError = new Exception("FailingSyncService")
}
