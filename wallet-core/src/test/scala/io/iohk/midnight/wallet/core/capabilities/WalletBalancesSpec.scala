package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.zswap.TokenType

trait WalletBalancesSpec[TWallet] extends BetterOutputSuite {

  val walletBalances: WalletBalances[TWallet]
  val walletWithBalances: TWallet
  val expectedBalance: BigInt

  test("return wallet balance") {
    assertEquals(
      walletBalances.balance(walletWithBalances).getOrElse(TokenType.Native, BigInt(0)),
      expectedBalance,
    )
  }

}
