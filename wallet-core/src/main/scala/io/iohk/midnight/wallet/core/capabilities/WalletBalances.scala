package io.iohk.midnight.wallet.core.capabilities

import scala.scalajs.js

trait WalletBalances[TWallet] {
  def balance(wallet: TWallet): js.BigInt
}
