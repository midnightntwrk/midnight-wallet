package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.zswap.QualifiedCoinInfo

trait WalletCoins[TWallet] {
  def coins(wallet: TWallet): Seq[QualifiedCoinInfo]
  def availableCoins(wallet: TWallet): Seq[QualifiedCoinInfo]
}
