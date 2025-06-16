package io.iohk.midnight.wallet.core.instances

import cats.syntax.all.*
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
import io.iohk.midnight.midnightNtwrkZswap.mod.{Transaction, UnprovenTransaction}
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.core.domain.ProvingRecipe

import scala.scalajs.js

// It's not the best place for it (the previous of wallet-engine/js was much better),
// But it's needed here because of capabilities need to expose a TS-compatible API
object ProvingRecipeTransformer {

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  def toRecipe(
      apiRecipe: ApiProvingRecipe,
  ): Either[String, ProvingRecipe[UnprovenTransaction, Transaction]] = {
    val recipeType = apiRecipe.asInstanceOf[js.Dynamic].`type`.asInstanceOf[String]
    if (NOTHING_TO_PROVE === recipeType) {
      val tx = apiRecipe.asInstanceOf[NothingToProve].transaction
      Right(domain.NothingToProve(tx))
    } else if (TRANSACTION_TO_PROVE === recipeType) {
      val tx = apiRecipe.asInstanceOf[TransactionToProve].transaction
      Right(domain.TransactionToProve(tx))
    } else if (BALANCE_TRANSACTION_TO_PROVE === recipeType) {
      val instance = apiRecipe.asInstanceOf[BalanceTransactionToProve]
      val unprovenTx = instance.transactionToProve
      val txToBalance = instance.transactionToBalance
      Right(domain.BalanceTransactionToProve(unprovenTx, txToBalance))
    } else {
      Left("Recipe match wasn't NothingToProve / TransactionToProve / BalanceTransactionToProve")
    }
  }

  def toApiBalanceTransactionToProve(
      recipe: domain.BalanceTransactionToProve[UnprovenTransaction, Transaction],
  ): BalanceTransactionToProve =
    BalanceTransactionToProve(
      recipe.toBalance,
      recipe.toProve,
      BALANCE_TRANSACTION_TO_PROVE,
    )

  def toApiNothingToProve(
      recipe: domain.NothingToProve[UnprovenTransaction, Transaction],
  ): NothingToProve =
    NothingToProve(recipe.transaction, NOTHING_TO_PROVE)

  def toApiTransactionToProve(
      recipe: domain.TransactionToProve[UnprovenTransaction],
  ): TransactionToProve =
    TransactionToProve(recipe.transaction, TRANSACTION_TO_PROVE)

  def toApiRecipe(
      recipe: DefaultBalancingCapability.Recipe[UnprovenTransaction, Transaction],
  ): ApiProvingRecipe = {
    recipe match {
      case recipe: domain.BalanceTransactionToProve[UnprovenTransaction, Transaction] =>
        toApiBalanceTransactionToProve(recipe)
      case recipe: domain.NothingToProve[UnprovenTransaction, Transaction] =>
        toApiNothingToProve(recipe)
      case recipe: domain.TransactionToProve[UnprovenTransaction] =>
        toApiTransactionToProve(recipe)
    }
  }
}
