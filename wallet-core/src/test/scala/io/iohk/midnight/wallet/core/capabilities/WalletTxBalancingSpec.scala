package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.WalletError.NotSufficientFunds
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionRecipe,
  TransactionToProve,
  TokenTransfer,
}
import io.iohk.midnight.wallet.core.util.BetterOutputSuite

trait WalletTxBalancingSpec[TWallet, TTransaction, TCoin] extends BetterOutputSuite {

  val walletTxBalancing: WalletTxBalancing[TWallet, TTransaction, TCoin]
  val walletWithFundsForBalancing: TWallet
  val walletWithoutFundsForBalancing: TWallet

  val transactionToBalance: TTransaction
  val newCoins: Vector[TCoin]
  val isValidBalancingRecipe: BalanceTransactionRecipe => Boolean

  val tokensTransfers: List[TokenTransfer]
  val isValidTransferRecipe: TransactionToProve => Boolean

  test("return recipe for balanced transaction") {
    val isBalanced = walletTxBalancing
      .balanceTransaction(walletWithFundsForBalancing, (transactionToBalance, newCoins))
      .map { case (_, tx) => isValidBalancingRecipe(tx) }
    assert(isBalanced.getOrElse(false))
  }

  test("return NotSufficientFunds when not enough funds for balance transaction") {
    val error = walletTxBalancing.balanceTransaction(
      walletWithoutFundsForBalancing,
      (transactionToBalance, newCoins),
    )
    error match
      case Left(NotSufficientFunds(tokenType)) => ()
      case _                                   => fail("NotSufficientFunds must be returned")
  }

  test("return recipe for balanced transfer transaction") {
    val isValid = walletTxBalancing
      .prepareTransferRecipe(walletWithFundsForBalancing, tokensTransfers)
      .map { case (_, tx) => isValidTransferRecipe(tx) }
    assert(isValid.getOrElse(false))
  }

  test("return NotSufficientFunds when not enough funds for transfer transaction") {
    val error = walletTxBalancing.prepareTransferRecipe(
      walletWithoutFundsForBalancing,
      tokensTransfers,
    )
    error match
      case Left(NotSufficientFunds(tokenType)) => ()
      case _                                   => fail("NotSufficientFunds must be returned")
  }
}
