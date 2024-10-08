package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.zswap.{CoinInfo, Nullifier, QualifiedCoinInfo}

trait WalletCoins[TWallet] {
  def coins(wallet: TWallet): Seq[QualifiedCoinInfo]
  def nullifiers(wallet: TWallet): Seq[Nullifier]
  def availableCoins(wallet: TWallet): Seq[QualifiedCoinInfo]
  def pendingCoins(wallet: TWallet): Seq[CoinInfo]
}
