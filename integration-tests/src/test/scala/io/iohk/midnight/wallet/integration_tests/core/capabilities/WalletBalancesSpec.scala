package io.iohk.midnight.wallet.integration_tests.core.capabilities

import io.iohk.midnight.wallet.core.capabilities.WalletBalances
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.zswap

trait WalletBalancesSpec[TWallet, TokenType](using tt: zswap.TokenType[TokenType, ?])
    extends BetterOutputSuite {

  val walletBalances: WalletBalances[TWallet, TokenType]
  val walletWithBalances: TWallet
  val expectedBalance: BigInt

  test("return wallet balance") {
    assertEquals(
      walletBalances.balance(walletWithBalances).getOrElse(tt.native, BigInt(0)),
      expectedBalance,
    )
  }

}
