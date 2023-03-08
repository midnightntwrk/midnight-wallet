package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError.NotSufficientFunds
import io.iohk.midnight.wallet.core.util.BetterOutputSuite

trait WalletTxBalancingSpec[TWallet, TTransaction, TCoin] extends BetterOutputSuite {

  val walletTxBalancing: WalletTxBalancing[TWallet, TTransaction, TCoin]
  val walletWithFundsForBalancing: TWallet
  val walletWithoutFundsForBalancing: TWallet
  val transactionToBalance: TTransaction
  val newCoins: Vector[TCoin]
  val isTransactionBalanced: TTransaction => Boolean

  test("return balanced transaction") {
    val isBalanced = walletTxBalancing
      .balanceTransaction(walletWithFundsForBalancing, (transactionToBalance, newCoins))
      .map { case (_, tx) => isTransactionBalanced(tx) }
    assert(isBalanced.getOrElse(false))
  }

  test("return NotSufficientFunds when not enough funds") {
    val error = walletTxBalancing.balanceTransaction(
      walletWithoutFundsForBalancing,
      (transactionToBalance, newCoins),
    )
    assertEquals(error, Left(NotSufficientFunds))
  }

}
