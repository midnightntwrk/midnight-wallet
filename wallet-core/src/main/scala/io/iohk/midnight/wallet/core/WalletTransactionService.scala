package io.iohk.midnight.wallet.core

import cats.effect.{IO, Sync}
import cats.syntax.all.*
import io.iohk.midnight.wallet.core.capabilities.WalletTxBalancing
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.tracing.WalletTxServiceTracer
import io.iohk.midnight.wallet.zswap

trait WalletTransactionService[UnprovenTransaction, Transaction, CoinInfo, TokenType] {
  def prepareTransferRecipe(
      outputs: List[TokenTransfer[TokenType]],
  ): IO[TransactionToProve[UnprovenTransaction]]

  def proveTransaction(
      provingRecipe: ProvingRecipe[UnprovenTransaction, Transaction],
  ): IO[Transaction]

  def balanceTransaction(
      tx: Transaction,
      newCoins: Seq[CoinInfo],
  ): IO[BalanceTransactionRecipe[UnprovenTransaction, Transaction]]
}

class WalletTransactionServiceFactory[
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
    WalletTransactionService[UnprovenTransaction, Transaction, CoinInfo, TokenType]

  def create(
      walletStateContainer: WalletStateContainer[TWallet],
      provingService: ProvingService[UnprovenTransaction, Transaction],
  )(using tracer: WalletTxServiceTracer): Service = new Service {
    override def prepareTransferRecipe(
        outputs: List[TokenTransfer[TokenType]],
    ): IO[TransactionToProve[UnprovenTransaction]] =
      walletStateContainer
        .modifyStateEither(_.prepareTransferRecipe(outputs))
        .flatMap {
          case Left(error)   => error.toThrowable.raiseError
          case Right(recipe) => recipe.pure
        }

    override def proveTransaction(
        provingRecipe: ProvingRecipe[UnprovenTransaction, Transaction],
    ): IO[Transaction] = {
      val provenTx: IO[Transaction] = provingRecipe match {
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
            Sync[IO].unit
        }
      }
    }

    override def balanceTransaction(
        tx: Transaction,
        newCoins: Seq[CoinInfo],
    ): IO[BalanceTransactionRecipe[UnprovenTransaction, Transaction]] = {
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
