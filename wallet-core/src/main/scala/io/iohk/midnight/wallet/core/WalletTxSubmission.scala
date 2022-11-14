package io.iohk.midnight.wallet.core

import cats.MonadThrow
import cats.syntax.all.*
import io.iohk.midnight.wallet.core.WalletState.TransactionRejected
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import typings.midnightLedger.mod.*

trait WalletTxSubmission[F[_]] {
  def submitTransaction(transaction: Transaction): F[TransactionIdentifier]
}

object WalletTxSubmission {
  class Live[F[_]: MonadThrow](txSubmissionService: TxSubmissionService[F])
      extends WalletTxSubmission[F] {

    override def submitTransaction(ledgerTx: Transaction): F[TransactionIdentifier] =
      txSubmissionService
        .submitTransaction(LedgerSerialization.toTransaction(ledgerTx))
        .flatMap {
          case SubmissionResult.Accepted =>
            ledgerTx
              .identifiers()
              .headOption
              .fold(
                // $COVERAGE-OFF$ Can't generate a test transaction for this scenario
                NoTransactionIdentifiers.raiseError[F, TransactionIdentifier],
                // $COVERAGE-ON$
              )(_.pure)
          case SubmissionResult.Rejected(reason) => TransactionRejected(reason).raiseError
        }
  }

  sealed trait Error extends Exception
  final case object NoTransactionIdentifiers extends Error
}
