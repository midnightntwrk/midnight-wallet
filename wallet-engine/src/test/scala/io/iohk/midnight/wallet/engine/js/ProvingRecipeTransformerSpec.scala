package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import cats.syntax.eq.*
import io.iohk.midnight.midnightWalletApi.distTypesMod.{
  BalanceTransactionToProve,
  NothingToProve,
  TransactionToProve,
  ProvingRecipe as ApiProvingRecipe,
}
import io.iohk.midnight.midnightWalletApi.mod.{
  BALANCE_TRANSACTION_TO_PROVE,
  NOTHING_TO_PROVE,
  TRANSACTION_TO_PROVE,
}
import io.iohk.midnight.wallet.core.Generators.{
  ledgerTransactionArbitrary,
  txWithContextArbitrary,
  unprovenTransactionArbitrary,
}
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.core.util.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.{Transaction, UnprovenTransaction}
import org.scalacheck.Prop.forAll
import org.scalacheck.effect.PropF.forAllF
import scala.scalajs.js

class ProvingRecipeTransformerSpec extends WithProvingServerSuite {

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def compareRecipes(
      obtainedProvingRecipe: ApiProvingRecipe,
      expectedRecipe: ApiProvingRecipe,
  ): Unit = {
    val errorMsg = "Recipes are not the same"
    val recipeType = obtainedProvingRecipe.asInstanceOf[js.Dynamic].`type`.asInstanceOf[String]
    val expectedRecipeType = expectedRecipe.asInstanceOf[js.Dynamic].`type`.asInstanceOf[String]
    if (NOTHING_TO_PROVE === recipeType && NOTHING_TO_PROVE === expectedRecipeType) {
      assertEquals(
        obtainedProvingRecipe.asInstanceOf[NothingToProve].transaction,
        expectedRecipe.asInstanceOf[NothingToProve].transaction,
      )
    } else if (TRANSACTION_TO_PROVE === recipeType && TRANSACTION_TO_PROVE === expectedRecipeType) {
      val instance = obtainedProvingRecipe.asInstanceOf[TransactionToProve]
      val expectedInstance = expectedRecipe.asInstanceOf[TransactionToProve]
      assertEquals(instance.transaction, expectedInstance.transaction)
    } else if (
      BALANCE_TRANSACTION_TO_PROVE === recipeType && BALANCE_TRANSACTION_TO_PROVE === expectedRecipeType
    ) {
      val instance = obtainedProvingRecipe.asInstanceOf[BalanceTransactionToProve]
      val expectedInstance = expectedRecipe.asInstanceOf[BalanceTransactionToProve]
      assertEquals(instance.transactionToProve, expectedInstance.transactionToProve)
      assertEquals(
        instance.transactionToBalance,
        expectedInstance.transactionToBalance,
      )
    } else fail(errorMsg)
  }

  test("should transform API TransactionToProve to domain TransactionToProve") {
    forAll { (unprovenTx: UnprovenTransaction) =>
      val apiProvingRecipe =
        ApiProvingRecipe.TransactionToProve(unprovenTx.toJs, TRANSACTION_TO_PROVE)
      assertEquals(
        ProvingRecipeTransformer.toRecipe(apiProvingRecipe),
        Right(domain.TransactionToProve(unprovenTx)),
      )
    }
  }

  test("should transform API BalanceTransactionToProve to domain BalanceTransactionToProve") {
    forAllF { (txIO: IO[Transaction], unprovenTx: UnprovenTransaction) =>
      txIO.map { tx =>
        val apiProvingRecipe = ApiProvingRecipe
          .BalanceTransactionToProve(tx.toJs, unprovenTx.toJs, BALANCE_TRANSACTION_TO_PROVE)
        assertEquals(
          ProvingRecipeTransformer.toRecipe(apiProvingRecipe),
          Right(domain.BalanceTransactionToProve(unprovenTx, tx)),
        )
      }
    }
  }

  test("should transform API NothingToProve to domain NothingToProve") {
    forAllF { (txIO: IO[Transaction]) =>
      txIO.map { tx =>
        val apiProvingRecipe = ApiProvingRecipe.NothingToProve(tx.toJs, NOTHING_TO_PROVE)
        assertEquals(
          ProvingRecipeTransformer.toRecipe(apiProvingRecipe),
          Right(domain.NothingToProve(tx)),
        )
      }
    }
  }

  test("should transform domain TransactionToProve to API TransactionToProve") {
    forAll { (unprovenTx: UnprovenTransaction) =>
      val provingRecipe = domain.TransactionToProve(unprovenTx)
      val apiProvingRecipe =
        ApiProvingRecipe.TransactionToProve(unprovenTx.toJs, TRANSACTION_TO_PROVE)
      compareRecipes(
        ProvingRecipeTransformer.toApiTransactionToProve(provingRecipe),
        apiProvingRecipe,
      )
    }
  }

  test("should transform domain BalanceTransactionToProve to API BalanceTransactionToProve") {
    forAllF { (txIO: IO[Transaction], unprovenTx: UnprovenTransaction) =>
      txIO.map { tx =>
        val provingRecipe = domain.BalanceTransactionToProve(unprovenTx, tx)
        val apiProvingRecipe = ApiProvingRecipe
          .BalanceTransactionToProve(tx.toJs, unprovenTx.toJs, BALANCE_TRANSACTION_TO_PROVE)
        compareRecipes(
          ProvingRecipeTransformer.toApiBalanceTransactionRecipe(provingRecipe),
          apiProvingRecipe,
        )
      }
    }
  }

  test("should transform domain NothingToProve to API NothingToProve") {
    forAllF { (txIO: IO[Transaction]) =>
      txIO.map { tx =>
        val provingRecipe = domain.NothingToProve(tx)
        val apiProvingRecipe = ApiProvingRecipe.NothingToProve(tx.toJs, NOTHING_TO_PROVE)
        compareRecipes(
          ProvingRecipeTransformer.toApiBalanceTransactionRecipe(provingRecipe),
          apiProvingRecipe,
        )
      }
    }
  }
}
