package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.wallet.blockchain.data.{
  CallTransaction,
  DeployTransaction,
  Hash,
  Transaction,
}
import io.iohk.midnight.wallet.blockchain.util.implicits.Equality.*
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult

@SuppressWarnings(
  Array("org.wartremover.warts.DefaultArguments", "org.wartremover.warts.Var"),
)
class TxSubmissionServiceStub(
    var submittedCallTransactions: Set[CallTransaction] = Set.empty,
    var submittedDeployTransactions: Set[DeployTransaction] = Set.empty,
) extends TxSubmissionService[IO] {
  override def submitTransaction(
      transaction: Transaction,
  ): IO[SubmissionResult] =
    IO {
      transaction match {
        case call: CallTransaction =>
          submittedCallTransactions += call
          SubmissionResult.Accepted
        case deploy: DeployTransaction =>
          submittedDeployTransactions += deploy
          SubmissionResult.Accepted
      }
    }

  def wasCallTxSubmitted(hash: Hash[CallTransaction]): Boolean =
    submittedCallTransactions.exists(_.hash === hash)

  def wasDeployTxSubmitted(hash: Hash[DeployTransaction]): Boolean =
    submittedDeployTransactions.exists(_.hash === hash)
}

class FailingTxSubmissionServiceStub() extends TxSubmissionService[IO] {
  override def submitTransaction(transaction: Transaction): IO[SubmissionResult] =
    IO.raiseError(FailingTxSubmissionServiceStub.TxSubmissionServiceError)
}

object FailingTxSubmissionServiceStub {
  val TxSubmissionServiceError: Throwable = new Throwable("FailingTxSubmissionServiceStub")
}

class RejectedTxSubmissionServiceStub() extends TxSubmissionService[IO] {
  override def submitTransaction(transaction: Transaction): IO[SubmissionResult] =
    IO.pure(SubmissionResult.Rejected(RejectedTxSubmissionServiceStub.errorMsg))
}

object RejectedTxSubmissionServiceStub {
  val errorMsg = "RejectedTxSubmissionServiceStub"
}
