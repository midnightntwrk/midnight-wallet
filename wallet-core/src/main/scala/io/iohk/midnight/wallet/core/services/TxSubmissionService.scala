package io.iohk.midnight.wallet.core.services

import cats.effect.IO
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult

trait TxSubmissionService[Transaction] {
  def submitTransaction(transaction: Transaction): IO[SubmissionResult]
}

object TxSubmissionService {
  sealed trait SubmissionResult
  object SubmissionResult {
    case object Accepted extends SubmissionResult
    final case class Rejected(reason: String) extends SubmissionResult
  }
}
