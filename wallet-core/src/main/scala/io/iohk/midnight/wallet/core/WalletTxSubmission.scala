package io.iohk.midnight.wallet.core

import cats.MonadThrow
import cats.syntax.all.*
import io.iohk.midnight.wallet.core.services.{BalanceTransactionService, TxSubmissionService}
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import typings.midnightLedger.mod.*

trait WalletTxSubmission[F[_]] {
  def submitTransaction(transaction: Transaction): F[TransactionIdentifier]
}

object WalletTxSubmission {
  class Live[F[_]: MonadThrow](
      txSubmissionService: TxSubmissionService[F],
      balanceTransactionService: BalanceTransactionService[F],
      walletState: WalletState[F],
  ) extends WalletTxSubmission[F] {

    override def submitTransaction(ledgerTx: Transaction): F[TransactionIdentifier] = {
      for {
        balancedTxAndState <- balanceTransactionService.balanceTransaction(ledgerTx)
        balancedTx = balancedTxAndState._1
        state = balancedTxAndState._2
        response <- txSubmissionService
          .submitTransaction(LedgerSerialization.toTransaction(balancedTx))
        result <- response match {
          case SubmissionResult.Accepted =>
            walletState.updateLocalState(state).flatMap { _ =>
              ledgerTx
                .identifiers()
                .headOption
                .fold(
                  // $COVERAGE-OFF$ Can't generate a test transaction for this scenario
                  NoTransactionIdentifiers.raiseError[F, TransactionIdentifier],
                  // $COVERAGE-ON$
                )(_.pure)
            }
          case SubmissionResult.Rejected(reason) => TransactionRejected(reason).raiseError
        }
      } yield result
    }
  }

  abstract class Error(msg: String) extends Exception(msg)
  final case object NoTransactionIdentifiers
      extends Error("Transaction did not contain an identifier")
  final case class TransactionRejected(reason: String)
      extends Error(reason) // FIXME not an exception
}
