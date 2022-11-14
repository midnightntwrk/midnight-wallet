package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.wallet.blockchain.data.Transaction
import io.iohk.midnight.wallet.blockchain.util.implicits.Equality.*
import io.iohk.midnight.wallet.core.LedgerSerialization
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import typings.midnightLedger.mod.Transaction as LedgerTransaction

@SuppressWarnings(
  Array("org.wartremover.warts.DefaultArguments", "org.wartremover.warts.Var"),
)
class TxSubmissionServiceStub(
    var submittedTransactions: Set[Transaction] = Set.empty,
) extends TxSubmissionService[IO] {
  override def submitTransaction(transaction: Transaction): IO[SubmissionResult] = IO {
    submittedTransactions += transaction
    SubmissionResult.Accepted
  }

  def wasTxSubmitted(tx: LedgerTransaction): Boolean =
    submittedTransactions.exists(
      _.header.hash === LedgerSerialization.toHash(tx.transactionHash()),
    )
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
