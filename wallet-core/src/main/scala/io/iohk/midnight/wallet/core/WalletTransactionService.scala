package io.iohk.midnight.wallet.core

import cats.effect.Sync
import cats.syntax.applicative.*
import cats.syntax.applicativeError.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import io.iohk.midnight.wallet.core.capabilities.WalletTxBalancing
import io.iohk.midnight.wallet.core.domain.*
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.zswap.{CoinInfo, Transaction}

trait WalletTransactionService[F[_]] {
  def prepareTransferRecipe(outputs: List[TokenTransfer]): F[TransactionToProve]
  def proveTransaction(provingRecipe: ProvingRecipe): F[Transaction]
  def balanceTransaction(tx: Transaction, newCoins: Seq[CoinInfo]): F[BalanceTransactionRecipe]
}

object WalletTransactionService {
  class Live[F[_]: Sync, TWallet](
      walletStateContainer: WalletStateContainer[F, TWallet],
      provingService: ProvingService[F],
  )(implicit walletTxBalancing: WalletTxBalancing[TWallet, Transaction, CoinInfo])
      extends WalletTransactionService[F] {
    override def prepareTransferRecipe(outputs: List[TokenTransfer]): F[TransactionToProve] = {
      walletStateContainer
        .modifyStateEither { wallet =>
          walletTxBalancing.prepareTransferRecipe(wallet, outputs)
        }
        .flatMap {
          case Left(error) =>
            error.toThrowable.raiseError
          case Right(recipe) => recipe.pure
        }
    }

    override def proveTransaction(provingRecipe: ProvingRecipe): F[Transaction] = {
      provingRecipe match
        case TransactionToProve(transaction) =>
          provingService.proveTransaction(transaction)
        case BalanceTransactionToProve(toProve, toBalance) =>
          provingService
            .proveTransaction(toProve)
            .map { provedTx =>
              toBalance.merge(provedTx)
            }
        case NothingToProve(transaction) => transaction.pure
    }

    override def balanceTransaction(
        tx: Transaction,
        newCoins: Seq[CoinInfo],
    ): F[BalanceTransactionRecipe] = {
      walletStateContainer
        .modifyStateEither { wallet =>
          walletTxBalancing.balanceTransaction(wallet, (tx, newCoins))
        }
        .flatMap {
          case Left(error) =>
            error.toThrowable.raiseError
          case Right(recipe) => recipe.pure
        }
    }
  }
}
