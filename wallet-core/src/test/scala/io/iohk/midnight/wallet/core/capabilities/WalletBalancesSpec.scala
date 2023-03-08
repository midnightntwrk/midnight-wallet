package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import scalajs.js

trait WalletBalancesSpec[TWallet] extends BetterOutputSuite {

  val walletBalances: WalletBalances[TWallet]
  val walletWithBalances: TWallet
  val expectedBalance: js.BigInt

  test("return wallet balance") {
    assertEquals(walletBalances.balance(walletWithBalances), expectedBalance)
  }

}
