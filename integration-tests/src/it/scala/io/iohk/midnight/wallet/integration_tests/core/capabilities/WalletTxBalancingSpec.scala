package io.iohk.midnight.wallet.integration_tests.core.capabilities

import cats.effect.IO
import io.iohk.midnight.wallet.core.WalletError.NotSufficientFunds
import io.iohk.midnight.wallet.core.capabilities.WalletTxBalancing
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionRecipe,
  TokenTransfer,
  TransactionToProve,
}
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.CatsEffectSuite

trait WalletTxBalancingSpec[TWallet, TTransaction, TUnprovenTransaction, TCoin]
    extends CatsEffectSuite
    with BetterOutputSuite {

  val walletTxBalancing: WalletTxBalancing[TWallet, TTransaction, TUnprovenTransaction, TCoin]
  val walletWithFundsForBalancing: IO[TWallet]
  val walletWithoutFundsForBalancing: TWallet

  val transactionToBalance: IO[TTransaction]
  val newCoins: Vector[TCoin]
  val isValidBalancingRecipe: BalanceTransactionRecipe => Boolean

  val tokensTransfers: List[TokenTransfer]
  val isValidTransferRecipe: TransactionToProve => Boolean

  test("return recipe for balanced transaction") {
    transactionToBalance.product(walletWithFundsForBalancing).map { (tx, wallet) =>
      val isBalanced = walletTxBalancing
        .balanceTransaction(wallet, (tx, newCoins))
        .map { case (_, tx) => isValidBalancingRecipe(tx) }
      assert(isBalanced.getOrElse(false))
    }
  }

  test("return NotSufficientFunds when not enough funds for balance transaction") {
    transactionToBalance.map { tx =>
      val error = walletTxBalancing.balanceTransaction(
        walletWithoutFundsForBalancing,
        (tx, newCoins),
      )
      error match {
        case Left(NotSufficientFunds(_)) => ()
        case _                           => fail("NotSufficientFunds must be returned")
      }
    }
  }

  test("return recipe for balanced transfer transaction") {
    walletWithFundsForBalancing.map { wallet =>
      val isValid = walletTxBalancing
        .prepareTransferRecipe(wallet, tokensTransfers)
        .map { case (_, tx) => isValidTransferRecipe(tx) }
      assert(isValid.getOrElse(false))
    }
  }

  test("return NotSufficientFunds when not enough funds for transfer transaction") {
    val error = walletTxBalancing.prepareTransferRecipe(
      walletWithoutFundsForBalancing,
      tokensTransfers,
    )
    error match
      case Left(NotSufficientFunds(_)) => ()
      case _                           => fail("NotSufficientFunds must be returned")
  }
}
