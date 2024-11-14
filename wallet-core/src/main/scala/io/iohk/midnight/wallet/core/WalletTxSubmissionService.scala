package io.iohk.midnight.wallet.core

import cats.effect.Sync
import cats.syntax.all.*
import io.iohk.midnight.wallet.core.capabilities.WalletTxBalancing
import io.iohk.midnight.wallet.core.domain.TransactionIdentifier
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.tracing.WalletTxSubmissionTracer
import io.iohk.midnight.wallet.zswap

trait WalletTxSubmissionService[F[_], Transaction] {
  def submitTransaction(transaction: Transaction): F[TransactionIdentifier]
}

class WalletTxSubmissionServiceFactory[
    F[_]: Sync,
    TWallet,
    Transaction,
](using
    WalletTxBalancing[TWallet, Transaction, ?, ?, ?],
    zswap.Transaction.Transaction[Transaction, ?],
    zswap.Transaction.CanEraseProofs[Transaction, ?],
) {
  private type Service = WalletTxSubmissionService[F, Transaction]

  def create(
      submitTxService: TxSubmissionService[F, Transaction],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(using
      tracer: WalletTxSubmissionTracer[F],
  ): Service = new Service {
    override def submitTransaction(toSubmitLedgerTx: Transaction): F[TransactionIdentifier] =
      for {
        txId <- getIdentifier(toSubmitLedgerTx)
        _ <- tracer.submitTxStart(txId)
        _ <- validateTx(toSubmitLedgerTx, txId)
        response <- submitTxService.submitTransaction(toSubmitLedgerTx).attempt
        result <- adaptResponse(toSubmitLedgerTx, txId, response)
      } yield result

    private def getIdentifier(tx: Transaction): F[TransactionIdentifier] = {
      tx.identifiers.headOption
        .fold(NoTransactionIdentifiers.raiseError[F, TransactionIdentifier])(
          TransactionIdentifier(_).pure,
        )
    }

    private def validateTx(ledgerTx: Transaction, txId: TransactionIdentifier): F[Unit] = {
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
        tx: Transaction,
        txId: TransactionIdentifier,
        submissionResult: Either[Throwable, SubmissionResult],
    ): F[TransactionIdentifier] = {
      val result = submissionResult match {
        case Right(SubmissionResult.Accepted)         => txId.pure
        case Right(SubmissionResult.Rejected(reason)) => TransactionRejected(reason).raiseError
        case Left(error) => TransactionSubmissionFailed(error).raiseError
      }
      result.attemptTap {
        case Right(_)    => tracer.submitTxSuccess(txId)
        case Left(error) => tracer.submitTxError(txId, error) >> revertTx(tx, txId)
      }
    }

    private def revertTx(tx: Transaction, txId: TransactionIdentifier): F[Unit] =
      walletStateContainer
        .updateStateEither(_.applyFailedTransaction(tx))
        .flatMap {
          case Right(_)    => Sync[F].unit
          case Left(error) => tracer.revertError(txId, error.toThrowable)
        }
  }

  abstract class Error(msg: String) extends Exception(msg)
  case object NoTransactionIdentifiers extends Error("Transaction did not contain an identifier")
  final case class TransactionNotWellFormed(reason: Throwable)
      extends Error(s"Transaction is not well formed: ${reason.getMessage}")
  final case class TransactionRejected(reason: String)
      extends Error(reason) // FIXME not an exception
  final case class TransactionSubmissionFailed(throwable: Throwable)
      extends Error(throwable.getMessage)
}
