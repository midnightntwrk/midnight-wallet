package io.iohk.midnight.wallet.engine.js

import cats.syntax.eq.*
import io.iohk.midnight.midnightNtwrkWalletApi.distTypesMod.{
  BalanceTransactionToProve,
  NothingToProve,
  TransactionToProve,
  ProvingRecipe as ApiProvingRecipe,
}
import io.iohk.midnight.midnightNtwrkWalletApi.mod.{
  BALANCE_TRANSACTION_TO_PROVE,
  NOTHING_TO_PROVE,
  TRANSACTION_TO_PROVE,
}
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.core.domain.ProvingRecipe
import io.iohk.midnight.wallet.zswap.{Transaction, UnprovenTransaction}
import scala.scalajs.js
import scala.scalajs.js.|

object ProvingRecipeTransformer {

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  def toRecipe(apiRecipe: ApiProvingRecipe): Either[String, ProvingRecipe] = {
    val recipeType = apiRecipe.asInstanceOf[js.Dynamic].`type`.asInstanceOf[String]
    if (NOTHING_TO_PROVE === recipeType) {
      val tx = Transaction.fromJs(apiRecipe.asInstanceOf[NothingToProve].transaction)
      Right(domain.NothingToProve(tx))
    } else if (TRANSACTION_TO_PROVE === recipeType) {
      val tx = UnprovenTransaction.fromJs(apiRecipe.asInstanceOf[TransactionToProve].transaction)
      Right(domain.TransactionToProve(tx))
    } else if (BALANCE_TRANSACTION_TO_PROVE === recipeType) {
      val instance = apiRecipe.asInstanceOf[BalanceTransactionToProve]
      val unprovenTx = UnprovenTransaction.fromJs(instance.transactionToProve)
      val txToBalance = Transaction.fromJs(instance.transactionToBalance)
      Right(domain.BalanceTransactionToProve(unprovenTx, txToBalance))
    } else {
      Left("Recipe match wasn't NothingToProve / TransactionToProve / BalanceTransactionToProve")
    }
  }

  def toApiBalanceTransactionRecipe(
      recipe: domain.BalanceTransactionRecipe,
  ): BalanceTransactionToProve | NothingToProve = {
    recipe match
      case domain.BalanceTransactionToProve(toProve, toBalance) =>
        |.from(
          BalanceTransactionToProve(toBalance.toJs, toProve.toJs, BALANCE_TRANSACTION_TO_PROVE),
        )
      case domain.NothingToProve(transaction) =>
        |.from(NothingToProve(transaction.toJs, NOTHING_TO_PROVE))
  }

  def toApiTransactionToProve(recipe: domain.TransactionToProve): TransactionToProve =
    TransactionToProve(recipe.transaction.toJs, TRANSACTION_TO_PROVE)
}
