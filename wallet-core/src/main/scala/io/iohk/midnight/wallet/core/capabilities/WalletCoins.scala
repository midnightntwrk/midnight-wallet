package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.zswap.{QualifiedCoinInfo, CoinInfo}

trait WalletCoins[TWallet] {
  def coins(wallet: TWallet): Seq[QualifiedCoinInfo]
  def availableCoins(wallet: TWallet): Seq[QualifiedCoinInfo]
  def pendingCoins(wallet: TWallet): Seq[CoinInfo]
}
