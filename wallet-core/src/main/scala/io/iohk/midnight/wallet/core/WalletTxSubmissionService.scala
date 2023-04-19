package io.iohk.midnight.wallet.core

import cats.effect.Sync
import cats.syntax.all.*
import io.iohk.midnight.midnightLedger.mod.{Transaction as LedgerTransaction, *}
import io.iohk.midnight.wallet.blockchain.data.Transaction as DomainTransaction
import io.iohk.midnight.wallet.core.capabilities.WalletTxBalancing
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.core.tracing.{BalanceTransactionTracer, WalletTxSubmissionTracer}

trait WalletTxSubmissionService[F[_]] {
  def submitTransaction(
      transaction: LedgerTransaction,
      newCoins: List[CoinInfo],
  ): F[TransactionIdentifier]
}

object WalletTxSubmissionService {
  class Live[F[_]: Sync, TWallet](
      submitTxService: TxSubmissionService[F],
      walletStateContainer: WalletStateContainer[F, TWallet],
  )(implicit
      walletTxBalancing: WalletTxBalancing[TWallet, LedgerTransaction, CoinInfo],
      tracer: WalletTxSubmissionTracer[F],
      balanceTxTracer: BalanceTransactionTracer[F],
  ) extends WalletTxSubmissionService[F] {

    override def submitTransaction(
        toSubmitLedgerTx: LedgerTransaction,
        newCoins: List[CoinInfo],
    ): F[TransactionIdentifier] = {
      for {
        _ <- tracer.submitTxStart(toSubmitLedgerTx)
        _ <- validateTx(toSubmitLedgerTx)
        balancedTx <- balanceTransaction(toSubmitLedgerTx, newCoins)
        balancedDomainTx = LedgerSerialization.toTransaction(balancedTx)
        response <- submitTxService.submitTransaction(balancedDomainTx)
        result <- adaptResponse(toSubmitLedgerTx, balancedDomainTx, response)
      } yield result
    }

    private def validateTx(ledgerTx: LedgerTransaction): F[Unit] = {
      Either
        .catchNonFatal(ledgerTx.wellFormed(enforceBalancing = false))
        .leftMap(TransactionNotWellFormed.apply)
        .liftTo[F]
        .attemptTap {
          case Left(error) => tracer.txValidationError(ledgerTx, error)
          case Right(_)    => tracer.txValidationSuccess(ledgerTx)
        }
    }

    private def balanceTransaction(
        ledgerTx: LedgerTransaction,
        newCoins: List[CoinInfo],
    ): F[LedgerTransaction] = {
      balanceTxTracer.balanceTxStart(ledgerTx) >> walletStateContainer
        .modifyStateEither { wallet =>
          walletTxBalancing
            .balanceTransaction(wallet, (ledgerTx, newCoins.toVector))
        }
        .flatMap {
          case Left(error) =>
            balanceTxTracer.balanceTxError(ledgerTx, error) >> error.toThrowable.raiseError
          case Right(balancedTx) => balanceTxTracer.balanceTxSuccess(balancedTx) >> balancedTx.pure
        }
    }

    private def adaptResponse(
        toSubmitLedgerTx: LedgerTransaction,
        domainBalancedTx: DomainTransaction,
        submissionResult: SubmissionResult,
    ): F[TransactionIdentifier] = {
      val result: F[TransactionIdentifier] = submissionResult match {
        case SubmissionResult.Accepted =>
          toSubmitLedgerTx
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
        case Right(submittedTxId) =>
          tracer.submitTxSuccess(toSubmitLedgerTx, domainBalancedTx, submittedTxId)
        case Left(error) => tracer.submitTxError(toSubmitLedgerTx, error)
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
