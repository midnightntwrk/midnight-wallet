package io.iohk.midnight.wallet.integration_tests.core.capabilities

import cats.effect.IO
import io.iohk.midnight.wallet.core.WalletError.NotSufficientFunds
import io.iohk.midnight.wallet.core.capabilities.WalletTxBalancing
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionToProve,
  NothingToProve,
  TransactionToProve,
}
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.CatsEffectSuite

trait WalletTxBalancingSpec[
    TWallet,
    TTransaction,
    TUnprovenTransaction,
    TCoin,
    TTokenType,
    TCoinPublicKey,
    TEncPublicKey,
] extends CatsEffectSuite
    with BetterOutputSuite {

  val walletTxBalancing: WalletTxBalancing[
    TWallet,
    TTransaction,
    TUnprovenTransaction,
    TCoin,
  ]
  val walletWithFundsForBalancing: IO[TWallet]
  val walletWithoutFundsForBalancing: TWallet

  val transactionToBalance: IO[TTransaction]
  val newCoins: Vector[TCoin]
  val isValidBalancingRecipe: TransactionToProve[TUnprovenTransaction] |
    BalanceTransactionToProve[TUnprovenTransaction, TTransaction] |
    NothingToProve[TUnprovenTransaction, TTransaction] => Boolean

  test("return recipe for balanced transaction") {
    transactionToBalance.product(walletWithFundsForBalancing).map { (tx, wallet) =>
      val isBalanced = walletTxBalancing
        .balanceTransaction(wallet, (Left(tx), newCoins))
        .map { case (_, tx) =>
          isValidBalancingRecipe(tx)
        }
      assert(isBalanced.getOrElse(false))
    }
  }

  test("return NotSufficientFunds when not enough funds for balance transaction") {
    transactionToBalance.map { tx =>
      val error =
        walletTxBalancing.balanceTransaction(walletWithoutFundsForBalancing, (Left(tx), newCoins))
      error match {
        case Left(NotSufficientFunds(_)) => ()
        case _                           => fail("NotSufficientFunds must be returned")
      }
    }
  }
}
