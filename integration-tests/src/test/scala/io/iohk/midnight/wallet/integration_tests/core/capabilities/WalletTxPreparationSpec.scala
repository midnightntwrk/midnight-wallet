package io.iohk.midnight.wallet.integration_tests.core.capabilities

import cats.effect.IO
import io.iohk.midnight.wallet.core.WalletError.NotSufficientFunds
import io.iohk.midnight.wallet.core.capabilities.WalletTxPreparation
import io.iohk.midnight.wallet.core.domain.{TokenTransfer, ProvingRecipe}
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.CatsEffectSuite

trait WalletTxPreparationSpec[
    TWallet,
    TTokenType,
    TTransaction,
    TUnprovenTransaction,
    TCoinPublicKey,
    TEncPublicKey,
] extends CatsEffectSuite
    with BetterOutputSuite {

  val walletTxPreparation: WalletTxPreparation[
    TWallet,
    TTokenType,
    TTransaction,
    TUnprovenTransaction,
    TCoinPublicKey,
    TEncPublicKey,
  ]
  val walletWithFundsForBalancing: IO[TWallet]
  val tokensTransfers: List[TokenTransfer[TTokenType, TCoinPublicKey, TEncPublicKey]]
  val isValidTransferRecipe: ProvingRecipe[TTransaction, TUnprovenTransaction] => Boolean

  test("return recipe for balanced transfer transaction") {
    walletWithFundsForBalancing.map { wallet =>
      val isValid = walletTxPreparation
        .prepareTransferRecipe(tokensTransfers)
        .map { case (_, tx) => isValidTransferRecipe(tx) }
      assert(isValid.getOrElse(false))
    }
  }

  test("return NotSufficientFunds when not enough funds for transfer transaction") {
    val error = walletTxPreparation.prepareTransferRecipe(
      tokensTransfers,
    )
    error match
      case Left(NotSufficientFunds(_)) => ()
      case _                           => fail("NotSufficientFunds must be returned")
  }
}
