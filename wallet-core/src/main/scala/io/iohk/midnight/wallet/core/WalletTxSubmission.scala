package io.iohk.midnight.wallet.core

import cats.effect.Sync
import cats.syntax.all.*
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.tracing.WalletTxSubmissionTracer

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
  )(implicit tracer: WalletTxSubmissionTracer[F])
      extends WalletTxSubmission[F] {

    override def submitTransaction(
        ledgerTx: Transaction,
        newCoins: List[CoinInfo],
    ): F[TransactionIdentifier] = {
      for {
        _ <- tracer.submitTxStart(ledgerTx)
        _ <- validateTx(ledgerTx)
        state <- walletState.localState
        balancedTxAndState <- balanceTransactionService.balanceTransaction(state, ledgerTx)
        (balancedTx, state) = balancedTxAndState
        _ = newCoins.foreach(state.watchFor)
        _ <- walletState.updateLocalState(state)
        response <- txSubmissionService
          .submitTransaction(LedgerSerialization.toTransaction(balancedTx))
        result <- adaptResponse(ledgerTx, response)
      } yield result
    }

    private def validateTx(ledgerTx: Transaction): F[Unit] = {
      Either
        .catchNonFatal(ledgerTx.wellFormed(enforceBalancing = false))
        .leftMap(TransactionNotWellFormed.apply)
        .liftTo[F]
    }

    private def adaptResponse(
        ledgerTx: Transaction,
        submissionResult: SubmissionResult,
    ): F[TransactionIdentifier] = {
      val result: F[TransactionIdentifier] = submissionResult match {
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
      result.attemptTap {
        case Right(txId) => tracer.submitTxSuccess(ledgerTx, txId)
        case Left(error) => tracer.submitTxError(ledgerTx, error)
      }
    }
  }

  abstract class Error(msg: String) extends Exception(msg)
  final case object NoTransactionIdentifiers
      extends Error("Transaction did not contain an identifier")
  final case class TransactionNotWellFormed(reason: Throwable)
      extends Error(s"Transaction is not well formed: ${reason.getMessage}")
  final case class TransactionRejected(reason: String)
      extends Error(reason) // FIXME not an exception
}
