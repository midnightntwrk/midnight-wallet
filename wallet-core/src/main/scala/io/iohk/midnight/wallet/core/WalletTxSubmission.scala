package io.iohk.midnight.wallet.core

import cats.effect.kernel.Sync
import cats.syntax.all.*
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.services.{BalanceTransactionService, TxSubmissionService}
import typings.midnightLedger.mod.*

trait WalletTxSubmission[F[_]] {
  def submitTransaction(
      transaction: Transaction,
      newCoins: List[CoinInfo],
  ): F[TransactionIdentifier]
}

object WalletTxSubmission {
  class Live[F[_]: Sync](
      txSubmissionService: TxSubmissionService[F],
      balanceTransactionService: BalanceTransactionService[F],
      walletState: WalletState[F],
  ) extends WalletTxSubmission[F] {

    override def submitTransaction(
        ledgerTx: Transaction,
        newCoins: List[CoinInfo],
    ): F[TransactionIdentifier] = {
      for {
        _ <- validateTx(ledgerTx)
        balancedTxAndState <- balanceTransactionService.balanceTransaction(ledgerTx)
        (balancedTx, state) = balancedTxAndState
        stateWithPendingNewCoins = newCoins.foldLeft(state)(_.watchFor(_))
        _ <- walletState.updateLocalState(stateWithPendingNewCoins)
        response <- txSubmissionService
          .submitTransaction(LedgerSerialization.toTransaction(balancedTx))
        result <- response match {
          case SubmissionResult.Accepted =>
            ledgerTx
              .identifiers()
              .headOption
              .fold(
                // $COVERAGE-OFF$ Can't generate a test transaction for this scenario
                NoTransactionIdentifiers.raiseError[F, TransactionIdentifier],
                // $COVERAGE-ON$
              )(_.pure)
          case SubmissionResult.Rejected(reason) =>
            // we should clear the pending spends here, but we don't have an API now
            TransactionRejected(reason).raiseError
        }
      } yield result
    }

    private def validateTx(tx: Transaction): F[Unit] = {
      Sync[F]
        .delay(tx.wellFormed(enforceBalancing = false))
        .ifM(
          ().pure,
          TransactionNotWellFormed.raiseError,
        )
    }
  }

  abstract class Error(msg: String) extends Exception(msg)
  final case object NoTransactionIdentifiers
      extends Error("Transaction did not contain an identifier")
  final case object TransactionNotWellFormed extends Error("Transaction is not well formed")
  final case class TransactionRejected(reason: String)
      extends Error(reason) // FIXME not an exception
}
