package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.zswap.TokenType

trait WalletBalances[TWallet] {
  def balance(wallet: TWallet): Map[TokenType, BigInt]
}
