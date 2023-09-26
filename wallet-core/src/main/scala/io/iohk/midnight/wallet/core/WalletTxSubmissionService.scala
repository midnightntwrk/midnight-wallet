package io.iohk.midnight.wallet.core

import cats.effect.Sync
import cats.syntax.all.*
import io.iohk.midnight.wallet.core.domain.TransactionIdentifier
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.tracing.WalletTxSubmissionTracer
import io.iohk.midnight.wallet.zswap

trait WalletTxSubmissionService[F[_]] {
  def submitTransaction(
      transaction: zswap.Transaction,
  ): F[TransactionIdentifier]
}

object WalletTxSubmissionService {
  class Live[F[_]: Sync, TWallet](
      submitTxService: TxSubmissionService[F],
  )(implicit tracer: WalletTxSubmissionTracer[F])
      extends WalletTxSubmissionService[F] {

    override def submitTransaction(
        toSubmitLedgerTx: zswap.Transaction,
    ): F[TransactionIdentifier] = {
      for {
        txId <- getIdentifier(toSubmitLedgerTx)
        _ <- tracer.submitTxStart(txId)
        _ <- validateTx(toSubmitLedgerTx, txId)
        response <- submitTxService.submitTransaction(toSubmitLedgerTx)
        result <- adaptResponse(txId, response)
      } yield result
    }

    private def getIdentifier(tx: zswap.Transaction): F[TransactionIdentifier] = {
      tx.identifiers.headOption
        .fold(
          // $COVERAGE-OFF$ Can't generate a test transaction for this scenario
          NoTransactionIdentifiers.raiseError[F, TransactionIdentifier],
          // $COVERAGE-ON$
        )(TransactionIdentifier(_).pure)
    }

    private def validateTx(ledgerTx: zswap.Transaction, txId: TransactionIdentifier): F[Unit] = {
      Either
        .catchNonFatal(
          ledgerTx.wellFormedNoProofs(enforceBalancing = false),
        ) // no proof check, as it is not working without public parameters in the system
        .leftMap(TransactionNotWellFormed.apply)
        .liftTo[F]
        .attemptTap {
          case Left(error) => tracer.txValidationError(txId, error)
          case Right(_)    => tracer.txValidationSuccess(txId)
        }
    }

    private def adaptResponse(
        txId: TransactionIdentifier,
        submissionResult: SubmissionResult,
    ): F[TransactionIdentifier] = {
      val result: F[TransactionIdentifier] = submissionResult match {
        case SubmissionResult.Accepted =>
          txId.pure
        case SubmissionResult.Rejected(reason) =>
          // we should clear the pending spends here, but we don't have an API now
          TransactionRejected(reason).raiseError
      }
      result.attemptTap {
        case Right(_) =>
          tracer.submitTxSuccess(txId)
        case Left(error) => tracer.submitTxError(txId, error)
      }
    }
  }

  abstract class Error(msg: String) extends Exception(msg)
  case object NoTransactionIdentifiers extends Error("Transaction did not contain an identifier")
  final case class TransactionNotWellFormed(reason: Throwable)
      extends Error(s"Transaction is not well formed: ${reason.getMessage}")
  final case class TransactionRejected(reason: String)
      extends Error(reason) // FIXME not an exception
}
