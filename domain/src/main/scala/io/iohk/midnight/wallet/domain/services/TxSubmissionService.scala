package io.iohk.midnight.wallet.domain.services

import io.iohk.midnight.wallet.domain.Transaction
import io.iohk.midnight.wallet.domain.services.TxSubmissionService.SubmissionResult

trait TxSubmissionService[F[_]] {
  def submitTransaction(transaction: Transaction): F[SubmissionResult]
}

object TxSubmissionService {
  sealed trait SubmissionResult
  object SubmissionResult {
    case object Accepted extends SubmissionResult
    final case class Rejected(reason: String) extends SubmissionResult
  }
}
