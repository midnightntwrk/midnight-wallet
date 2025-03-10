package io.iohk.midnight.wallet.engine.js

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
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.core.domain.ProvingRecipe
import io.iohk.midnight.midnightNtwrkZswap.mod.{Transaction, UnprovenTransaction}
import scala.scalajs.js

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
}
