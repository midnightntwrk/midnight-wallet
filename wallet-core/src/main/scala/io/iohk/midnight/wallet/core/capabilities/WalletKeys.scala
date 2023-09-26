package io.iohk.midnight.wallet.core.capabilities

trait WalletKeys[TWallet, TPublicKey, TViewingKey] {
  def publicKey(wallet: TWallet): TPublicKey

  def viewingKey(wallet: TWallet): TViewingKey
}
