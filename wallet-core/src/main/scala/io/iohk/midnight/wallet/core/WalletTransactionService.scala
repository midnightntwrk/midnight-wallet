package io.iohk.midnight.wallet.core

import cats.effect.Sync
import cats.syntax.all.*
import io.iohk.midnight.wallet.core.capabilities.WalletTxBalancing
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.tracing.WalletTxServiceTracer
import io.iohk.midnight.wallet.zswap

trait WalletTransactionService[F[_], UnprovenTransaction, Transaction, CoinInfo, TokenType] {
  def prepareTransferRecipe(
      outputs: List[TokenTransfer[TokenType]],
  ): F[TransactionToProve[UnprovenTransaction]]

  def proveTransaction(
      provingRecipe: ProvingRecipe[UnprovenTransaction, Transaction],
  ): F[Transaction]

  def balanceTransaction(
      tx: Transaction,
      newCoins: Seq[CoinInfo],
  ): F[BalanceTransactionRecipe[UnprovenTransaction, Transaction]]
}

class WalletTransactionServiceFactory[
    F[_]: Sync,
    TWallet,
    UnprovenTransaction,
    Transaction,
    CoinInfo,
    TokenType,
](using
    WalletTxBalancing[
      TWallet,
      Transaction,
      UnprovenTransaction,
      CoinInfo,
      TokenType,
    ],
    zswap.Transaction.Transaction[Transaction, ?],
    zswap.UnprovenTransaction.IsSerializable[UnprovenTransaction],
) {
  private type Service =
    WalletTransactionService[F, UnprovenTransaction, Transaction, CoinInfo, TokenType]

  def create(
      walletStateContainer: WalletStateContainer[F, TWallet],
      provingService: ProvingService[F, UnprovenTransaction, Transaction],
  )(using tracer: WalletTxServiceTracer[F]): Service = new Service {
    override def prepareTransferRecipe(
        outputs: List[TokenTransfer[TokenType]],
    ): F[TransactionToProve[UnprovenTransaction]] =
      walletStateContainer
        .modifyStateEither(_.prepareTransferRecipe(outputs))
        .flatMap {
          case Left(error)   => error.toThrowable.raiseError
          case Right(recipe) => recipe.pure
        }

    override def proveTransaction(
        provingRecipe: ProvingRecipe[UnprovenTransaction, Transaction],
    ): F[Transaction] = {
      val provenTx = provingRecipe match {
        case TransactionToProve(transaction) =>
          provingService.proveTransaction(transaction)
        case BalanceTransactionToProve(toProve, toBalance) =>
          provingService
            .proveTransaction(toProve)
            .map(provedTx => toBalance.merge(provedTx))
        case NothingToProve(transaction) =>
          transaction.pure
      }

      provenTx.onError { error =>
        provingRecipe.unprovenTransaction match {
          case Some(tx) =>
            walletStateContainer
              .updateStateEither(_.applyFailedUnprovenTransaction(tx))
              .flatMap { _ =>
                val id = tx.identifiers.headOption.map(TransactionIdentifier.apply)
                tracer.unprovenTransactionReverted(id, error)
              }
          case None =>
            Sync[F].unit
        }
      }
    }

    override def balanceTransaction(
        tx: Transaction,
        newCoins: Seq[CoinInfo],
    ): F[BalanceTransactionRecipe[UnprovenTransaction, Transaction]] = {
      walletStateContainer
        .modifyStateEither(_.balanceTransaction((tx, newCoins)))
        .flatMap {
          case Left(error) =>
            error.toThrowable.raiseError
          case Right(recipe) => recipe.pure
        }
    }
  }
}
